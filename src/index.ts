import { apiReference } from '@scalar/hono-api-reference';
import { isWithinInterval, parse as parseDate } from 'date-fns';
import { type Context, Hono, type Next } from 'hono';
import { describeRoute, openAPISpecs } from 'hono-openapi';
import { resolver, validator as zValidator } from 'hono-openapi/zod';
import { HTTPException } from 'hono/http-exception';
import { type StatusCode } from 'hono/utils/http-status';
import type { Logger } from 'pino';
import { ZodError, z } from 'zod';
import {
  type DatabaseError,
  deleteHeadline,
  deletePublication,
  deleteRegion,
  getHeadlineStats,
  getHeadlines,
  getPublications,
  getRegions,
  insertHeadline,
  insertPublication,
  insertRegion,
  updateHeadlineById,
  updatePublication,
  updateRegion,
} from './db/queries';
import { fetchAllPagesForUrl, publicationLimit } from './fetcher';
import { createLogger, createRequestLogger } from './logger';
import {
  DeleteHeadlineBodySchema,
  DeletePublicationBodySchema,
  DeleteRegionBodySchema,
  HeadlinesFetchRequestSchema,
  HeadlinesFetchStdResponseSchema,
  HeadlinesQueryBodySchema,
  HeadlinesQueryStdResponseSchema,
  HeadlinesStatsResponseSchema,
  InsertHeadlineSchema,
  InsertPublicationSchema,
  InsertRegionSchema,
  PublicationsListResponseSchema,
  PublicationsQueryBodySchema,
  RegionSchema,
  RegionsListResponseSchema,
  SingleHeadlineResponseSchema,
  SinglePublicationResponseSchema,
  SingleRegionResponseSchema,
  StandardErrorSchema,
  StatsQueryBodySchema,
  type TransformedNewsItem,
  createStandardResponseSchema,
} from './schema';
import type { FetchAllPagesResult, FetchResult } from './schema';
import { getDateRange, getGeoParams, getTbsString, parseSerperDate, validateToken } from './utils';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

type Variables = {
  requestId: string;
  logger: Logger;
};

const app = new Hono<{ Variables: Variables; Bindings: Env }>();

app.use('*', async (c, next) => {
  try {
    const logger = createLogger(c.env);
    const requestId = crypto.randomUUID();
    const requestLogger = createRequestLogger(logger, requestId);
    c.set('requestId', requestId);
    c.set('logger', requestLogger);
    requestLogger.info('Request received', {
      method: c.req.method,
      path: c.req.path,
    });
    await next();
  } catch (error) {
    console.error('Error in logging middleware:', error);
    throw error;
  }
});

app.get('/', async (c) => {
  const logger = c.get('logger');
  logger.info('Root route accessed', {
    headers: Object.fromEntries(c.req.raw.headers.entries()),
  });
  return c.json({
    name: 'Early Studies Headlines Fetcher API',
    version: '1.0.0',
    documentation: '/docs',
    openapi: '/openapi',
  });
});

app.get('/favicon.ico', () => {
  return new Response(null, { status: 204 }); 
});

