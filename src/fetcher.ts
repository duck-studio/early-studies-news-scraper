import retry from 'async-retry';
import pLimit from 'p-limit';
import type { Logger } from 'pino';
import { config } from './config';
import type {
  FetchAllPagesResult,
  GeoParams,
  SerperNewsItem,
  SerperNewsResult,
  TryConsumeCredit,
} from './schema';

// Create a concurrency limiter based on config
const limit = pLimit(config.concurrencyLimit);

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
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
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
    method: 'POST',
    headers: headers,
    body: requestBody,
    redirect: 'follow',
  };

  logger.debug({ siteQuery, page }, 'Attempting Serper API fetch');

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
            'Serper API request failed'
          );

          // Stop retrying for 4xx errors (except 429 Too Many Requests)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            bail(error);
            throw error;
          }
          throw error;
        }

        const result = await response.json();
        attemptLogger.debug('Serper API fetch successful');
        return result as SerperNewsResult;
      } catch (error: unknown) {
        attemptLogger.warn(
          { err: error },
          'Serper API fetch attempt failed, retrying if possible...'
        );
        throw error;
      }
    },
    {
      ...config.retryOptions,
      onRetry: (error, attempt) => {
        logger.warn({ err: error, attempt, siteQuery, page }, 'Retrying Serper fetch');
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
  } catch (e: unknown) {
    urlLogger.error({ err: e }, 'Invalid URL format provided');
    return {
      url,
      queriesMade: 0,
      credits: 0,
      results: [],
      error: new Error(`Invalid URL format: ${url}`),
    };
  }

  urlLogger.info({ maxQueries: maxQueriesForThisUrl }, 'Starting iterative fetch for URL');

  // Remove unused variable (previously used in the sequential approach)
  let queriesMade = 0;
  let totalCredits = 0;
  const aggregatedResults: SerperNewsItem[] = [];

  // Create an array of page numbers to fetch
  const pagesToFetch: number[] = [];
  for (let page = 1; page <= maxQueriesForThisUrl; page++) {
    pagesToFetch.push(page);
  }

  // Process pages with concurrency limit
  const fetchPage = async (page: number) => {
    // 1. Check per-URL query limit
    if (queriesMade >= maxQueriesForThisUrl) {
      urlLogger.info({ queriesMade }, 'Reached max queries limit for this URL. Stopping.');
      return null;
    }

    // 2. Attempt to reserve a global credit *before* fetching
    if (!tryConsumeCredit()) {
      urlLogger.info({ queriesMade }, 'Global credit limit reached. Stopping fetch for this URL.');
      return null;
    }

    const pageLogger = urlLogger.child({ page });
    try {
      pageLogger.info('Fetching page (credit reserved)');
      const pageResult = await fetchSerperPage(siteQuery, tbs, geoParams, apiKey, page, pageLogger);

      // Fetch successful, credit was used.
      queriesMade++;
      totalCredits += pageResult.credits;

      const newsCount = pageResult.news?.length ?? 0;
      pageLogger.info(
        {
          resultsFound: newsCount,
          creditsUsed: pageResult.credits,
          requestedResults: config.resultsPerPage,
          page,
          siteQuery,
          hasMoreResults: newsCount === config.resultsPerPage,
          totalResultsSoFar: aggregatedResults.length,
        },
        'Page fetch successful.'
      );

      if (newsCount > 0) {
        return pageResult.news;
      }

      // Check stopping conditions based on results
      if (newsCount === 0) {
        pageLogger.info('Found 0 results. Assuming end of results.');
        return null; // Signal to stop fetching more pages
      }
      if (newsCount < config.resultsPerPage) {
        pageLogger.info(
          {
            resultsFound: newsCount,
            requestedResults: config.resultsPerPage,
            page,
            totalResultsSoFar: aggregatedResults.length,
          },
          'Found fewer results than requested. Assuming end of results.'
        );
        return pageResult.news; // Return results but signal this is the last page
      }

      return pageResult.news;
    } catch (error: unknown) {
      pageLogger.error(
        { err: error },
        'Failed to fetch page after retries. Stopping fetch for this URL.'
      );
      return null;
    }
  };

  try {
    // Use pLimit to fetch pages with concurrency control
    const pagePromises = pagesToFetch.map((page) => limit(() => fetchPage(page)));
    const results = await Promise.all(pagePromises);

    // Filter null results and flatten the array
    const validResults = results.filter(Boolean);
    for (const result of validResults) {
      if (result) aggregatedResults.push(...result);
    }
  } catch (error: unknown) {
    urlLogger.error({ err: error }, 'Error during concurrent page fetching.');
    return {
      url,
      queriesMade,
      credits: totalCredits,
      results: aggregatedResults,
      error: error as Error,
    };
  }

  urlLogger.info(
    { queriesMade, totalResults: aggregatedResults.length, totalCredits },
    'Finished fetching for URL.'
  );
  return { url, queriesMade, credits: totalCredits, results: aggregatedResults };
}
