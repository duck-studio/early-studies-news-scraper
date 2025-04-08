import { Hono } from 'hono';
import { validator as zValidator } from 'hono-openapi/zod';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { 
  DeleteRegionBodySchema, 
  InsertRegionSchema, 
  RegionsListResponseSchema, 
  SingleRegionResponseSchema, 
  RegionSchema,
  createStandardResponseSchema 
} from '../schema';

import { 
  deleteRegion, 
  getRegions, 
  insertRegion, 
  updateRegion 
} from '../db/queries';

import { 
  authMiddleware, 
  handleDatabaseError, 
  validateNonEmptyBody 
} from '../middleware';

// Create a router for regions
const regionsRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Get all regions
regionsRouter.get(
  '/',
  authMiddleware,
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
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionsGet'),
          },
        },
      },
    },
  }),
  async (c) => {
    try {
      const regions = await getRegions(c.env.DB);
      return c.json(
        {
          data: regions,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to fetch regions');
    }
  }
);

// Create a new region
regionsRouter.post(
  '/',
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
            name: 'UK',
          },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_RegionCreate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_RegionCreate'),
          },
        },
      },
      409: {
        description: 'Conflict - Region already exists',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse409_RegionCreate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionCreate'),
          },
        },
      },
    },
  }),
  zValidator('json', InsertRegionSchema),
  async (c) => {
    const regionData = c.req.valid('json');
    try {
      const [result] = await insertRegion(c.env.DB, regionData);
      return c.json(
        {
          data: RegionSchema.parse(result),
          success: true,
          error: null,
        },
        201
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to insert region');
    }
  }
);

// Update a region
regionsRouter.put(
  '/:id',
  authMiddleware,
  validateNonEmptyBody(),
  describeRoute({
    description: 'Update an existing region by ID',
    tags: ['Database - Regions'],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: 'path',
        name: 'id',
        schema: { type: 'string' },
        required: true,
        description: 'ID of the region to update',
      },
    ],
    requestBody: {
      description: 'Region data fields to update. The ID cannot be changed via this endpoint.',
      content: {
        'application/json': {
          schema: InsertRegionSchema.partial(),
          example: {
            name: 'United Kingdom',
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Region updated successfully',
        content: { 'application/json': { schema: SingleRegionResponseSchema } },
      },
      400: {
        description: 'Bad Request (e.g., name conflict)',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_RegionUpdate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_RegionUpdate'),
          },
        },
      },
      404: {
        description: 'Region not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_RegionUpdate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionUpdate'),
          },
        },
      },
    },
  }),
  zValidator('json', InsertRegionSchema.partial()),
  async (c) => {
    const regionId = c.req.param('id');
    const updateData = c.req.valid('json');

    try {
      const [result] = await updateRegion(c.env.DB, regionId, updateData);
      return c.json(
        {
          data: RegionSchema.parse(result),
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update region');
    }
  }
);

// Delete a region
regionsRouter.delete(
  '/',
  authMiddleware,
  describeRoute({
    description: 'Delete a region using its ID provided in the request body',
    tags: ['Database - Regions'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        'application/json': {
          schema: DeleteRegionBodySchema,
        },
      },
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
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_RegionDelete'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_RegionDelete'),
          },
        },
      },
      404: {
        description: 'Region not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_RegionDelete'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_RegionDelete'),
          },
        },
      },
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
      return c.json(
        {
          data: RegionSchema.parse(deleted),
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to delete region');
    }
  }
);

export default regionsRouter;