app.get(
  '/openapi',
  openAPISpecs(app, {
    documentation: {
      info: {
        title: 'Early Studies Headlines Fetcher API',
        version: '1.0.0',
        description: 'API for fetching news headlines for Early Studies. Uses a standard response envelope { data, success, error }.',
      },
      servers: [
        { url: 'http://localhost:8787', description: 'Local Development' },
        { url: 'https://your-worker.workers.dev', description: 'Production' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  })
);

app.get(
  '/docs',
  apiReference({
    theme: 'saturn',
    spec: { url: '/openapi' },
  })
);

// --- Authorization Middleware --- (Returns standard error format)
const authMiddleware = async (c: Context<{ Variables: Variables; Bindings: Env }>, next: Next) => {
  const logger = c.get('logger');
  const { missing, valid } = validateToken(
    c.req.header('Authorization'),
    `Bearer ${c.env.BEARER_TOKEN}`,
    logger
  );
  if (missing || !valid) {
    const status = missing ? 401 : 403;
    const code = missing ? 'AUTH_MISSING_TOKEN' : 'AUTH_INVALID_TOKEN';
    const message = missing ? 'Authorization token is missing' : 'Authorization token is invalid';
    logger.warn('Authentication failed', { message, status });
    // Set status first (cast to StatusCode), then return JSON
    c.status(status as StatusCode);
    return c.json({
       data: null,
       success: false,
       error: { message: message, code: code }
    });
  }
  await next();
};

// Updated helper function to return the standard error format
function handleDatabaseError(
  c: Context<{ Variables: Variables; Bindings: Env }>,
  error: unknown,
  defaultMessage = 'Database operation failed'
): Response { // Ensure it returns a Response
  const logger = c.get('logger');
  let statusCode = 500;
  let errorPayload: z.infer<typeof StandardErrorSchema> = { message: defaultMessage };

  if (error instanceof Error && error.name === 'DatabaseError') {
    const dbError = error as DatabaseError;
    logger.error('Database error', { message: dbError.message, details: dbError.details });

    errorPayload = {
      message: dbError.message,
      code: 'DB_OPERATION_FAILED',
      details: dbError.details ?? undefined,
    };

    if (dbError.message.includes('already exists')) {
      statusCode = 409;
      errorPayload.code = 'DB_CONFLICT';
    } else if (dbError.message.includes('not found')) {
      statusCode = 404;
      errorPayload.code = 'DB_NOT_FOUND';
    }

  } else if (error instanceof Error) {
     logger.error('Unexpected application error', { errorName: error.name, errorMessage: error.message, errorStack: error.stack });
     errorPayload = { message: error.message || defaultMessage, code: 'UNEXPECTED_ERROR' };
  } else {
    logger.error('Unexpected non-error thrown', { error });
    errorPayload = { message: defaultMessage, code: 'UNKNOWN_ERROR' };
  }

  // Set status first (cast to StatusCode), then return JSON
  c.status(statusCode as StatusCode);
  return c.json({
    data: null,
    success: false,
    error: errorPayload,
  });
}

// Helper function to parse DD/MM/YYYY string to Date object
function parseDdMmYyyy(dateString: string | undefined): Date | undefined {
  if (!dateString) return undefined;
  try {
    // Use date-fns parse for reliable parsing
    const parsed = parseDate(dateString, 'dd/MM/yyyy', new Date());
    // Optional: Add validation if parse doesn't throw for invalid dates in the format
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  } catch (e) {
    // Log parsing error if needed
    console.error(`Failed to parse date string: ${dateString}`, e);
    return undefined;
  }
}

// --- Database CRUD Endpoints ---

// --- Publications ---
app.post(
  '/publications/query',
  describeRoute({
    description: 'Get a list of publications using filters in the request body',
    tags: ['Database - Publications'],
    requestBody: {
      content: {
        'application/json': {
          schema: PublicationsQueryBodySchema,
        }
      }
    },
    responses: {
      200: {
        description: 'Successful query',
        content: {
          'application/json': {
            schema: PublicationsListResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500') } } },
    },
  }),
  zValidator('json', PublicationsQueryBodySchema),
  async (c) => {
    const filters = c.req.valid('json');
    try {
      const publications = await getPublications(c.env.DB, filters);
      return c.json({
        data: publications,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to fetch publications');
    }
  }
);

app.post(
  '/publications',
  authMiddleware,
  describeRoute({
    description: 'Create a new publication',
    tags: ['Database - Publications'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: InsertPublicationSchema,
          example: {
              name: "The Example Times",
              url: "https://example.com/news",
              category: "broadsheet"
          }
        },
      },
    },
    responses: {
      201: {
        description: 'Publication created successfully',
        content: {
          'application/json': {
            schema: SinglePublicationResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_PubCreate') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_PubCreate') } } },
      409: { description: 'Conflict - Publication already exists', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse409_PubCreate') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_PubCreate') } } },
    },
  }),
  zValidator('json', InsertPublicationSchema),
  async (c) => {
    const publicationData = c.req.valid('json');
    try {
      const [result] = await insertPublication(c.env.DB, publicationData);
      return c.json({
        data: result,
        success: true,
        error: null
      }, 201);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to insert publication');
    }
  }
);

app.put(
  '/publications/:id',
  authMiddleware,
  describeRoute({
    description: 'Update an existing publication by ID',
    tags: ['Database - Publications'],
    security: [{ bearerAuth: [] }],
     parameters: [{
        in: 'path',
        name: 'id',
        schema: { type: 'string' },
        required: true,
        description: 'ID of the publication to update'
    }],
    requestBody: {
      description: 'Publication data fields to update. The ID cannot be changed via this endpoint.',
      content: {
        'application/json': {
           schema: InsertPublicationSchema.partial(),
          example: {
              name: "The Updated Example Times",
              category: "tabloid"
          }
        },
      },
    },
    responses: {
      200: {
        description: 'Publication updated successfully',
        content: { 'application/json': { schema: SinglePublicationResponseSchema } }
      },
      400: { description: 'Bad Request (e.g., URL conflict)', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_PubUpdate') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_PubUpdate') } } },
      404: { description: 'Publication not found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_PubUpdate') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_PubUpdate') } } },
    },
  }),
  zValidator('json', InsertPublicationSchema.partial()),
  async (c) => {
    const publicationId = c.req.param('id');
    const updateData = c.req.valid('json');

     if (Object.keys(updateData).length === 0) {
        return c.json({
          data: null,
          success: false,
          error: { message: 'Request body cannot be empty for update', code: 'VALIDATION_ERROR' }
        }, 400);
    }

    try {
      const [result] = await updatePublication(c.env.DB, publicationId, updateData);
      return c.json({
        data: result,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update publication');
    }
  }
);

app.delete(
  '/publications',
  authMiddleware,
  describeRoute({
    description: 'Delete a publication using its ID provided in the request body',
    tags: ['Database - Publications'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: DeletePublicationBodySchema,
        }
      }
    },
    responses: {
      200: {
        description: 'Publication deleted successfully',
        content: {
          'application/json': {
            schema: SinglePublicationResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_PubDelete') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_PubDelete') } } },
      404: { description: 'Publication not found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_PubDelete') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_PubDelete') } } },
    },
  }),
  zValidator('json', DeletePublicationBodySchema),
  async (c) => {
    const { id } = c.req.valid('json');
    try {
      const [deleted] = await deletePublication(c.env.DB, id);
      if (!deleted) {
        return c.json({ error: 'Publication not found' }, 404);
      }
      return c.json({
        data: deleted,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to delete publication');
    }
  }
);

// --- Regions ---
app.get(
  '/regions',
  describeRoute({
    description: 'Get a list of all regions',
    tags: ['Database - Regions'],
    responses: {
      200: {
        description: 'Successful retrieval',
        content: {
          'application/json': {
            schema: RegionsListResponseSchema,
          },
        },
      },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionsGet') } } },
    },
  }),
  async (c) => {
    try {
      const regions = await getRegions(c.env.DB);
      return c.json({
        data: regions,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to fetch regions');
    }
  }
);

app.post(
  '/regions',
  authMiddleware,
  describeRoute({
    description: 'Create a new region',
    tags: ['Database - Regions'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: InsertRegionSchema,
          example: {
              name: "UK"
          }
        },
      },
    },
    responses: {
      201: {
        description: 'Region created successfully',
        content: {
          'application/json': {
            schema: SingleRegionResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_RegionCreate') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_RegionCreate') } } },
      409: { description: 'Conflict - Region already exists', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse409_RegionCreate') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionCreate') } } },
    },
  }),
  zValidator('json', InsertRegionSchema),
  async (c) => {
    const regionData = c.req.valid('json');
    try {
      const [result] = await insertRegion(c.env.DB, regionData);
      return c.json({
        data: RegionSchema.parse(result),
        success: true,
        error: null
      }, 201);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to insert region');
    }
  }
);

