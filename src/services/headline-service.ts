import pLimit from "p-limit";
import { Logger } from "pino";
import { type InsertHeadline, getPublications, insertPublication } from "../db/queries";
import { headlineCategories } from "../db/schema";
import { fetchAllPagesForUrl } from "../services/serper";
import type { ProcessNewsItemParams } from "../types";
import { getGeoParams, getTbsString } from "../utils/date/search-params";
import { normalizeUrl } from "../utils/url";

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
): Omit<InsertHeadline, "id"> {
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
 */
export async function batchFetchHeadlines(
  publicationUrls: string[],
  dateRangeOption: string,
  customTbs: string | undefined,
  region: string,
  apiKey: string,
  maxQueriesPerPublication: number,
  logger: Logger
) {
  const serperTbs = getTbsString(dateRangeOption, customTbs);
  const geoParams = getGeoParams(region);
  const fetchLimit = pLimit(10);

  // Ensure URLs have https:// prefix using the normalizeUrl utility
  const urls = publicationUrls.map(url => normalizeUrl(url, true));

  const fetchPromises = urls.map((url) =>
    fetchLimit(() =>
      fetchAllPagesForUrl(url, serperTbs, geoParams, apiKey, maxQueriesPerPublication, logger)
    )
  );

  return Promise.all(fetchPromises);
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
        logger.info("Successfully created new publication", {
          keyUrl,
          newId: newPublication.id,
        });
        return newPublication.id;
      }

      logger.error("Failed to retrieve publication ID after insert", { keyUrl });
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
  logger?.debug("Building publication URL to ID map");
  
  const publicationUrlToIdMap = new Map<string, string>();
  
  try {
    const publications = await getPublications(db);
    
    if (!publications || publications.length === 0) {
      logger?.warn("No publications found in the database");
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
    logger?.error("Failed to build publication URL map", { error });
    return publicationUrlToIdMap;
  }
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
