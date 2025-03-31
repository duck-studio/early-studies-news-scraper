import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createLogger, createRequestLogger } from "./logger";
import { 
  SearchRequestSchema, 
  SearchResponseSchema, 
  ErrorResponseSchema 
} from "./schema";
import { fetchAllPagesForUrl } from "./fetcher";
import type { FetchResult, FetchAllPagesResult } from "./schema";
import { getTbsString, getGeoParams } from "./utils";
import type { Env } from './types/cloudflare';
import { describeRoute, openAPISpecs } from 'hono-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { resolver } from 'hono-openapi/zod';

// Define the app type with Variables
type Variables = {
  requestId: string;
};

// Initialize Hono app with type
const app = new Hono<{ Variables: Variables; Bindings: Env }>();

// Middleware for request logging
app.use("*", async (c, next) => {
  try {
    const logger = createLogger(c.env);
    const requestId = crypto.randomUUID();
    const requestLogger = createRequestLogger(logger, requestId);
    c.set("requestId", requestId);
    requestLogger.info("Request received", { 
      method: c.req.method,
      path: c.req.path,
      headers: Object.fromEntries(c.req.raw.headers.entries())
    });
    await next();
  } catch (error) {
    console.error("Error in logging middleware:", error);
    throw error;
  }
});

// Root route handler
app.get("/", async (c) => {
  try {
    const logger = createLogger(c.env);
    const requestLogger = createRequestLogger(logger);
    requestLogger.info("Root route accessed", {
      env: c.env,
      headers: Object.fromEntries(c.req.raw.headers.entries())
    });
    return c.json({
      name: "Hono Serper News Search API",
      version: "1.0.0",
      documentation: "/docs",
      openapi: "/openapi",
    });
  } catch (error) {
    console.error("Error in root route:", error);
    throw error;
  }
});

// Favicon handler
app.get("/favicon.ico", (c) => {
  const logger = createLogger(c.env);
  const requestLogger = createRequestLogger(logger, c.get("requestId"));
  requestLogger.info("Favicon requested");
  return new Response(null, { status: 204 }); // No content response
});

// OpenAPI documentation endpoint
app.get("/openapi", openAPISpecs(app, {
  documentation: {
    info: {
      title: "Hono Serper News Search API",
      version: "1.0.0",
      description: "API for concurrent news article fetching using Serper API",
    },
    servers: [
      { url: "http://localhost:8787", description: "Local Development" },
      { url: "https://your-worker.workers.dev", description: "Production" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
}));

// API documentation UI endpoint
app.get("/docs", apiReference({
  theme: "saturn",
  spec: { url: "/openapi" },
}));

// API endpoint for search requests
app.post(
  "/search",
  // Bearer token middleware
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid bearer token" }, 401);
    }
    const token = authHeader.split(" ")[1];
    if (token !== c.env.BEARER_TOKEN) {
      return c.json({ error: "Invalid bearer token" }, 401);
    }
    await next();
  },
  describeRoute({
    description: "Search for news articles from multiple publications",
    tags: ["Search"],
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: resolver(SearchRequestSchema),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful search results",
        content: {
          "application/json": {
            schema: resolver(SearchResponseSchema),
          },
        },
      },
      401: {
        description: "Unauthorized - Invalid or missing bearer token",
        content: {
          "application/json": {
            schema: resolver(ErrorResponseSchema),
          },
        },
      },
      500: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: resolver(ErrorResponseSchema),
          },
        },
      },
    },
  }),
  zValidator("json", SearchRequestSchema),
  async (c) => {
    const logger = createLogger(c.env);
    const requestLogger = createRequestLogger(logger, c.get("requestId"));
    const body = c.req.valid("json");

    requestLogger.info("Received search request", { body });

    // Validate Serper API key exists in environment
    if (!c.env.SERPER_API_KEY) {
      const error = new Error("SERPER_API_KEY environment variable is not set");
      requestLogger.error("Environment configuration error", { error });
      throw error;
    }

    try {
      const results: FetchResult[] = await Promise.all(
        body.publicationUrls.map(async url => {
          const result: FetchAllPagesResult = await fetchAllPagesForUrl(
            url,
            getTbsString(body.dateRangeOption, body.customTbs),
            getGeoParams(body.region),
            c.env.SERPER_API_KEY,
            body.maxQueriesPerPublication,
            () => true, // Simple credit check for now
            requestLogger
          );

          if (result.error) {
            return {
              status: "rejected",
              url: result.url,
              queriesMade: result.queriesMade,
              creditsConsumed: result.credits,
              results: [],
              reason: result.error.message
            };
          }

          return {
            status: "fulfilled",
            url: result.url,
            queriesMade: result.queriesMade,
            creditsConsumed: result.credits,
            results: result.results.map(item => ({
              headline: item.title,
              publicationUrl: result.url,
              url: item.link,
              snippet: item.snippet,
              source: item.source
            }))
          };
        })
      );

      const totalResults = results.reduce((acc, curr) => acc + curr.results.length, 0);
      const totalCreditsConsumed = results.reduce((acc, curr) => acc + curr.creditsConsumed, 0);
      const totalQueriesMade = results.reduce((acc, curr) => acc + curr.queriesMade, 0);
      const successCount = results.filter(r => r.status === "fulfilled").length;
      const failureCount = results.filter(r => r.status === "rejected").length;

      requestLogger.info("Search completed successfully", { 
        totalResults,
        totalCreditsConsumed,
        totalQueriesMade,
        successCount,
        failureCount
      });

      const summary = {
        totalResults,
        totalCreditsConsumed,
        totalQueriesMade,
        successCount,
        failureCount
      };

      if (body.flattenResults) {
        // Flatten results into a single array
        const flattenedResults = results.flatMap(result => 
          result.status === "fulfilled" ? result.results : []
        );

        return c.json({
          results: flattenedResults,
          summary
        });
      } else {
        // Return nested results
        return c.json({
          results,
          summary
        });
      }
    } catch (error) {
      requestLogger.error("Search failed", { error });
      return c.json({ error: "Failed to fetch news articles" }, 500);
    }
  }
);

// Global error handler
app.onError((err, c) => {
  const logger = createLogger(c.env);
  const requestLogger = createRequestLogger(logger, c.get("requestId"));
  requestLogger.error("Unhandled error", { 
    error: err,
    errorName: err.name,
    errorMessage: err.message,
    errorStack: err.stack,
    requestPath: c.req.path,
    requestMethod: c.req.method,
    requestHeaders: Object.fromEntries(c.req.raw.headers.entries())
  });
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
