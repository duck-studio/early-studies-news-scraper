import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { validator as zValidator } from 'hono-openapi/zod';
import { z } from 'zod';

import {
  HeadlinesStatsResponseSchema,
  StatsQueryBodySchema,
  createStandardResponseSchema,
} from '../schema';

import { getHeadlineStats } from '../db/queries';
import { authMiddleware, handleDatabaseError, validateAndParseDateRange } from '../middleware';

// Create a router for statistics
const statsRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Get headline statistics
statsRouter.post(
  '/headlines',
  authMiddleware,
  describeRoute({
    description: 'Get statistics about headlines within a date range.',
    tags: ['Statistics'],
    requestBody: {
      content: { 'application/json': { schema: StatsQueryBodySchema } },
    },
    responses: {
      200: {
        description: 'Successful statistics query',
        content: { 'application/json': { schema: HeadlinesStatsResponseSchema } },
      },
      400: {
        description: 'Bad Request (Invalid Date Format)',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_Stats'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_Stats'),
          },
        },
      },
    },
  }),
  zValidator('json', StatsQueryBodySchema),
  async (c) => {
    const body = c.req.valid('json');
    const logger = c.get('logger');

    // Use the helper function for date validation and parsing
    const dates = validateAndParseDateRange(c, body);
    if (!dates) {
      return c.res; // Response has already been set by the helper
    }

    const { startDate, endDate } = dates;

    // Additional validation for statistics - both dates must be present
    if (!startDate) {
      logger.warn('Start date is required for statistics.');
      c.status(400);
      return c.json({
        data: null,
        success: false,
        error: { message: 'Start date is required. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' },
      });
    }

    if (!endDate) {
      logger.warn('End date is required for statistics.');
      c.status(400);
      return c.json({
        data: null,
        success: false,
        error: { message: 'End date is required. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' },
      });
    }

    try {
      const rawStats = await getHeadlineStats(c.env.DB, startDate, endDate);

      // Process raw stats into the desired response format

      // 1. Calculate Category Percentages
      const categoryPercentage: Record<string, number> = {};
      if (rawStats.totalCount > 0) {
        for (const item of rawStats.categoryCounts) {
          const categoryName = item.category ?? 'uncategorized';
          const percentage = parseFloat(((item.count / rawStats.totalCount) * 100).toFixed(2));
          categoryPercentage[categoryName] = percentage;
        }
      }

      // 2. Format Publication Counts
      const publicationCounts = rawStats.publicationCounts.map((item) => ({
        publication: {
          id: item.publicationId,
          name: item.publicationName,
          url: item.publicationUrl,
          category: item.publicationCategory,
        },
        count: item.count,
      }));

      // 3. Format Daily Counts
      const dailyCounts = rawStats.dailyCounts
        .filter(
          (item): item is { normalizedDate: string; count: number } => item.normalizedDate !== null
        )
        .map((item) => ({
          date: item.normalizedDate,
          count: item.count,
        }));

      const statsData = {
        categoryPercentage,
        publicationCounts,
        dailyCounts,
      };

      // Return standard success response
      return c.json(
        {
          data: statsData,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      // Use the standard DB error handler
      return handleDatabaseError(c, error, 'Failed to fetch headline statistics');
    }
  }
);

export default statsRouter;