app.put(
  '/regions/:id',
  authMiddleware,
  describeRoute({
    description: 'Update an existing region by ID',
    tags: ['Database - Regions'],
    security: [{ bearerAuth: [] }],
     parameters: [{
        in: 'path',
        name: 'id',
        schema: { type: 'string' },
        required: true,
        description: 'ID of the region to update'
    }],
    requestBody: {
      description: 'Region data fields to update. The ID cannot be changed via this endpoint.',
      content: {
        'application/json': {
          schema: InsertRegionSchema.partial(),
          example: {
              name: "United Kingdom"
          }
        },
      },
    },
    responses: {
      200: {
        description: 'Region updated successfully',
        content: { 'application/json': { schema: SingleRegionResponseSchema } }
      },
      400: { description: 'Bad Request (e.g., name conflict)', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_RegionUpdate') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_RegionUpdate') } } },
      404: { description: 'Region not found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_RegionUpdate') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionUpdate') } } },
    },
  }),
  zValidator('json', InsertRegionSchema.partial()),
  async (c) => {
    const regionId = c.req.param('id');
    const updateData = c.req.valid('json');

    try {
      const [result] = await updateRegion(c.env.DB, regionId, updateData);
      return c.json({
        data: RegionSchema.parse(result),
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update region');
    }
  }
);

app.delete(
  '/regions',
  authMiddleware,
  describeRoute({
    description: 'Delete a region using its ID provided in the request body',
    tags: ['Database - Regions'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: DeleteRegionBodySchema,
        }
      }
    },
    responses: {
      200: {
        description: 'Region deleted successfully',
        content: {
          'application/json': {
            schema: SingleRegionResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_RegionDelete') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_RegionDelete') } } },
      404: { description: 'Region not found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_RegionDelete') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionDelete') } } },
    },
  }),
  zValidator('json', DeleteRegionBodySchema),
  async (c) => {
    const { id } = c.req.valid('json');
    try {
      const [deleted] = await deleteRegion(c.env.DB, id);
      if (!deleted) {
        return c.json({ error: 'Region not found' }, 404);
      }
      return c.json({
        data: RegionSchema.parse(deleted),
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to delete region');
    }
  }
);

// --- Headlines ---
app.post(
  '/headlines/query',
  describeRoute({
    description: 'Get a list of headlines using filters and pagination in the request body',
    tags: ['Database - Headlines'],
    requestBody: {
      content: {
        'application/json': {
          schema: HeadlinesQueryBodySchema,
        }
      }
    },
    responses: {
      200: {
        description: 'Successful query',
        content: {
          'application/json': {
            schema: HeadlinesQueryStdResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlQuery') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlQuery') } } },
    },
  }),
  zValidator('json', HeadlinesQueryBodySchema),
  async (c) => {
    const body = c.req.valid('json');
    const logger = c.get('logger');

    // Parse the DD/MM/YYYY date strings into Date objects
    const startDate = parseDdMmYyyy(body.startDate);
    const endDate = parseDdMmYyyy(body.endDate);

    if (body.startDate && !startDate) {
      logger.warn('Invalid start date format provided:', { startDate: body.startDate });
      return c.json({
        data: null,
        success: false,
        error: { message: 'Invalid start date format. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' }
      }, 400);
    }
    if (body.endDate && !endDate) {
      logger.warn('Invalid end date format provided:', { endDate: body.endDate });
      return c.json({
        data: null,
        success: false,
        error: { message: 'Invalid end date format. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' }
      }, 400);
    }
    
    const headlineFilters = {
      startDate: startDate, // Use parsed Date object
      endDate: endDate,     // Use parsed Date object
      categories: body.categories,
      page: body.page,
      pageSize: body.pageSize,
      publicationFilters: {
          category: body.publicationCategory,
          regionNames: body.publicationRegionNames,
      }
    };

    try {
      const headlines = await getHeadlines(c.env.DB, headlineFilters);
      return c.json({
        data: headlines,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to fetch headlines');
    }
  }
);

app.post(
  '/headlines',
  authMiddleware,
  describeRoute({
    description: 'Create a new headline',
    tags: ['Database - Headlines'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: InsertHeadlineSchema,
          example: {
              url: "https://example.com/news/article123",
              headline: "Example Headline Takes World by Storm",
              snippet: "An example snippet describing the headline.",
              source: "Example News Source",
              rawDate: "Jan 1, 2024",
              normalizedDate: "2024-01-01T12:00:00Z",
              category: "technology",
              publicationId: "https://example.com/news"
          }
        },
      },
    },
    responses: {
      201: {
        description: 'Headline created successfully',
        content: {
          'application/json': {
            schema: SingleHeadlineResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request / Publication Not Found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlCreate') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlCreate') } } },
      409: { description: 'Conflict - Headline URL already exists', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse409_HdlCreate') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlCreate') } } },
    },
  }),
  zValidator('json', InsertHeadlineSchema),
  async (c) => {
    const headlineData = c.req.valid('json');
    try {
      const [result] = await insertHeadline(c.env.DB, headlineData);
      return c.json({
        data: result,
        success: true,
        error: null
      }, 201);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to insert headline');
    }
  }
);

