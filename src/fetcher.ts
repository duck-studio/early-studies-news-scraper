import pLimit from "p-limit";
import retry from "async-retry";
import type { Logger } from "pino";
import { config } from "./config";
import type {
  SerperNewsResult,
  SerperNewsItem,
  GeoParams,
  FetchAllPagesResult,
  TryConsumeCredit,
} from "./schema";

/**
 * Fetches a single page of news results from the Serper API for a given site query.
 * Implements retry logic for transient errors.
 *
 * @param siteQuery - The 'site:' query string (e.g., "site:bbc.co.uk").
 * @param tbs - The time range parameter string.
 * @param geoParams - Geographical parameters ({ gl, location }).
 * @param apiKey - The Serper API key.
 * @param page - The page number to fetch (1-based).
 * @param logger - Pino logger instance for contextual logging.
 * @returns A Promise resolving to the parsed SerperNewsResult.
 * @throws An error if the fetch fails after all retries or encounters a non-retryable error.
 */
async function fetchSerperPage(
  siteQuery: string,
  tbs: string,
  geoParams: GeoParams,
  apiKey: string,
  page: number,
  logger: Logger
): Promise<SerperNewsResult> {
  const headers = new Headers({
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
  });

  const requestBody = JSON.stringify({
    q: siteQuery,
    tbs: tbs,
    gl: geoParams.gl,
    location: geoParams.location,
    num: config.resultsPerPage,
    page: page,
  });

  const requestOptions: RequestInit = {
    method: "POST",
    headers: headers,
    body: requestBody,
    redirect: "follow",
  };

  logger.debug({ siteQuery, page }, "Attempting Serper API fetch");

  return await retry(
    async (bail, attempt) => {
      const attemptLogger = logger.child({ attempt, siteQuery, page });
      try {
        const response = await fetch(config.serperApiUrl, requestOptions);

        if (!response.ok) {
          let errorBody = `Status code ${response.status}`;
          try {
            errorBody = await response.text();
          } catch {
            /* Ignore body read error */
          }
          const error = new Error(`Serper API Error: ${response.status}`);
          attemptLogger.warn(
            { status: response.status, body: errorBody },
            "Serper API request failed"
          );

          // Stop retrying for 4xx errors (except 429 Too Many Requests)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            bail(error);
            throw error;
          }
          throw error;
        }

        const result = await response.json();
        attemptLogger.debug("Serper API fetch successful");
        return result as SerperNewsResult;
      } catch (error: any) {
        attemptLogger.warn(
          { err: error },
          "Serper API fetch attempt failed, retrying if possible..."
        );
        throw error;
      }
    },
    {
      ...config.retryOptions,
      onRetry: (error, attempt) => {
        logger.warn({ err: error, attempt, siteQuery, page }, `Retrying Serper fetch`);
      },
    }
  );
}

/**
 * Fetches all relevant pages of news results for a single publication URL,
 * respecting query and credit limits.
 *
 * @param url - The publication URL to search within.
 * @param tbs - The time range parameter string.
 * @param geoParams - Geographical parameters ({ gl, location }).
 * @param apiKey - The Serper API key.
 * @param maxQueriesForThisUrl - Maximum number of pages to fetch for this specific URL.
 * @param tryConsumeCredit - Function to attempt consuming a credit before fetching a page.
 * @param logger - Pino logger instance for contextual logging.
 * @returns A Promise resolving to a FetchAllPagesResult object.
 */
export async function fetchAllPagesForUrl(
  url: string,
  tbs: string,
  geoParams: GeoParams,
  apiKey: string,
  maxQueriesForThisUrl: number,
  tryConsumeCredit: TryConsumeCredit,
  logger: Logger
): Promise<FetchAllPagesResult> {
  const urlLogger = logger.child({ publicationUrl: url });
  let siteQuery: string;

  try {
    // Extract hostname robustly
    siteQuery = `site:${new URL(url).hostname}`;
  } catch (e: any) {
    urlLogger.error({ err: e }, "Invalid URL format provided");
    return { url, queriesMade: 0, results: [], error: new Error(`Invalid URL format: ${url}`) };
  }

  urlLogger.info({ maxQueries: maxQueriesForThisUrl }, `Starting iterative fetch for URL`);

  let currentPage = 1;
  let queriesMade = 0;
  const aggregatedResults: SerperNewsItem[] = [];

  while (true) {
    // 1. Check per-URL query limit
    if (queriesMade >= maxQueriesForThisUrl) {
      urlLogger.info({ queriesMade }, `Reached max queries limit for this URL. Stopping.`);
      break;
    }

    // 2. Attempt to reserve a global credit *before* fetching
    if (!tryConsumeCredit()) {
      urlLogger.info({ queriesMade }, `Global credit limit reached. Stopping fetch for this URL.`);
      break;
    }

    const pageLogger = urlLogger.child({ page: currentPage });
    try {
      pageLogger.info(`Fetching page (credit reserved)`);
      const pageResult = await fetchSerperPage(
        siteQuery,
        tbs,
        geoParams,
        apiKey,
        currentPage,
        pageLogger
      );

      // Fetch successful, credit was used.
      queriesMade++;

      const newsCount = pageResult.news?.length ?? 0;
      pageLogger.info({ resultsFound: newsCount }, `Page fetch successful.`);

      if (newsCount > 0) {
        aggregatedResults.push(...pageResult.news);
      }

      // 3. Check stopping conditions based on results
      if (newsCount === 0) {
        pageLogger.info(`Found 0 results. Assuming end of results.`);
        break;
      }
      if (newsCount < config.resultsPerPage) {
        pageLogger.info(
          `Found fewer results (${newsCount}) than requested (${config.resultsPerPage}). Assuming end of results.`
        );
        break;
      }

      // Prepare for the next page
      currentPage++;
    } catch (error: any) {
      pageLogger.error(
        { err: error },
        `Failed to fetch page after retries. Stopping fetch for this URL.`
      );
      return { url, queriesMade, results: aggregatedResults, error };
    }
  }

  urlLogger.info(
    { queriesMade, totalResults: aggregatedResults.length },
    `Finished fetching for URL.`
  );
  return { url, queriesMade, results: aggregatedResults };
}
