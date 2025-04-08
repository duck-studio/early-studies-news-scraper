import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { validator as zValidator } from 'hono-openapi/zod';
import { Logger } from 'pino';
import { z } from 'zod';

import {
  LastSyncRunStdResponseSchema,
  ManualSyncRequestSchema,
  ManualSyncResponseDataSchema,
  ManualSyncStdResponseSchema,
  createStandardResponseSchema,
} from '../schema';

import {
  type UpdateSyncRunData,
  getLastSyncRun,
  getPublications,
  insertSyncRun,
  updateSyncRun,
} from '../db/queries';

import { authMiddleware, handleDatabaseError } from '../middleware';

import {
  batchFetchHeadlines,
  prepareQueueItemsFromFetchResults,
  queueHeadlinesForProcessing,
} from '../services/headline-service';

// Type definitions

// Type for sync operation result
type SyncSummary = z.infer<typeof ManualSyncResponseDataSchema>;

// SyncSummary is the result type for our sync operations

/**
 * Performs a headline sync operation to fetch and queue headlines from publications
 */
async function performHeadlineSync(
  env: Env,
  logger: Logger,
  triggerType: 'manual' | 'scheduled',
  startDate: string,
  endDate: string,
  maxQueriesPerPublication: number,
  defaultRegion = 'UK'
): Promise<SyncSummary> {
  logger.info('Starting headline sync...', {
    triggerType,
    startDate,
    endDate,
    maxQueriesPerPublication,
  });

  let syncRunId: string | undefined;
  try {
    const { id } = await insertSyncRun(env.DB, {
      triggerType,
      startDate,
      endDate,
      maxQueriesPerPublication,
    });
    syncRunId = id;
    logger.info(`Created sync run record: ${syncRunId}`);
  } catch (dbError) {
    logger.error('Failed to create initial sync run record. Aborting sync.', { dbError });
    throw new Error('Failed to initialize sync run logging.');
  }

  let summary: SyncSummary | undefined;
  try {
    // Get settings to check for API key
    let apiKey = env.SERPER_API_KEY; // Default from env
    try {
      const { getSettings } = await import('../db/queries');
      const settings = await getSettings(env.DB);
      if (settings?.serperApiKey) {
        // Use API key from settings if available
        apiKey = settings.serperApiKey;
        logger.info('Using Serper API key from settings');
      }
    } catch (settingsError) {
      logger.warn('Could not get settings for Serper API key, using env var', { settingsError });
    }

    if (!apiKey) {
      throw new Error(
        'Server configuration error: Serper API Key missing from both settings and environment variables.'
      );
    }

    if (!env.NEWS_ITEM_QUEUE) {
      throw new Error('Server configuration error: NEWS_ITEM_QUEUE binding missing.');
    }

    const publications = await getPublications(env.DB);
    if (!publications || publications.length === 0) {
      logger.info('No publications found in the database. Finishing sync early.', { syncRunId });
      summary = {
        publicationsFetched: 0,
        totalHeadlinesFetched: 0,
        headlinesWithinDateRange: 0,
        workflowsQueued: 0,
        dateRange: { start: new Date(0).toISOString(), end: new Date(0).toISOString() },
      };
      await updateSyncRun(env.DB, syncRunId, {
        status: 'completed',
        summaryPublicationsFetched: 0,
        summaryTotalHeadlinesFetched: 0,
        summaryHeadlinesWithinRange: 0,
        summaryWorkflowsQueued: 0,
      });
      logger.info('Sync task finished early: No publications found.', { syncRunId });
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

    // Create date objects from the DD/MM/YYYY format strings
    const startParts = startDate.split('/').map(Number);
    const endParts = endDate.split('/').map(Number);
    const dateRange = {
      start: new Date(startParts[2], startParts[1] - 1, startParts[0]),
      end: new Date(endParts[2], endParts[1] - 1, endParts[0]),
    };

    // Use the provided defaultRegion parameter, which already includes fallbacks
    const region = defaultRegion;

    logger.info(
      `Fetching headlines for ${publicationUrls.length} publications with region: ${region}...`
    );
    const fetchResults = await batchFetchHeadlines(
      publicationUrls,
      startDate,
      endDate,
      region,
      apiKey,
      maxQueriesPerPublication,
      logger
    );
    logger.info('Finished fetching headlines.');

    // Use the shared function to prepare queue items from the fetch results
    const { itemsToQueue, headlinesFilteredCount } = prepareQueueItemsFromFetchResults(
      fetchResults,
      publicationUrlToIdMap,
      logger
    );

    const totalFetched = itemsToQueue.length;
    logger.info(`Total headlines fetched across all publications: ${totalFetched}`);

    // Queue the messages using the shared function
    const { messagesSent, messageSendErrors: _messageSendErrors } =
      await queueHeadlinesForProcessing(env.NEWS_ITEM_QUEUE, itemsToQueue, logger);

    summary = {
      publicationsFetched: fetchResults.filter((r) => !r.error).length,
      totalHeadlinesFetched: totalFetched,
      headlinesWithinDateRange: headlinesFilteredCount,
      workflowsQueued: messagesSent,
      dateRange: { start: dateRange.start.toISOString(), end: dateRange.end.toISOString() },
    };

    // --- Update Sync Run Record (Completed) ---
    await updateSyncRun(env.DB, syncRunId, {
      status: 'completed',
      summaryPublicationsFetched: summary.publicationsFetched,
      summaryTotalHeadlinesFetched: summary.totalHeadlinesFetched,
      summaryHeadlinesWithinRange: summary.headlinesWithinDateRange,
      summaryWorkflowsQueued: summary.workflowsQueued,
    });

    logger.info('Sync task finished successfully.', { syncRunId, ...summary });

    // Clean up old headlines after successful sync
    try {
      const { deleteOldHeadlines } = await import('../db/queries');
      const result = await deleteOldHeadlines(env.DB, 3); // Delete headlines older than 3 months
      logger.info('Cleaned up old headlines', { deletedCount: result.deletedCount });
    } catch (cleanupError) {
      // Just log the error, don't fail the entire sync
      logger.warn('Failed to clean up old headlines', { cleanupError });
    }

    return summary;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error during sync task execution:', { syncRunId, error });

    if (syncRunId) {
      try {
        const updatePayload: UpdateSyncRunData = {
          status: 'failed',
          errorMessage: errorMessage,
          summaryPublicationsFetched: summary?.publicationsFetched ?? null,
          summaryTotalHeadlinesFetched: summary?.totalHeadlinesFetched ?? null,
          summaryHeadlinesWithinRange: summary?.headlinesWithinDateRange ?? null,
          summaryWorkflowsQueued: summary?.workflowsQueued ?? null,
        };

        await updateSyncRun(env.DB, syncRunId, updatePayload);
        logger.info('Updated sync run record to failed status.', { syncRunId });
      } catch (updateError) {
        logger.error('Failed to update sync run record to failed status.', {
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
  '/',
  authMiddleware,
  describeRoute({
    description: 'Manually trigger a headline sync operation for a specified date range.',
    tags: ['Sync'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: { 'application/json': { schema: ManualSyncRequestSchema } },
    },
    responses: {
      200: {
        description: 'Sync operation completed successfully.',
        content: { 'application/json': { schema: ManualSyncStdResponseSchema } },
      },
      400: {
        description: 'Bad Request (Invalid Input)',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_Sync'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_Sync'),
          },
        },
      },
      500: {
        description: 'Internal Server Error (Sync Failed)',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_Sync'),
          },
        },
      },
    },
  }),
  zValidator('json', ManualSyncRequestSchema),
  async (c) => {
    const { startDate, endDate, maxQueriesPerPublication } = c.req.valid('json');
    const logger = c.get('logger');

    try {
      // Check if settings exist to get defaultRegion
      let defaultRegion = 'UK';
      try {
        const { getSettings } = await import('../db/queries');
        const settings = await getSettings(c.env.DB);
        if (settings?.defaultRegion) {
          defaultRegion = settings.defaultRegion;
        }
      } catch (error) {
        logger.warn('Failed to get settings for defaultRegion', { error });
      }

      // Pass 'manual' as the trigger type
      const syncSummary = await performHeadlineSync(
        c.env,
        logger,
        'manual',
        startDate,
        endDate,
        maxQueriesPerPublication,
        defaultRegion
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
      logger.error('Manual sync request failed', { error });
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: 'Failed to perform headline sync.',
            code: 'SYNC_FAILED',
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
  '/latest',
  describeRoute({
    description: 'Get the details of the most recent sync run.',
    tags: ['Sync'],
    responses: {
      200: {
        description: 'Successful retrieval of the last sync run.',
        content: { 'application/json': { schema: LastSyncRunStdResponseSchema } },
      },
      404: {
        description: 'No sync runs found.',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_SyncLatest'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_SyncLatest'),
          },
        },
      },
    },
  }),
  async (c) => {
    const logger = c.get('logger');
    try {
      const lastRun = await getLastSyncRun(c.env.DB);

      if (!lastRun) {
        logger.info('No sync runs found in the database.');
        return c.json(
          {
            data: null,
            success: false,
            error: { message: 'No sync runs found.', code: 'NOT_FOUND' },
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
      return handleDatabaseError(c, error, 'Failed to retrieve the last sync run');
    }
  }
);

// Export the router and the sync function to be used by scheduled events
export { syncRouter, performHeadlineSync };
export default syncRouter;