app.put(
  '/headlines/:id',
  authMiddleware,
  describeRoute({
    description: 'Update an existing headline by its internal ID',
    tags: ['Database - Headlines'],
    security: [{ bearerAuth: [] }],
     parameters: [{
        in: 'path',
        name: 'id',
        schema: { type: 'string' },
        required: true,
        description: 'Internal ID of the headline to update'
    }],
    requestBody: {
      description: 'Headline data fields to update. The ID and URL cannot be changed via this endpoint.',
      content: {
        'application/json': {
          schema: InsertHeadlineSchema.partial().omit({ url: true }),
          example: {
              headline: "Updated: Example Headline Takes World by Storm",
              snippet: "An updated snippet.",
              category: "business",
          }
        },
      },
    },
    responses: {
      200: {
        description: 'Headline updated successfully',
        content: { 'application/json': { schema: SingleHeadlineResponseSchema } }
      },
      400: { description: 'Bad Request (e.g., invalid data, publication not found, URL conflict)', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlUpdate') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlUpdate') } } },
      404: { description: 'Headline not found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_HdlUpdate') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlUpdate') } } },
    },
  }),
  zValidator('json', InsertHeadlineSchema.partial().omit({ url: true })),
  async (c) => {
    const headlineId = c.req.param('id');
    const updateData = c.req.valid('json');

     if (Object.keys(updateData).length === 0) {
        return c.json({
          data: null,
          success: false,
          error: { message: 'Request body cannot be empty for update', code: 'VALIDATION_ERROR' }
        }, 400);
    }

    try {
      const [result] = await updateHeadlineById(c.env.DB, headlineId, updateData);
      return c.json({
        data: result,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update headline');
    }
  }
);

app.delete(
  '/headlines',
  authMiddleware,
  describeRoute({
    description: 'Delete a headline using its ID provided in the request body',
    tags: ['Database - Headlines'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: DeleteHeadlineBodySchema,
        }
      }
    },
    responses: {
      200: {
        description: 'Headline deleted successfully',
        content: {
          'application/json': {
            schema: SingleHeadlineResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlDelete') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlDelete') } } },
      404: { description: 'Headline not found', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_HdlDelete') } } },
      500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlDelete') } } },
    },
  }),
  zValidator('json', DeleteHeadlineBodySchema),
  async (c) => {
    const { id } = c.req.valid('json');
    try {
      const [deleted] = await deleteHeadline(c.env.DB, id);
      if (!deleted) {
        return c.json({ error: 'Headline not found' }, 404);
      }
      return c.json({
        data: deleted,
        success: true,
        error: null
      }, 200);
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to delete headline');
    }
  }
);

