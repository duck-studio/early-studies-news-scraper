import pLimit from 'p-limit';
import { Logger } from 'pino';
import { type InsertHeadline, getPublications, insertPublication } from '../db/queries';
import { headlineCategories } from '../db/schema';
import { queueBatchMessages } from '../services/queue';
import { fetchAllPagesForUrl } from '../services/serper';
import type { ProcessNewsItemParams } from '../types';
import { parseSerperDate } from '../utils/date/parsers';
import { datesToTbsString, getGeoParams } from '../utils/date/search-params';
import { normalizeUrl } from '../utils/url';

// Type for headline categories
type HeadlineCategory = (typeof headlineCategories)[number];

/**
 * Queue a headline item for processing
 */
export async function queueHeadlineForProcessing(
  queue: Queue,
  payload: ProcessNewsItemParams,
  delaySeconds = 0,
  logger?: Logger
): Promise<boolean> {
  try {
    await queue.send(payload, { delaySeconds });
    if (logger) {
      logger.debug(`Queued headline: ${payload.headlineUrl} with delay ${delaySeconds}s`);
    }
    return true;
  } catch (error) {
    if (logger) {
      logger.error(`Failed to queue headline: ${payload.headlineUrl}`, { error });
    }
    return false;
  }
}

/**
 * Prepare a news item for insertion into the database
 */
export function prepareHeadlineData(
  headlineUrl: string,
  publicationId: string,
  headlineText: string,
  snippet: string | null,
  source: string,
  rawDate: string | null,
  normalizedDate: string | null,
  category: HeadlineCategory | null = null
): Omit<InsertHeadline, 'id'> {
  return {
    url: headlineUrl,
    headline: headlineText,
    snippet,
    source,
    rawDate,
    normalizedDate,
    category,
    publicationId,
  };
}

/**
 * Batch fetch headlines from multiple publication URLs
 *
 * @param publicationUrls The URLs to fetch headlines from
 * @param startDate Start date in DD/MM/YYYY format
 * @param endDate End date in DD/MM/YYYY format
 * @param region Region code for search parameters
 * @param apiKey Serper API key
 * @param maxQueriesPerPublication Maximum queries per publication
 * @param logger Logger instance for logging
 * @returns Promise resolving to an array of fetch results
 */
export async function batchFetchHeadlines(
  publicationUrls: string[],
  startDate: string,
  endDate: string,
  region: string,
  apiKey: string,
  maxQueriesPerPublication: number,
  logger: Logger
) {
  const serperTbs = datesToTbsString(startDate, endDate);
  const geoParams = getGeoParams(region);
  const fetchLimit = pLimit(10);

  // Ensure URLs have https:// prefix using the normalizeUrl utility
  const urls = publicationUrls.map((url) => normalizeUrl(url, true));

  const fetchPromises = urls.map((url) =>
    fetchLimit(() =>
      fetchAllPagesForUrl(url, serperTbs, geoParams, apiKey, maxQueriesPerPublication, logger)
    )
  );

  return Promise.all(fetchPromises);
}

/**
 * Processes fetched headlines and queues them for asynchronous processing
 * Common function used by both fetch and sync routes
 *
 * @param queue The queue to send messages to
 * @param itemsToQueue Array of items to queue
 * @param logger Logger instance for logging
 * @returns Object containing message count metrics
 */
export async function queueHeadlinesForProcessing(
  queue: Queue,
  itemsToQueue: ProcessNewsItemParams[],
  logger: Logger
): Promise<{ messagesSent: number; messageSendErrors: number }> {
  if (itemsToQueue.length === 0) {
    logger.info('No headlines to queue for processing');
    return { messagesSent: 0, messageSendErrors: 0 };
  }

  logger.info(`Attempting to queue ${itemsToQueue.length} headlines for workflow processing`);

  const queueResult = await queueBatchMessages(queue, itemsToQueue, logger, {
    concurrency: 50,
    delayIncrementBatch: 10,
    delayIncrementSeconds: 1,
  });

  const { messagesSent, messageSendErrors } = queueResult;
  logger.info(`Queue operation complete: ${messagesSent} sent, ${messageSendErrors} failed`);

  return { messagesSent, messageSendErrors };
}

/**
 * Find or create a publication by URL
 */
export async function findOrCreatePublication(
  db: D1Database,
  url: string,
  logger: Logger
): Promise<string | undefined> {
  try {
    // Clean URL for lookup without protocol
    const keyUrl = normalizeUrl(url, false);
    const fullUrl = normalizeUrl(url, true);

    try {
      // Create a new publication record
      const [newPublication] = await insertPublication(db, {
        name: keyUrl,
        url: fullUrl,
      });

      if (newPublication?.id) {
        logger.info('Successfully created new publication', {
          keyUrl,
          newId: newPublication.id,
        });
        return newPublication.id;
      }

      logger.error('Failed to retrieve publication ID after insert', { keyUrl });
      return undefined;
    } catch (dbError) {
      // Publication already exists - this is handled differently by the caller
      logger.error(`Failed to create publication for URL: ${url}`, { dbError });
      return undefined;
    }
  } catch (error) {
    logger.error(`Unexpected error in findOrCreatePublication for URL: ${url}`, { error });
    return undefined;
  }
}

