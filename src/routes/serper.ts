import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { authMiddleware } from '../middleware';
import { createStandardResponseSchema } from '../schema';
import { fetchSerperAccountDetails } from '../services/serper/client';

// Create a Serper account router
const serperRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Define response schema for account details
const SerperAccountDetailsSchema = z
  .object({
    balance: z.number().int().nonnegative().openapi({
      description: 'Remaining balance of credits',
      example: 47975,
    }),
    rateLimit: z.number().int().nonnegative().openapi({
      description: 'Rate limit for API requests',
      example: 50,
    }),
  })
  .openapi({ ref: 'SerperAccountDetails' });

// Define standard response schema for account details
const SerperAccountDetailsResponseSchema = createStandardResponseSchema(
  SerperAccountDetailsSchema,
  'SerperAccountDetailsResponse'
);

// GET /serper/account endpoint
serperRouter.get(
  '/account',
  authMiddleware,
  describeRoute({
    description: 'Get Serper API account details',
    tags: ['Serper API'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Serper account details',
        content: {
          'application/json': {
            schema: SerperAccountDetailsResponseSchema,
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_SerperAccount'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_SerperAccount'),
          },
        },
      },
    },
  }),
  async (c) => {
    const logger = c.get('logger');

    try {
      // Check for API key
      if (!c.env.SERPER_API_KEY) {
        logger.error('Serper API key not configured');
        return c.json(
          {
            data: null,
            success: false,
            error: {
              message: 'Serper API key not configured',
              code: 'CONFIG_ERROR',
            },
          },
          500
        );
      }

      // Fetch account details from Serper API
      const accountDetails = await fetchSerperAccountDetails(c.env.SERPER_API_KEY, logger);

      // Remove the actual API key from the response for security
      // Use destructuring to omit the apiKey
      const { apiKey: _unused, ...safeDetails } = accountDetails;

      return c.json(
        {
          data: safeDetails,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      logger.error('Failed to fetch Serper account details', { error });
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: 'Failed to fetch Serper account details',
            code: 'SERPER_API_ERROR',
            details: error instanceof Error ? error.message : String(error),
          },
        },
        500
      );
    }
  }
);

export default serperRouter;