app.post(
  '/headlines/fetch',
  authMiddleware,
  describeRoute({
    description: 'Fetch news headlines from one or more publications via Serper API',
    tags: ['Headlines Fetcher'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: resolver(HeadlinesFetchRequestSchema),
          example: {
            publicationUrls: ['https://bbc.co.uk'],
            region: 'UK',
            dateRangeOption: 'Past Week',
            maxQueriesPerPublication: 5,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful fetch operation',
        content: {
          'application/json': {
            schema: HeadlinesFetchStdResponseSchema,
          },
        },
      },
      400: { description: 'Bad Request', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlFetch') } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlFetch') } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse403_HdlFetch') } } },
      500: { description: 'Internal Server Error / Fetch Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlFetch') } } },
    },
  }),
  zValidator('json', HeadlinesFetchRequestSchema),
  async (c) => {
    const {dateRangeOption, customTbs, region, publicationUrls, maxQueriesPerPublication, flattenResults} = c.req.valid('json');
    const logger = c.get('logger');

    if (!c.env.SERPER_API_KEY) {
      const error = new Error('SERPER_API_KEY environment variable is not set');
      logger.error('Environment configuration error', { error });
      return c.json({
        data: null,
        success: false,
        error: { message: 'Server configuration error: API key missing.', code: 'CONFIG_ERROR' }
      }, 500);
    }

    const dateRange = getDateRange(dateRangeOption);

    try {
      const fetchPublicationWithLimit = (url: string) => 
        fetchAllPagesForUrl(
          url,
          getTbsString(dateRangeOption, customTbs),
          getGeoParams(region),
          c.env.SERPER_API_KEY,
          maxQueriesPerPublication,
          logger
        );

      const publicationPromises = publicationUrls.map(url => 
        publicationLimit(() => fetchPublicationWithLimit(url))
      );
      
      const results: FetchResult[] = await Promise.all(
        publicationPromises.map(async (resultPromise) => {
          const result: FetchAllPagesResult = await resultPromise;

          if (result.error) {
            return {
              status: 'rejected',
              url: result.url,
              queriesMade: result.queriesMade,
              creditsConsumed: result.credits,
              results: [],
              reason: result.error.message,
            };
          }

          return {
            status: 'fulfilled',
            url: result.url,
            queriesMade: result.queriesMade,
            creditsConsumed: result.credits,
            results: result.results.map((item) => {
              const parsedDate = parseSerperDate(item.date);
              return {
                headline: item.title,
                publicationUrl: result.url,
                url: item.link,
                snippet: item.snippet,
                source: item.source,
                rawDate: item.date,
                normalizedDate: parsedDate ? parsedDate.toLocaleDateString('en-GB') : null
              };
            }),
          };
        })
      );

      let totalItemsBeforeFiltering = 0;
      let totalItemsAfterFiltering = 0;

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const initialCount = result.results.length;
          totalItemsBeforeFiltering += initialCount;

          result.results = result.results.filter((item: TransformedNewsItem) => {
            const parsedDate = parseSerperDate(item.rawDate);
            const keep = parsedDate && isWithinInterval(parsedDate, dateRange);
            if (!keep && parsedDate) {
              logger.debug({ 
                headline: item.headline, 
                rawDate: item.rawDate, 
                parsedDate: parsedDate.toISOString(),
                rangeStart: dateRange.start.toISOString(),
                rangeEnd: dateRange.end.toISOString(), 
              }, 'Filtering result: Outside date range');
            } else if (!parsedDate) {
              logger.debug({ 
                headline: item.headline, 
                rawDate: item.rawDate 
              }, 'Filtering result: Could not parse date');
            }
            return keep; 
          });

          const finalCount = result.results.length;
          totalItemsAfterFiltering += finalCount;
        }
      }

      const filteredOutCount = totalItemsBeforeFiltering - totalItemsAfterFiltering;
      if (filteredOutCount > 0) {
        logger.info(
          { filteredOutCount, totalItemsBeforeFiltering, totalItemsAfterFiltering },
          `Filtered out ${filteredOutCount} results based on publication date.`
        );
      }

      const totalResults = results.reduce((acc, curr) => acc + curr.results.length, 0);
      const totalCreditsConsumed = results.reduce((acc, curr) => acc + curr.creditsConsumed, 0);
      const totalQueriesMade = results.reduce((acc, curr) => acc + curr.queriesMade, 0);
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failureCount = results.filter((r) => r.status === 'rejected').length;

      logger.info('Search completed successfully', {
        totalResults,
        totalCreditsConsumed,
        totalQueriesMade,
        successCount,
        failureCount,
        resultsPerPublication: results.map((r) => ({
          url: r.url,
          resultCount: r.results.length,
          queriesMade: r.queriesMade,
          creditsConsumed: r.creditsConsumed,
          status: r.status,
          results:
            r.status === 'fulfilled'
              ? r.results.map((item) => ({
                  headline: item.headline,
                  url: item.url,
                }))
              : [],
        })),
      });

      const finalResults = flattenResults ? results.flatMap((r) => r.results) : results;

      return c.json({
        data: {
          results: finalResults,
          summary: {
            totalResults,
            totalCreditsConsumed,
            totalQueriesMade,
            successCount,
            failureCount,
          },
        },
        success: true,
        error: null
      }, 200);
    } catch (error) {
      logger.error('Search failed', { error });
      return c.json({
        data: null,
        success: false,
        error: { message: 'Failed to fetch news articles', code: 'FETCH_FAILED', details: error instanceof Error ? error.message : String(error) }
      }, 500);
    }
  }
);

