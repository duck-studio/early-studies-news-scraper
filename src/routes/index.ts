import { apiReference } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { openAPISpecs } from 'hono-openapi';
import { HTTPException } from 'hono/http-exception';
import { StatusCode } from 'hono/utils/http-status';
import { ZodError, z } from 'zod';

import { createLogger, createRequestLogger } from '../logger';
import { StandardErrorSchema } from '../schema';
import fetchRouter from './fetch';
import headlinesRouter from './headlines';
import publicationsRouter from './publications';
import regionsRouter from './regions';
import serperRouter from './serper';
import settingsRouter from './settings';
import statsRouter from './stats';
import syncRouter from './sync';

/**
 * Creates a main application router with all sub-routes
 */
export function createAppRouter() {
  const app = new Hono<{ Variables: Variables; Bindings: Env }>();

  // Logging middleware
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

  // API root route
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

  // Favicon route
  app.get('/favicon.ico', () => {
    return new Response(null, { status: 204 });
  });

  // Register OpenAPI specs
  app.get(
    '/openapi',
    openAPISpecs(app, {
      documentation: {
        info: {
          title: 'Early Studies Headlines Fetcher API',
          version: '1.0.0',
          description:
            'API for fetching news headlines for Early Studies. Uses a standard response envelope { data, success, error }.',
        },
        servers: [
          { url: 'http://localhost:8787', description: 'Local Development' },
          { url: 'https://api.earlystudies.com', description: 'Production' },
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

  // API documentation
  app.get(
    '/docs',
    apiReference({
      theme: 'saturn',
      spec: { url: '/openapi' },
    })
  );

  // Mount all the routers
  app.route('/publications', publicationsRouter);
  app.route('/regions', regionsRouter);
  app.route('/headlines', headlinesRouter);
  app.route('/settings', settingsRouter);
  app.route('/stats', statsRouter);
  app.route('/serper', serperRouter);
  app.route('/', fetchRouter); // Routes like /headlines/fetch
  app.route('/sync', syncRouter);

  // Global error handler
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
      logger.warn('Validation error', {
        path: c.req.path,
        method: c.req.method,
        errors: err.flatten(),
      });
    } else if (err instanceof HTTPException) {
      statusCode = err.status;
      errorPayload = { message: err.message, code: `HTTP_${statusCode}` };
      logger.error('HTTP exception', {
        status: err.status,
        message: err.message,
        stack: err.stack,
      });
    } else if (err instanceof Error) {
      errorPayload = { message: err.message, code: 'UNHANDLED_EXCEPTION', details: err.stack };
      logger.error('Unhandled application error', {
        errorName: err.name,
        errorMessage: err.message,
        errorStack: err.stack,
      });
    } else {
      errorPayload = {
        message: 'An unknown error occurred',
        code: 'UNKNOWN_ERROR',
        details: String(err),
      };
      logger.error('Unknown error thrown', { error: err });
    }

    c.status(statusCode as StatusCode);
    return c.json({
      data: null,
      success: false,
      error: errorPayload,
    });
  });

  return app;
}

// Export routers for direct access
export {
  fetchRouter,
  headlinesRouter,
  publicationsRouter,
  regionsRouter,
  serperRouter,
  settingsRouter,
  syncRouter,
  statsRouter,
};
