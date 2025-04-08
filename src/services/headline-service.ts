import pLimit from "p-limit";
import { Logger } from "pino";
import { type InsertHeadline, insertPublication } from "../db/queries";
import { headlineCategories } from "../db/schema";
import { fetchAllPagesForUrl } from "../services/serper";
import type { ProcessNewsItemParams } from "../types";
import { getGeoParams, getTbsString } from "../utils";

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

  // Ensure URLs have https:// prefix
  const urls = publicationUrls.map((url) => (url.startsWith("https://") ? url : `https://${url}`));

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
    const keyUrl = url.replace(/^https?:\/\//, "");

    try {
      // Create a new publication record
      const [newPublication] = await insertPublication(db, {
        name: keyUrl,
        url, // Store full URL (with https://)
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
