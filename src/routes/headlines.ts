import { Hono } from 'hono';
import { validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { 
  DeleteHeadlineBodySchema, 
  HeadlinesQueryBodySchema, 
  HeadlinesQueryStdResponseSchema, 
  InsertHeadlineSchema, 
  SingleHeadlineResponseSchema, 
  createStandardResponseSchema 
} from '../schema';

import { 
  getHeadlines, 
  deleteHeadline,
  insertHeadline, 
  updateHeadlineById 
} from '../db/queries';

import { 
  authMiddleware, 
  handleDatabaseError, 
  validateNonEmptyBody, 
  validateAndParseDateRange 
} from '../middleware';

// Create a router for headlines
const headlinesRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Query headlines
headlinesRouter.post(
  '/query',
  authMiddleware,
  describeRoute({
    description: 'Get a list of headlines using filters and pagination in the request body',
    tags: ['Database - Headlines'],
    requestBody: {
      content: {
        'application/json': {
          schema: HeadlinesQueryBodySchema,
        },
      },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlQuery'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlQuery'),
          },
        },
      },
    },
  }),
  zValidator('json', HeadlinesQueryBodySchema),
  async (c) => {
    const body = c.req.valid('json');

    // Parse and validate dates using the helper
    const parsedDates = validateAndParseDateRange(c, body);
    if (parsedDates === null) {
      return c.res; // Response already set by the helper
    }
    
    // Destructure potentially undefined dates
    const { startDate, endDate } = parsedDates;

    const headlineFilters = {
      startDate: startDate, // Pass potentially undefined date
      endDate: endDate, // Pass potentially undefined date
      categories: body.categories,
      page: body.page,
      pageSize: body.pageSize,
      publicationFilters: {
        category: body.publicationCategory,
        regionNames: body.publicationRegionNames,
      },
    };

    try {
      const headlines = await getHeadlines(c.env.DB, headlineFilters);
      return c.json(
        {
          data: headlines,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to fetch headlines');
    }
  }
);

// Create a new headline
headlinesRouter.post(
  '/',
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
            url: 'https://example.com/news/article123',
            headline: 'Example Headline Takes World by Storm',
            snippet: 'An example snippet describing the headline.',
            source: 'Example News Source',
            rawDate: 'Jan 1, 2024',
            normalizedDate: '2024-01-01T12:00:00Z',
            category: 'technology',
            publicationId: 'https://example.com/news',
          },
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
      400: {
        description: 'Bad Request / Publication Not Found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlCreate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlCreate'),
          },
        },
      },
      409: {
        description: 'Conflict - Headline URL already exists',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse409_HdlCreate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlCreate'),
          },
        },
      },
    },
  }),
  zValidator('json', InsertHeadlineSchema),
  async (c) => {
    const headlineData = c.req.valid('json');
    try {
      const [result] = await insertHeadline(c.env.DB, headlineData);
      return c.json(
        {
          data: result,
          success: true,
          error: null,
        },
        201
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to insert headline');
    }
  }
);

// Update a headline
headlinesRouter.put(
  '/:id',
  authMiddleware,
  validateNonEmptyBody(),
  describeRoute({
    description: 'Update an existing headline by its internal ID',
    tags: ['Database - Headlines'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: 'path',
        name: 'id',
        schema: { type: 'string' },
        required: true,
        description: 'Internal ID of the headline to update',
      },
    ],
    requestBody: {
      description:
        'Headline data fields to update. The ID and URL cannot be changed via this endpoint.',
      content: {
        'application/json': {
          schema: InsertHeadlineSchema.partial().omit({ url: true }),
          example: {
            headline: 'Updated: Example Headline Takes World by Storm',
            snippet: 'An updated snippet.',
            category: 'business',
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Headline updated successfully',
        content: { 'application/json': { schema: SingleHeadlineResponseSchema } },
      },
      400: {
        description: 'Bad Request (e.g., invalid data, publication not found, URL conflict)',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlUpdate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlUpdate'),
          },
        },
      },
      404: {
        description: 'Headline not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_HdlUpdate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlUpdate'),
          },
        },
      },
    },
  }),
  zValidator('json', InsertHeadlineSchema.partial().omit({ url: true })),
  async (c) => {
    const headlineId = c.req.param('id');
    const updateData = c.req.valid('json');

    try {
      const [result] = await updateHeadlineById(c.env.DB, headlineId, updateData);
      return c.json(
        {
          data: result,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update headline');
    }
  }
);

// Delete a headline
headlinesRouter.delete(
  '/',
  authMiddleware,
  describeRoute({
    description: 'Delete a headline using its ID provided in the request body',
    tags: ['Database - Headlines'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: DeleteHeadlineBodySchema,
        },
      },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_HdlDelete'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_HdlDelete'),
          },
        },
      },
      404: {
        description: 'Headline not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_HdlDelete'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_HdlDelete'),
          },
        },
      },
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
      return c.json(
        {
          data: deleted,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to delete headline');
    }
  }
);

export default headlinesRouter;