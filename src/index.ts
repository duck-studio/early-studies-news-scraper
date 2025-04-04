import { zValidator } from '@hono/zod-validator';
import { apiReference } from '@scalar/hono-api-reference';
import { isWithinInterval } from 'date-fns';
import { Hono } from 'hono';
import { describeRoute, openAPISpecs } from 'hono-openapi';
import { resolver } from 'hono-openapi/zod';
import type { Logger } from 'pino';
import { fetchAllPagesForUrl, publicationLimit } from './fetcher';
import { createLogger, createRequestLogger } from './logger';
import {
  ErrorResponseSchema,
  HeadlinesFetchRequestSchema,
  HeadlinesFetchResponseSchema,
  type TransformedNewsItem,
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
  try {
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
  } catch (error) {
    const logger = c.get('logger');
    logger.error('Error in root route:', error);
    throw error;
  }
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
        description: 'API for fetching news headlines for Early Studies',
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

app.post(
  '/headlines/fetch',
  async (c, next) => {
    const logger = c.get('logger');
    const {missing, valid} = validateToken(c.req.header('Authorization'), `Bearer ${c.env.BEARER_TOKEN}`, logger);
    if (missing) {
      return c.json({ error: 'Missing bearer token' }, 401);
    }
    if (!valid) {
      return c.json({ error: 'Invalid bearer token' }, 401);
    }
    await next();
  },
  describeRoute({
    description: 'Fetch news headlines from one or more publications',
    tags: ['Headlines'],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
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
    },
    responses: {
      200: {
        description: 'Successful search results',
        content: {
          'application/json': {
            schema: resolver(HeadlinesFetchResponseSchema),
          },
        },
      },
      401: {
        description: 'Unauthorized - Invalid or missing bearer token',
        content: {
          'application/json': {
            schema: resolver(ErrorResponseSchema),
          },
        },
      },
      500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: resolver(ErrorResponseSchema),
          },
        },
      },
    },
  }),
  zValidator('json', HeadlinesFetchRequestSchema),
  async (c) => {
    const logger = c.get('logger');
    const {dateRangeOption, customTbs, region, publicationUrls, maxQueriesPerPublication, flattenResults} = c.req.valid('json');

    if (!c.env.SERPER_API_KEY) {
      const error = new Error('SERPER_API_KEY environment variable is not set');
      logger.error('Environment configuration error', { error });
      throw error;
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
                publicationDate: item.date,
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
            const parsedDate = parseSerperDate(item.publicationDate);
            const keep = parsedDate && isWithinInterval(parsedDate, dateRange);
            if (!keep && parsedDate) {
              logger.debug({ 
                headline: item.headline, 
                publicationDate: item.publicationDate, 
                parsedDate: parsedDate.toISOString(),
                rangeStart: dateRange.start.toISOString(),
                rangeEnd: dateRange.end.toISOString(), 
              }, 'Filtering result: Outside date range');
            } else if (!parsedDate) {
              logger.debug({ 
                headline: item.headline, 
                publicationDate: item.publicationDate 
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
        results: finalResults,
        summary: {
          totalResults,
          totalCreditsConsumed,
          totalQueriesMade,
          successCount,
          failureCount,
        },
      });
    } catch (error) {
      const logger = c.get('logger');
      logger.error('Search failed', { error });
      return c.json({ error: 'Failed to fetch news articles' }, 500);
    }
  }
);

app.onError((err, c) => {
  const logger = c.get('logger');
  logger.error('Unhandled error', {
    error: err,
    errorName: err.name,
    errorMessage: err.message,
    errorStack: err.stack,
    requestPath: c.req.path,
    requestMethod: c.req.method,
    requestHeaders: Object.fromEntries(c.req.raw.headers.entries()),
  });
  return c.json({ error: 'Internal server error' }, 500);
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