// --- Statistics Endpoints ---

app.post(
  '/stats/headlines',
  describeRoute({
    description: 'Get statistics about headlines within a date range.',
    tags: ['Statistics'],
    requestBody: {
      content: { 'application/json': { schema: StatsQueryBodySchema } }
    },
    responses: {
       200: {
         description: 'Successful statistics query',
         content: { 'application/json': { schema: HeadlinesStatsResponseSchema } },
       },
       400: { description: 'Bad Request (Invalid Date Format)', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_Stats') } } },
       500: { description: 'Internal Server Error', content: { 'application/json': { schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_Stats') } } },
    },
  }),
  zValidator('json', StatsQueryBodySchema),
  async (c) => {
    const body = c.req.valid('json');
    const logger = c.get('logger');

    const startDate = parseDdMmYyyy(body.startDate);
    const endDate = parseDdMmYyyy(body.endDate);

    // Validate dates
    if (!startDate) {
      logger.warn('Invalid start date format provided:', { startDate: body.startDate });
      c.status(400);
      return c.json({
         data: null,
         success: false,
         error: { message: 'Invalid start date format. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' }
       });
    }
    if (!endDate) {
      logger.warn('Invalid end date format provided:', { endDate: body.endDate });
       c.status(400);
       return c.json({
         data: null,
         success: false,
         error: { message: 'Invalid end date format. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' }
       });
    }
    if (startDate > endDate) {
       c.status(400);
        return c.json({
          data: null,
          success: false,
          error: { message: 'Start date cannot be after end date.', code: 'VALIDATION_ERROR' }
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
      const publicationCounts = rawStats.publicationCounts.map(item => ({
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
        .filter((item): item is { normalizedDate: string; count: number } => item.normalizedDate !== null)
        .map(item => ({
            date: item.normalizedDate,
            count: item.count,
        }));

      const statsData = {
        categoryPercentage,
        publicationCounts,
        dailyCounts,
      };

      // Return standard success response
      return c.json({
        data: statsData,
        success: true,
        error: null
      }, 200);

    } catch (error) {
      // Use the standard DB error handler
      return handleDatabaseError(c, error, 'Failed to fetch headline statistics');
    }
  }
);

app.onError((err, c) => {
  const logger = c.get('logger');
  let statusCode = 500;
  let errorPayload: z.infer<typeof StandardErrorSchema> = {
    message: 'Internal Server Error',
    code: 'INTERNAL_SERVER_ERROR',
  };

  if (err instanceof ZodError) {
    statusCode = 400;
    errorPayload = {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.flatten(),
    };
    logger.warn('Validation error', { path: c.req.path, method: c.req.method, errors: err.flatten() });
  } else if (err instanceof HTTPException) {
    statusCode = err.status;
    errorPayload = { message: err.message, code: `HTTP_${statusCode}` };
     logger.error('HTTP exception', { status: err.status, message: err.message, stack: err.stack });
  } else if (err instanceof Error) {
     errorPayload = { message: err.message, code: 'UNHANDLED_EXCEPTION', details: err.stack };
     logger.error('Unhandled application error', { errorName: err.name, errorMessage: err.message, errorStack: err.stack });
  } else {
    errorPayload = { message: 'An unknown error occurred', code: 'UNKNOWN_ERROR', details: String(err) };
    logger.error('Unknown error thrown', { error: err });
  }

  // Set status first (cast to StatusCode), then return JSON
  c.status(statusCode as StatusCode);
  return c.json({
    data: null,
    success: false,
    error: errorPayload,
  });
});

export default app;

// Define the Workflow parameters
type ProcessNewsItemParams = {
  headlineUrl: string;
  // Add other parameters needed for processing
};

// Define the Workflow class
export class ProcessNewsItemWorkflow extends WorkflowEntrypoint<Env, ProcessNewsItemParams> {
  async run(event: WorkflowEvent<ProcessNewsItemParams>, step: WorkflowStep) {
    console.log("Starting ProcessNewsItemWorkflow for:", event.payload.headlineUrl);

    const existingRecord = await step.do('check database for existing record', async () => {
      console.log('Checking database for:', event.payload.headlineUrl);
      // In a real scenario, query this.env.DB
      // const record = await this.env.DB.prepare('SELECT * FROM headlines WHERE url = ?').bind(event.payload.headlineUrl).first();
      // return { exists: !!record };
      return { exists: false }; // Placeholder
    });

    if (existingRecord.exists) {
      console.log('Record already exists, skipping further processing for:', event.payload.headlineUrl);
      return; // Exit the workflow if the record exists
    }

    const analysisResult = await step.do('analyze and tag headline', async () => {
      console.log('Analyzing and tagging headline:', event.payload.headlineUrl);
      // In a real scenario, perform analysis (e.g., using Workers AI)
      // return { tags: ['example-tag'], sentiment: 'neutral' };
      return { tags: [], sentiment: null }; // Placeholder
    });

    await step.do('store headline in db', async () => {
      console.log('Storing headline in DB:', event.payload.headlineUrl);
      // In a real scenario, insert into this.env.DB using data from previous steps
      // await this.env.DB.prepare('INSERT INTO headlines (url, tags, sentiment) VALUES (?, ?, ?)')
      //  .bind(event.payload.headlineUrl, JSON.stringify(analysisResult.tags), analysisResult.sentiment)
      //  .run();
      console.log(
        'Placeholder: Headline stored for', 
        event.payload.headlineUrl, 
        'with analysis:', 
        analysisResult
      );
    });

    console.log("Finished ProcessNewsItemWorkflow for:", event.payload.headlineUrl);
  }
}

