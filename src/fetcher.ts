import retry from 'async-retry';
import pLimit from 'p-limit';
import type { Logger } from 'pino';
import { config } from './config';
import type {
  FetchAllPagesResult,
  GeoParams,
  SerperNewsItem,
  SerperNewsResult,
} from './schema';

// Create a concurrency limiter for parallel processing of multiple publications
// Export it for use in index.ts
export const publicationLimit = pLimit(config.concurrencyLimit);

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

  // Make sure to set correct time-based search in the request
  const requestPayload = {
    q: siteQuery,
    tbs: tbs,
    gl: geoParams.gl,
    location: geoParams.location,
    num: config.resultsPerPage,
    page: page,
  };
  
  const requestBody = JSON.stringify(requestPayload);
  
  // Debug logging to capture the exact request parameters - no JSON.stringify to ensure it appears in logs
  logger.info(`SERPER REQUEST DETAILS:
URL: ${config.serperApiUrl}
Method: POST
Headers: Content-Type: application/json, X-API-KEY: ***
Body: ${JSON.stringify(requestPayload, null, 2)}`);

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

        const result = await response.json() as SerperNewsResult;
        
        // More detailed logging without JSON.stringify to ensure it appears in logs
        attemptLogger.info(`SERPER RESPONSE DETAILS:
Results Count: ${result.news?.length ?? 0}
Has News Array: ${Array.isArray(result.news)}
Credits Used: ${result.credits}
Parameters We Sent:
  - TBS (Time Filter): "${tbs}"
  - Page: ${page}
Parameters Serper Used: ${JSON.stringify(result.searchParameters || {}, null, 2)}`);
        
        // Log full response details at debug level
        attemptLogger.debug('Serper API response details', { 
          responsePreview: `${JSON.stringify(result).substring(0, 500)}...` // Shortened for logs
        });
        return result;
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
 * @param logger - Pino logger instance for contextual logging.
 * @returns A Promise resolving to a FetchAllPagesResult object.
 */
export async function fetchAllPagesForUrl(
  url: string,
  tbs: string,
  geoParams: GeoParams,
  apiKey: string,
  maxQueriesForThisUrl: number,
  logger: Logger
): Promise<FetchAllPagesResult> {
  const urlLogger = logger.child({ publicationUrl: url });
  let siteQuery: string;

  try {
    // Extract hostname robustly
    siteQuery = `site:${new URL(url).hostname}`;
  } catch (e: unknown) {
    urlLogger.error({ err: e }, 'Invalid URL format provided');
    return { url, queriesMade: 0, credits: 0, results: [], error: new Error(`Invalid URL format: ${url}`) };
  }

  urlLogger.info({ maxQueries: maxQueriesForThisUrl }, 'Starting iterative fetch for URL');

  let queriesMade = 0;
  let totalCredits = 0;
  const aggregatedResults: SerperNewsItem[] = [];

  // Sequential fetch approach to respect stopping conditions
  let currentPage = 1;
  
  while (currentPage <= maxQueriesForThisUrl) {
    // 1. Check per-URL query limit
    if (queriesMade >= maxQueriesForThisUrl) {
      urlLogger.info({ queriesMade }, 'Reached max queries limit for this URL. Stopping.');
      break;
    }

    const pageLogger = urlLogger.child({ page: currentPage });
    try {
      pageLogger.info('Fetching page (credit reserved)');
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
      totalCredits += pageResult.credits;

      const newsCount = pageResult.news?.length ?? 0;
      pageLogger.info({ 
        resultsFound: newsCount, 
        creditsUsed: pageResult.credits,
        requestedResults: config.resultsPerPage,
        page: currentPage,
        siteQuery,
        hasMoreResults: newsCount === config.resultsPerPage,
        totalResultsSoFar: aggregatedResults.length
      }, 'Page fetch successful.');

      // Add results to our collection if any exist
      if (newsCount > 0) {
        aggregatedResults.push(...pageResult.news);
        
        // Add safety check for maximum results per publication
        if (aggregatedResults.length >= config.maxResultsPerPublication) {
          pageLogger.warn(`STOPPING FETCHES: Reached maximum results limit (${aggregatedResults.length}/${config.maxResultsPerPublication}) for this publication. This is a safety limit - if time filters were working properly, we would expect fewer results for narrow time ranges.`);
          break;
        }
      }

      // 3. Check stopping conditions based on results
      if (newsCount === 0) {
        pageLogger.info(`STOPPING FETCHES: Found 0 results on page ${currentPage}. Total results fetched: ${aggregatedResults.length}.`);
        break;
      }
      
      if (newsCount < config.resultsPerPage) {
        pageLogger.info(`STOPPING FETCHES: Found fewer results (${newsCount}) than requested (${config.resultsPerPage}) on page ${currentPage}. Total results fetched: ${aggregatedResults.length}. This is expected behavior when reaching the end of available results.`);
        break;
      }

      // Continue to next page
      currentPage++;
    } catch (error: unknown) {
      pageLogger.error(
        { err: error },
        'Failed to fetch page after retries. Stopping fetch for this URL.'
      );
      return { url, queriesMade, credits: totalCredits, results: aggregatedResults, error: error as Error };
    }
  }

  urlLogger.info(
    { queriesMade, totalResults: aggregatedResults.length, totalCredits },
    'Finished fetching for URL.'
  );
  return { url, queriesMade, credits: totalCredits, results: aggregatedResults };
}