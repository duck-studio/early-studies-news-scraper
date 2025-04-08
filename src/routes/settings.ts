import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { validator as zValidator } from 'hono-openapi/zod';
import { z } from 'zod';

import { type UpsertSettings, getSettings, upsertSettings } from '../db/queries';
import { syncFrequencyOptions } from '../db/schema';
import { authMiddleware, handleDatabaseError } from '../middleware';
import { createStandardResponseSchema } from '../schema';

// --- Schemas ---
export const SettingsResponseSchema = z.object({
  id: z.number().int().default(1),
  syncEnabled: z.boolean(),
  syncFrequency: z.enum(syncFrequencyOptions),
  defaultRegion: z.string(),
  serperApiKey: z.string().nullable().optional(),
  createdAt: z.number().int().optional(),
  updatedAt: z.number().int().optional(),
});

export const SettingsUpdateSchema = z.object({
  syncEnabled: z.boolean().optional(),
  syncFrequency: z.enum(syncFrequencyOptions).optional(),
  defaultRegion: z.string().min(2).max(50).optional(),
  serperApiKey: z.string().min(32).max(100).optional().nullable(),
});

export const SettingsStdResponseSchema = createStandardResponseSchema(
  SettingsResponseSchema,
  'SettingsResponse'
);

export const SettingsUpdateStdResponseSchema = createStandardResponseSchema(
  SettingsResponseSchema,
  'SettingsUpdateResponse'
);

// --- Router ---
const settingsRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// GET Settings
settingsRouter.get(
  '/',
  describeRoute({
    description: 'Get application settings',
    tags: ['Settings'],
    responses: {
      200: {
        description: 'Application settings retrieved successfully',
        content: { 'application/json': { schema: SettingsStdResponseSchema } },
      },
      404: {
        description: 'Settings not found',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse404_Settings'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_Settings'),
          },
        },
      },
    },
  }),
  async (c) => {
    const _logger = c.get('logger');
    try {
      const settings = await getSettings(c.env.DB);

      if (!settings) {
        return c.json(
          {
            data: null,
            success: false,
            error: { message: 'Settings not found', code: 'NOT_FOUND' },
          },
          404
        );
      }

      return c.json(
        {
          data: settings,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to retrieve application settings');
    }
  }
);

// Update Settings
settingsRouter.put(
  '/',
  authMiddleware,
  describeRoute({
    description: 'Update application settings',
    tags: ['Settings'],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: { 'application/json': { schema: SettingsUpdateSchema } },
    },
    responses: {
      200: {
        description: 'Settings updated successfully',
        content: { 'application/json': { schema: SettingsUpdateStdResponseSchema } },
      },
      400: {
        description: 'Invalid input',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse400_SettingsUpdate'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse401_SettingsUpdate'),
          },
        },
      },
      500: {
        description: 'Internal Server Error',
        content: {
          'application/json': {
            schema: createStandardResponseSchema(z.null(), 'ErrorResponse500_SettingsUpdate'),
          },
        },
      },
    },
  }),
  zValidator('json', SettingsUpdateSchema),
  async (c) => {
    const _logger = c.get('logger');
    const updateData = c.req.valid('json');

    try {
      const updated = await upsertSettings(c.env.DB, updateData as UpsertSettings);

      _logger.info('Application settings updated', { settings: updated });

      return c.json(
        {
          data: updated,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      return handleDatabaseError(c, error, 'Failed to update application settings');
    }
  }
);

export default settingsRouter;
