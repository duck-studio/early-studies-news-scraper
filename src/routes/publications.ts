import { Hono } from 'hono';
import { validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { 
  DeletePublicationBodySchema, 
  InsertPublicationSchema, 
  PublicationsListResponseSchema, 
  PublicationsQueryBodySchema, 
  SinglePublicationResponseSchema, 
  createStandardResponseSchema 
} from '../schema';

import { 
  deletePublication, 
  getPublications, 
  insertPublication, 
  updatePublication 
} from '../db/queries';

import { 
  authMiddleware, 
  handleDatabaseError, 
  validateNonEmptyBody 
} from '../middleware';

// Create a router for publications
const publicationsRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Query publications
publicationsRouter.post(
  '/query',
  authMiddleware,
  describeRoute({
    description: 'Get a list of publications using filters in the request body',
    tags: ['Database - Publications'],
    requestBody: {
      content: {
        'application/json': {
          schema: PublicationsQueryBodySchema,
        },
      },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500'),
          },
        },
      },
    },
  }),
  zValidator('json', PublicationsQueryBodySchema),
  async (c) => {
    const filters = c.req.valid('json');
    try {
      const publications = await getPublications(c.env.DB, filters);
      return c.json(
        {
          data: publications,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to fetch publications');
    }
  }
);

// Create a new publication
publicationsRouter.post(
  '/',
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
            name: 'The Example Times',
            url: 'https://example.com/news',
            category: 'broadsheet',
          },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_PubCreate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_PubCreate'),
          },
        },
      },
      409: {
        description: 'Conflict - Publication already exists',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse409_PubCreate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_PubCreate'),
          },
        },
      },
    },
  }),
  zValidator('json', InsertPublicationSchema),
  async (c) => {
    const publicationData = c.req.valid('json');
    try {
      const [result] = await insertPublication(c.env.DB, publicationData);
      return c.json(
        {
          data: result,
          success: true,
          error: null,
        },
        201
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to insert publication');
    }
  }
);

// Update a publication
publicationsRouter.put(
  '/:id',
  authMiddleware,
  validateNonEmptyBody(),
  describeRoute({
    description: 'Update an existing publication by ID',
    tags: ['Database - Publications'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: 'path',
        name: 'id',
        schema: { type: 'string' },
        required: true,
        description: 'ID of the publication to update',
      },
    ],
    requestBody: {
      description: 'Publication data fields to update. The ID cannot be changed via this endpoint.',
      content: {
        'application/json': {
          schema: InsertPublicationSchema.partial(),
          example: {
            name: 'The Updated Example Times',
            category: 'tabloid',
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Publication updated successfully',
        content: { 'application/json': { schema: SinglePublicationResponseSchema } },
      },
      400: {
        description: 'Bad Request (e.g., URL conflict)',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_PubUpdate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_PubUpdate'),
          },
        },
      },
      404: {
        description: 'Publication not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_PubUpdate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_PubUpdate'),
          },
        },
      },
    },
  }),
  zValidator('json', InsertPublicationSchema.partial()),
  async (c) => {
    const publicationId = c.req.param('id');
    const updateData = c.req.valid('json');

    try {
      const [result] = await updatePublication(c.env.DB, publicationId, updateData);
      return c.json(
        {
          data: result,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update publication');
    }
  }
);

// Delete a publication
publicationsRouter.delete(
  '/',
  authMiddleware,
  describeRoute({
    description: 'Delete a publication using its ID provided in the request body',
    tags: ['Database - Publications'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: DeletePublicationBodySchema,
        },
      },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_PubDelete'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_PubDelete'),
          },
        },
      },
      404: {
        description: 'Publication not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_PubDelete'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_PubDelete'),
          },
        },
      },
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
      return c.json(
        {
          data: deleted,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to delete publication');
    }
  }
);

export default publicationsRouter;