/**
 * Builds a map of publication URLs to their database IDs
 *
 * @param db The database connection
 * @param logger Optional logger instance
 * @returns A Map where keys are publication URLs (without protocol) and values are publication IDs
 */
export async function buildPublicationUrlMap(
  db: D1Database,
  logger?: Logger
): Promise<Map<string, string>> {
  logger?.debug('Building publication URL to ID map');

  const publicationUrlToIdMap = new Map<string, string>();

  try {
    const publications = await getPublications(db);

    if (!publications || publications.length === 0) {
      logger?.warn('No publications found in the database');
      return publicationUrlToIdMap;
    }

    for (const pub of publications) {
      if (pub.id && pub.url) {
        // Store the normalized URL (without protocol) as the key
        const keyUrl = normalizeUrl(pub.url, false);
        publicationUrlToIdMap.set(keyUrl, pub.id);
      }
    }

    logger?.info(`Mapped ${publicationUrlToIdMap.size} publications`);
    return publicationUrlToIdMap;
  } catch (error) {
    logger?.error('Failed to build publication URL map', { error });
    return publicationUrlToIdMap;
  }
}

/**
 * Prepares items for the queue based on fetched headlines
 * Common function used by both fetch and sync routes
 *
 * @param fetchResults The results from Serper API fetch operations
 * @param publicationUrlToIdMap Map of publication URLs to IDs
 * @param logger Logger instance for logging
 * @returns Object containing processed items and count of filtered headlines
 */
export function prepareQueueItemsFromFetchResults(
  fetchResults: Array<{
    url: string;
    error?: Error;
    results: Array<{
      title: string;
      link: string;
      snippet?: string;
      date?: string;
      source: string;
    }>;
  }>,
  publicationUrlToIdMap: Map<string, string>,
  logger: Logger
): { itemsToQueue: ProcessNewsItemParams[]; headlinesFilteredCount: number } {
  const itemsToQueue: ProcessNewsItemParams[] = [];
  let headlinesFilteredCount = 0;

  // Process each publication's results
  const processedHeadlines = fetchResults.flatMap((result) => {
    logger.debug({ url: result.url, hasError: !!result.error }, 'Processing fetch result');
    if (result.error) {
      logger.warn(`Fetch failed for ${result.url}: ${result.error.message}`);
      return [];
    }

    const urlWithoutProtocol = normalizeUrl(result.url, false);
    const publicationId = publicationUrlToIdMap.get(urlWithoutProtocol);

    if (!publicationId) {
      logger.warn(`Could not find publication ID for URL: ${result.url}. Skipping its results.`);
      return [];
    }

    const transformedResults = result.results.map((item) => ({
      url: item.link,
      headline: item.title,
      snippet: item.snippet ?? null,
      source: item.source,
      rawDate: item.date ?? null,
      normalizedDate: parseSerperDate(item.date)?.toLocaleDateString('en-GB') ?? null,
      category: null,
      publicationId,
    }));

    logger.debug(
      { url: result.url, count: transformedResults.length },
      'Transformed results for publication'
    );
    return transformedResults;
  });

  // Filter by date and prepare queue items
  for (const item of processedHeadlines) {
    const parsedDate = parseSerperDate(item.rawDate);
    if (parsedDate) {
      headlinesFilteredCount++;
      itemsToQueue.push({
        headlineUrl: item.url,
        publicationId: item.publicationId,
        headlineText: item.headline,
        snippet: item.snippet,
        source: item.source,
        rawDate: item.rawDate,
        normalizedDate: item.normalizedDate,
      });
    } else {
      logger.debug(
        { headline: item.headline, rawDate: item.rawDate },
        'Filtering result, could not parse date'
      );
    }
  }

  return { itemsToQueue, headlinesFilteredCount };
}

/**
 * Gets a publication ID for a URL, creating the publication if needed
 *
 * @param db The database connection
 * @param url The publication URL
 * @param urlToIdMap Optional pre-built map of URLs to publication IDs
 * @param logger Optional logger instance
 * @returns The publication ID if found or created successfully, otherwise undefined
 */
export async function getOrCreatePublicationId(
  db: D1Database,
  url: string,
  urlToIdMap?: Map<string, string>,
  logger?: Logger
): Promise<string | undefined> {
  const normalizedUrl = normalizeUrl(url, false);

  // Check the map first if provided
  if (urlToIdMap?.has(normalizedUrl)) {
    return urlToIdMap.get(normalizedUrl);
  }

  // Otherwise try to create the publication
  logger?.debug(`Publication not found in map for URL: ${url}. Attempting to create.`);
  return findOrCreatePublication(db, url, logger as Logger);
}
