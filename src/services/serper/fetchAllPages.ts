import pLimit from 'p-limit';
import type { Logger } from 'pino';
import { config } from '../../config';
import type {
  FetchAllPagesResult,
  GeoParams,
  SerperNewsItem,
} from '../../schema';
import { fetchSerperPage } from './client';

// Create a concurrency limiter for parallel processing of multiple publications
export const publicationLimit = pLimit(config.concurrencyLimit);

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