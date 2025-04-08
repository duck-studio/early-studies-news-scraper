import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import pLimit from "p-limit";
import { Logger } from "pino";
import { z } from "zod";

import {
  type DateRangeEnum,
  LastSyncRunStdResponseSchema,
  ManualSyncRequestSchema,
  ManualSyncResponseDataSchema,
  ManualSyncStdResponseSchema,
  createStandardResponseSchema,
} from "../schema";

import {
  type UpdateSyncRunData,
  getLastSyncRun,
  getPublications,
  insertSyncRun,
  updateSyncRun,
} from "../db/queries";

import { authMiddleware, handleDatabaseError } from "../middleware";

import { fetchAllPagesForUrl } from "../services/serper";

import { getDateRange, parseSerperDate } from "../utils/date/parsers";
import { getGeoParams, getTbsString } from "../utils/date/search-params";
import { normalizeUrl } from "../utils/url";
import { queueBatchMessages } from "../services/queue";

// Type for sync operation result
type SyncSummary = z.infer<typeof ManualSyncResponseDataSchema>;

// Type for workflow item params
type ProcessNewsItemParams = {
  headlineUrl: string;
  publicationId: string;
  headlineText: string;
  snippet: string | null;
  source: string;
  rawDate: string | null;
  normalizedDate: string | null;
};

/**
 * Performs a headline sync operation to fetch and queue headlines from publications
 */
async function performHeadlineSync(
  env: Env,
  logger: Logger,
  triggerType: "manual" | "scheduled",
  dateRangeOption: DateRangeEnum,
  customTbs: string | undefined,
  maxQueriesPerPublication: number
): Promise<SyncSummary> {
  logger.info("Starting headline sync...", {
    triggerType,
    dateRangeOption,
    maxQueriesPerPublication,
  });

  let syncRunId: string | undefined;
  try {
    const { id } = await insertSyncRun(env.DB, {
      triggerType,
      dateRangeOption,
      customTbs,
      maxQueriesPerPublication,
    });
    syncRunId = id;
    logger.info(`Created sync run record: ${syncRunId}`);
  } catch (dbError) {
    logger.error("Failed to create initial sync run record. Aborting sync.", { dbError });
    throw new Error("Failed to initialize sync run logging.");
  }

  let summary: SyncSummary | undefined;
  try {
    if (!env.SERPER_API_KEY) {
      throw new Error("Server configuration error: SERPER_API_KEY missing.");
    }
    if (!env.NEWS_ITEM_QUEUE) {
      throw new Error("Server configuration error: NEWS_ITEM_QUEUE binding missing.");
    }

    const publications = await getPublications(env.DB);
    if (!publications || publications.length === 0) {
      logger.info("No publications found in the database. Finishing sync early.", { syncRunId });
      summary = {
        publicationsFetched: 0,
        totalHeadlinesFetched: 0,
        headlinesWithinDateRange: 0,
        workflowsQueued: 0,
        dateRange: { start: new Date(0).toISOString(), end: new Date(0).toISOString() },
      };
      await updateSyncRun(env.DB, syncRunId, {
        status: "completed",
        summaryPublicationsFetched: 0,
        summaryTotalHeadlinesFetched: 0,
        summaryHeadlinesWithinRange: 0,
        summaryWorkflowsQueued: 0,
      });
      logger.info("Sync task finished early: No publications found.", { syncRunId });
      return summary;
    }

    const publicationUrlToIdMap = new Map<string, string>();
    for (const pub of publications) {
      if (pub.id && pub.url) {
        publicationUrlToIdMap.set(pub.url, pub.id);
      }
    }

    const publicationUrls = Array.from(publicationUrlToIdMap.keys());
    logger.info(`Found ${publicationUrls.length} publications to fetch.`);

    const fetchLimit = pLimit(10);
    const region = "UK";
    const tbs = getTbsString(dateRangeOption, customTbs);
    const geoParams = getGeoParams(region);
    const dateRange = getDateRange(dateRangeOption);

    const fetchPromises = publicationUrls.map((url) =>
      fetchLimit(() =>
        fetchAllPagesForUrl(
          normalizeUrl(url, true),
          tbs,
          geoParams,
          env.SERPER_API_KEY,
          maxQueriesPerPublication,
          logger
        )
      )
    );

    logger.info(`Fetching headlines for ${publicationUrls.length} publications...`);
    const fetchResults = await Promise.all(fetchPromises);
    logger.info("Finished fetching headlines.");

    let headlinesFilteredCount = 0;
    let messagesSent = 0;
    let _messageSendErrors = 0;

    const processedHeadlines = fetchResults.flatMap((result) => {
      logger.debug({ url: result.url, hasError: !!result.error }, "Processing fetch result");
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
        normalizedDate: parseSerperDate(item.date)?.toLocaleDateString("en-GB") ?? null,
        category: null,
        publicationId,
      }));

      logger.debug(
        { url: result.url, count: transformedResults.length },
        "Transformed results for publication"
      );
      return transformedResults;
    });

    const totalFetched = processedHeadlines.length;
    logger.info(`Total headlines fetched across all publications: ${totalFetched}`);

    // Prepare queue payloads
    const itemsToQueue: ProcessNewsItemParams[] = [];
    
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
          "Sync: Filtering result, could not parse date"
        );
      }
    }
    
    // Queue the messages
    if (itemsToQueue.length > 0) {
      const queueResult = await queueBatchMessages(
        env.NEWS_ITEM_QUEUE,
        itemsToQueue,
        logger,
        { concurrency: 50, delayIncrementBatch: 10, delayIncrementSeconds: 1 }
      );
      
      messagesSent = queueResult.messagesSent;
      _messageSendErrors = queueResult.messageSendErrors;
    }

    summary = {
      publicationsFetched: fetchResults.filter((r) => !r.error).length,
      totalHeadlinesFetched: totalFetched,
      headlinesWithinDateRange: headlinesFilteredCount,
      workflowsQueued: messagesSent,
      dateRange: { start: dateRange.start.toISOString(), end: dateRange.end.toISOString() },
    };

    // --- Update Sync Run Record (Completed) ---
    await updateSyncRun(env.DB, syncRunId, {
      status: "completed",
      summaryPublicationsFetched: summary.publicationsFetched,
      summaryTotalHeadlinesFetched: summary.totalHeadlinesFetched,
      summaryHeadlinesWithinRange: summary.headlinesWithinDateRange,
      summaryWorkflowsQueued: summary.workflowsQueued,
    });

    logger.info("Sync task finished successfully.", { syncRunId, ...summary });
    return summary;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error during sync task execution:", { syncRunId, error });

    if (syncRunId) {
      try {
        const updatePayload: UpdateSyncRunData = {
          status: "failed",
          errorMessage: errorMessage,
          summaryPublicationsFetched: summary?.publicationsFetched ?? null,
          summaryTotalHeadlinesFetched: summary?.totalHeadlinesFetched ?? null,
          summaryHeadlinesWithinRange: summary?.headlinesWithinDateRange ?? null,
          summaryWorkflowsQueued: summary?.workflowsQueued ?? null,
        };

        await updateSyncRun(env.DB, syncRunId, updatePayload);
        logger.info("Updated sync run record to failed status.", { syncRunId });
      } catch (updateError) {
        logger.error("Failed to update sync run record to failed status.", {
          syncRunId,
          updateError,
        });
      }
    }
    throw error;
  }
}

// Create a router for sync operations
const syncRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Manual sync endpoint
syncRouter.post(
  "/",
  authMiddleware,
  describeRoute({
    description: "Manually trigger a headline sync operation for a specified date range.",
    tags: ["Sync"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: { "application/json": { schema: ManualSyncRequestSchema } },
    },
    responses: {
      200: {
        description: "Sync operation completed successfully.",
        content: { "application/json": { schema: ManualSyncStdResponseSchema } },
      },
      400: {
        description: "Bad Request (Invalid Input)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_Sync"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_Sync"),
          },
        },
      },
      500: {
        description: "Internal Server Error (Sync Failed)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_Sync"),
          },
        },
      },
    },
  }),
  zValidator("json", ManualSyncRequestSchema),
  async (c) => {
    const { dateRangeOption, customTbs, maxQueriesPerPublication } = c.req.valid("json");
    const logger = c.get("logger");

    try {
      // Pass 'manual' as the trigger type
      const syncSummary = await performHeadlineSync(
        c.env,
        logger,
        "manual",
        dateRangeOption,
        customTbs,
        maxQueriesPerPublication
      );

      return c.json(
        {
          data: syncSummary,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      logger.error("Manual sync request failed", { error });
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: "Failed to perform headline sync.",
            code: "SYNC_FAILED",
            details: error instanceof Error ? error.message : String(error),
          },
        },
        500
      );
    }
  }
);

// Get latest sync status endpoint
syncRouter.get(
  "/latest",
  describeRoute({
    description: "Get the details of the most recent sync run.",
    tags: ["Sync"],
    responses: {
      200: {
        description: "Successful retrieval of the last sync run.",
        content: { "application/json": { schema: LastSyncRunStdResponseSchema } },
      },
      404: {
        description: "No sync runs found.",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_SyncLatest"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_SyncLatest"),
          },
        },
      },
    },
  }),
  async (c) => {
    const logger = c.get("logger");
    try {
      const lastRun = await getLastSyncRun(c.env.DB);

      if (!lastRun) {
        logger.info("No sync runs found in the database.");
        return c.json(
          {
            data: null,
            success: false,
            error: { message: "No sync runs found.", code: "NOT_FOUND" },
          },
          404
        );
      }

      return c.json(
        {
          data: lastRun,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, "Failed to retrieve the last sync run");
    }
  }
);

// Export the router and the sync function to be used by scheduled events
export { syncRouter, performHeadlineSync };
export default syncRouter;
