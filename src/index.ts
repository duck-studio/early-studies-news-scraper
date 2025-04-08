import { apiReference } from "@scalar/hono-api-reference";
import { type Context, Hono, type Next } from "hono";
import { describeRoute, openAPISpecs } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { HTTPException } from "hono/http-exception";
import { type StatusCode } from "hono/utils/http-status";
import pLimit from "p-limit";
import type { Logger } from "pino";
import { ZodError, z } from "zod";
import {
  type DatabaseError,
  type InsertHeadline,
  type UpdateSyncRunData,
  deleteHeadline,
  deletePublication,
  deleteRegion,
  getHeadlineByUrl,
  getHeadlineStats,
  getHeadlines,
  getLastSyncRun,
  getPublications,
  getRegions,
  insertHeadline,
  insertPublication,
  insertRegion,
  insertSyncRun,
  updateHeadlineById,
  updatePublication,
  updateRegion,
  updateSyncRun,
} from "./db/queries";
import { headlineCategories } from "./db/schema";
import { fetchAllPagesForUrl, publicationLimit } from "./fetcher";
import { createLogger, createRequestLogger } from "./logger";
import {
  DeleteHeadlineBodySchema,
  DeletePublicationBodySchema,
  DeleteRegionBodySchema,
  HeadlinesFetchRequestSchema,
  HeadlinesFetchStdResponseSchema,
  HeadlinesFetchSummary, // Import the summary type
  HeadlinesQueryBodySchema,
  HeadlinesQueryStdResponseSchema,
  HeadlinesStatsResponseSchema,
  InsertHeadlineSchema,
  InsertPublicationSchema,
  InsertRegionSchema,
  LastSyncRunStdResponseSchema,
  ManualSyncRequestSchema,
  ManualSyncResponseDataSchema,
  ManualSyncStdResponseSchema,
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
} from "./schema";
import type { DateRangeEnum, FetchAllPagesResult, FetchResult } from "./schema";
import {
  getDateRange,
  getGeoParams,
  getTbsString,
  parseDdMmYyyy,
  parseMmDdYyyy,
  parseSerperDate,
  validateToken,
} from "./utils";
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type Variables = {
  requestId: string;
  logger: Logger;
};

const app = new Hono<{ Variables: Variables; Bindings: Env }>();

app.use("*", async (c, next) => {
  try {
    const logger = createLogger(c.env);
    const requestId = crypto.randomUUID();
    const requestLogger = createRequestLogger(logger, requestId);
    c.set("requestId", requestId);
    c.set("logger", requestLogger);
    requestLogger.info("Request received", {
      method: c.req.method,
      path: c.req.path,
    });
    await next();
  } catch (error) {
    console.error("Error in logging middleware:", error);
    throw error;
  }
});

app.get("/", async (c) => {
  const logger = c.get("logger");
  logger.info("Root route accessed", {
    headers: Object.fromEntries(c.req.raw.headers.entries()),
  });
  return c.json({
    name: "Early Studies Headlines Fetcher API",
    version: "1.0.0",
    documentation: "/docs",
    openapi: "/openapi",
  });
});

app.get("/favicon.ico", () => {
  return new Response(null, { status: 204 });
});

app.get(
  "/openapi",
  openAPISpecs(app, {
    documentation: {
      info: {
        title: "Early Studies Headlines Fetcher API",
        version: "1.0.0",
        description:
          "API for fetching news headlines for Early Studies. Uses a standard response envelope { data, success, error }.",
      },
      servers: [
        { url: "http://localhost:8787", description: "Local Development" },
        { url: "https://api.earlystudies.com", description: "Production" },
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
  })
);

app.get(
  "/docs",
  apiReference({
    theme: "saturn",
    spec: { url: "/openapi" },
  })
);

const authMiddleware = async (c: Context<{ Variables: Variables; Bindings: Env }>, next: Next) => {
  const logger = c.get("logger");
  const { missing, valid } = validateToken(
    c.req.header("Authorization"),
    `Bearer ${c.env.BEARER_TOKEN}`,
    logger
  );
  if (missing || !valid) {
    const status = missing ? 401 : 403;
    const code = missing ? "AUTH_MISSING_TOKEN" : "AUTH_INVALID_TOKEN";
    const message = missing ? "Authorization token is missing" : "Authorization token is invalid";
    logger.warn("Authentication failed", { message, status });
    return c.json(
      {
        data: null,
        success: false,
        error: { message: message, code: code },
      },
      status
    );
  }
  await next();
};

function handleDatabaseError(
  c: Context<{ Variables: Variables; Bindings: Env }>,
  error: unknown,
  defaultMessage = "Database operation failed"
): Response {
  // Ensure it returns a Response
  const logger = c.get("logger");
  let statusCode = 500;
  let errorPayload: z.infer<typeof StandardErrorSchema> = { message: defaultMessage };

  if (error instanceof Error && error.name === "DatabaseError") {
    const dbError = error as DatabaseError;
    logger.error("Database error", { message: dbError.message, details: dbError.details });

    errorPayload = {
      message: dbError.message,
      code: "DB_OPERATION_FAILED",
      details: dbError.details ?? undefined,
    };

    if (dbError.message.includes("already exists")) {
      statusCode = 409;
      errorPayload.code = "DB_CONFLICT";
    } else if (dbError.message.includes("not found")) {
      statusCode = 404;
      errorPayload.code = "DB_NOT_FOUND";
    }
  } else if (error instanceof Error) {
    logger.error("Unexpected application error", {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    errorPayload = { message: error.message || defaultMessage, code: "UNEXPECTED_ERROR" };
  } else {
    logger.error("Unexpected non-error thrown", { error });
    errorPayload = { message: defaultMessage, code: "UNKNOWN_ERROR" };
  }

  // Set status first (cast to StatusCode), then return JSON
  c.status(statusCode as StatusCode);
  return c.json({
    data: null,
    success: false,
    error: errorPayload,
  });
}

const validateNonEmptyBody = async (
  c: Context<{ Variables: Variables; Bindings: Env }>,
  next: Next
) => {
  const body = await c.req.json().catch(() => ({})); // Get body, handle potential errors
  if (Object.keys(body).length === 0) {
    c.status(400);
    return c.json({
      data: null,
      success: false,
      error: { message: "Request body cannot be empty for update", code: "VALIDATION_ERROR" },
    });
  }

  await next();
};

function validateAndParseDateRange(
  c: Context<{ Variables: Variables; Bindings: Env }>,
  body: { startDate?: string; endDate?: string }
): { startDate: Date | undefined; endDate: Date | undefined } | null {
  const logger = c.get("logger");
  const startDate = parseDdMmYyyy(body.startDate);
  const endDate = parseDdMmYyyy(body.endDate);

  if (body.startDate && !startDate) {
    logger.warn("Invalid start date format provided:", { startDate: body.startDate });
    c.status(400);
    c.json({
      data: null,
      success: false,
      error: { message: "Invalid start date format. Use DD/MM/YYYY.", code: "VALIDATION_ERROR" },
    });
    return null; // Validation failed
  }
  if (body.endDate && !endDate) {
    logger.warn("Invalid end date format provided:", { endDate: body.endDate });
    c.status(400);
    c.json({
      data: null,
      success: false,
      error: { message: "Invalid end date format. Use DD/MM/YYYY.", code: "VALIDATION_ERROR" },
    });
    return null; // Validation failed
  }

  // Ensure start date is not after end date if both are provided
  if (startDate && endDate && startDate > endDate) {
    logger.warn("Start date cannot be after end date", {
      startDate: body.startDate,
      endDate: body.endDate,
    });
    c.status(400);
    c.json({
      data: null,
      success: false,
      error: { message: "Start date cannot be after end date.", code: "VALIDATION_ERROR" },
    });
    return null; // Validation failed
  }

  // Validation passed, return the parsed dates (which might be undefined)
  return { startDate, endDate };
}

app.post(
  "/publications/query",
  authMiddleware,
  describeRoute({
    description: "Get a list of publications using filters in the request body",
    tags: ["Database - Publications"],
    requestBody: {
      content: {
        "application/json": {
          schema: PublicationsQueryBodySchema,
        },
      },
    },
    responses: {
      200: {
        description: "Successful query",
        content: {
          "application/json": {
            schema: PublicationsListResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500"),
          },
        },
      },
    },
  }),
  zValidator("json", PublicationsQueryBodySchema),
  async (c) => {
    const filters = c.req.valid("json");
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
      return handleDatabaseError(c, error, "Failed to fetch publications");
    }
  }
);

app.post(
  "/publications",
  authMiddleware,
  describeRoute({
    description: "Create a new publication",
    tags: ["Database - Publications"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: InsertPublicationSchema,
          example: {
            name: "The Example Times",
            url: "https://example.com/news",
            category: "broadsheet",
          },
        },
      },
    },
    responses: {
      201: {
        description: "Publication created successfully",
        content: {
          "application/json": {
            schema: SinglePublicationResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_PubCreate"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_PubCreate"),
          },
        },
      },
      409: {
        description: "Conflict - Publication already exists",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse409_PubCreate"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_PubCreate"),
          },
        },
      },
    },
  }),
  zValidator("json", InsertPublicationSchema),
  async (c) => {
    const publicationData = c.req.valid("json");
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
      return handleDatabaseError(c, error, "Failed to insert publication");
    }
  }
);

app.put(
  "/publications/:id",
  authMiddleware,
  validateNonEmptyBody,
  describeRoute({
    description: "Update an existing publication by ID",
    tags: ["Database - Publications"],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: "path",
        name: "id",
        schema: { type: "string" },
        required: true,
        description: "ID of the publication to update",
      },
    ],
    requestBody: {
      description: "Publication data fields to update. The ID cannot be changed via this endpoint.",
      content: {
        "application/json": {
          schema: InsertPublicationSchema.partial(),
          example: {
            name: "The Updated Example Times",
            category: "tabloid",
          },
        },
      },
    },
    responses: {
      200: {
        description: "Publication updated successfully",
        content: { "application/json": { schema: SinglePublicationResponseSchema } },
      },
      400: {
        description: "Bad Request (e.g., URL conflict)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_PubUpdate"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_PubUpdate"),
          },
        },
      },
      404: {
        description: "Publication not found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_PubUpdate"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_PubUpdate"),
          },
        },
      },
    },
  }),
  zValidator("json", InsertPublicationSchema.partial()),
  async (c) => {
    const publicationId = c.req.param("id");
    const updateData = c.req.valid("json");

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
      return handleDatabaseError(c, error, "Failed to update publication");
    }
  }
);

app.delete(
  "/publications",
  authMiddleware,
  describeRoute({
    description: "Delete a publication using its ID provided in the request body",
    tags: ["Database - Publications"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: DeletePublicationBodySchema,
        },
      },
    },
    responses: {
      200: {
        description: "Publication deleted successfully",
        content: {
          "application/json": {
            schema: SinglePublicationResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_PubDelete"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_PubDelete"),
          },
        },
      },
      404: {
        description: "Publication not found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_PubDelete"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_PubDelete"),
          },
        },
      },
    },
  }),
  zValidator("json", DeletePublicationBodySchema),
  async (c) => {
    const { id } = c.req.valid("json");
    try {
      const [deleted] = await deletePublication(c.env.DB, id);
      if (!deleted) {
        return c.json({ error: "Publication not found" }, 404);
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
      return handleDatabaseError(c, error, "Failed to delete publication");
    }
  }
);

app.get(
  "/regions",
  authMiddleware,
  describeRoute({
    description: "Get a list of all regions",
    tags: ["Database - Regions"],
    responses: {
      200: {
        description: "Successful retrieval",
        content: {
          "application/json": {
            schema: RegionsListResponseSchema,
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_RegionsGet"),
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
      return handleDatabaseError(c, error, "Failed to fetch regions");
    }
  }
);

app.post(
  "/regions",
  authMiddleware,
  describeRoute({
    description: "Create a new region",
    tags: ["Database - Regions"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: InsertRegionSchema,
          example: {
            name: "UK",
          },
        },
      },
    },
    responses: {
      201: {
        description: "Region created successfully",
        content: {
          "application/json": {
            schema: SingleRegionResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_RegionCreate"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_RegionCreate"),
          },
        },
      },
      409: {
        description: "Conflict - Region already exists",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse409_RegionCreate"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_RegionCreate"),
          },
        },
      },
    },
  }),
  zValidator("json", InsertRegionSchema),
  async (c) => {
    const regionData = c.req.valid("json");
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
      return handleDatabaseError(c, error, "Failed to insert region");
    }
  }
);

app.put(
  "/regions/:id",
  authMiddleware,
  validateNonEmptyBody,
  describeRoute({
    description: "Update an existing region by ID",
    tags: ["Database - Regions"],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: "path",
        name: "id",
        schema: { type: "string" },
        required: true,
        description: "ID of the region to update",
      },
    ],
    requestBody: {
      description: "Region data fields to update. The ID cannot be changed via this endpoint.",
      content: {
        "application/json": {
          schema: InsertRegionSchema.partial(),
          example: {
            name: "United Kingdom",
          },
        },
      },
    },
    responses: {
      200: {
        description: "Region updated successfully",
        content: { "application/json": { schema: SingleRegionResponseSchema } },
      },
      400: {
        description: "Bad Request (e.g., name conflict)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_RegionUpdate"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_RegionUpdate"),
          },
        },
      },
      404: {
        description: "Region not found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_RegionUpdate"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_RegionUpdate"),
          },
        },
      },
    },
  }),
  zValidator("json", InsertRegionSchema.partial()),
  async (c) => {
    const regionId = c.req.param("id");
    const updateData = c.req.valid("json");

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
      return handleDatabaseError(c, error, "Failed to update region");
    }
  }
);

app.delete(
  "/regions",
  authMiddleware,
  describeRoute({
    description: "Delete a region using its ID provided in the request body",
    tags: ["Database - Regions"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: DeleteRegionBodySchema,
        },
      },
    },
    responses: {
      200: {
        description: "Region deleted successfully",
        content: {
          "application/json": {
            schema: SingleRegionResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_RegionDelete"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_RegionDelete"),
          },
        },
      },
      404: {
        description: "Region not found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_RegionDelete"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_RegionDelete"),
          },
        },
      },
    },
  }),
  zValidator("json", DeleteRegionBodySchema),
  async (c) => {
    const { id } = c.req.valid("json");
    try {
      const [deleted] = await deleteRegion(c.env.DB, id);
      if (!deleted) {
        return c.json({ error: "Region not found" }, 404);
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
      return handleDatabaseError(c, error, "Failed to delete region");
    }
  }
);

app.post(
  "/headlines/query",
  authMiddleware,
  describeRoute({
    description: "Get a list of headlines using filters and pagination in the request body",
    tags: ["Database - Headlines"],
    requestBody: {
      content: {
        "application/json": {
          schema: HeadlinesQueryBodySchema,
        },
      },
    },
    responses: {
      200: {
        description: "Successful query",
        content: {
          "application/json": {
            schema: HeadlinesQueryStdResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_HdlQuery"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_HdlQuery"),
          },
        },
      },
    },
  }),
  zValidator("json", HeadlinesQueryBodySchema),
  async (c) => {
    const body = c.req.valid("json");

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
      return handleDatabaseError(c, error, "Failed to fetch headlines");
    }
  }
);

app.post(
  "/headlines",
  authMiddleware,
  describeRoute({
    description: "Create a new headline",
    tags: ["Database - Headlines"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: InsertHeadlineSchema,
          example: {
            url: "https://example.com/news/article123",
            headline: "Example Headline Takes World by Storm",
            snippet: "An example snippet describing the headline.",
            source: "Example News Source",
            rawDate: "Jan 1, 2024",
            normalizedDate: "2024-01-01T12:00:00Z",
            category: "technology",
            publicationId: "https://example.com/news",
          },
        },
      },
    },
    responses: {
      201: {
        description: "Headline created successfully",
        content: {
          "application/json": {
            schema: SingleHeadlineResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request / Publication Not Found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_HdlCreate"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_HdlCreate"),
          },
        },
      },
      409: {
        description: "Conflict - Headline URL already exists",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse409_HdlCreate"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_HdlCreate"),
          },
        },
      },
    },
  }),
  zValidator("json", InsertHeadlineSchema),
  async (c) => {
    const headlineData = c.req.valid("json");
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
      return handleDatabaseError(c, error, "Failed to insert headline");
    }
  }
);

app.put(
  "/headlines/:id",
  authMiddleware,
  validateNonEmptyBody,
  describeRoute({
    description: "Update an existing headline by its internal ID",
    tags: ["Database - Headlines"],
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        in: "path",
        name: "id",
        schema: { type: "string" },
        required: true,
        description: "Internal ID of the headline to update",
      },
    ],
    requestBody: {
      description:
        "Headline data fields to update. The ID and URL cannot be changed via this endpoint.",
      content: {
        "application/json": {
          schema: InsertHeadlineSchema.partial().omit({ url: true }),
          example: {
            headline: "Updated: Example Headline Takes World by Storm",
            snippet: "An updated snippet.",
            category: "business",
          },
        },
      },
    },
    responses: {
      200: {
        description: "Headline updated successfully",
        content: { "application/json": { schema: SingleHeadlineResponseSchema } },
      },
      400: {
        description: "Bad Request (e.g., invalid data, publication not found, URL conflict)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_HdlUpdate"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_HdlUpdate"),
          },
        },
      },
      404: {
        description: "Headline not found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_HdlUpdate"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_HdlUpdate"),
          },
        },
      },
    },
  }),
  zValidator("json", InsertHeadlineSchema.partial().omit({ url: true })),
  async (c) => {
    const headlineId = c.req.param("id");
    const updateData = c.req.valid("json");

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
      return handleDatabaseError(c, error, "Failed to update headline");
    }
  }
);

app.delete(
  "/headlines",
  authMiddleware,
  describeRoute({
    description: "Delete a headline using its ID provided in the request body",
    tags: ["Database - Headlines"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: DeleteHeadlineBodySchema,
        },
      },
    },
    responses: {
      200: {
        description: "Headline deleted successfully",
        content: {
          "application/json": {
            schema: SingleHeadlineResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_HdlDelete"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_HdlDelete"),
          },
        },
      },
      404: {
        description: "Headline not found",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_HdlDelete"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_HdlDelete"),
          },
        },
      },
    },
  }),
  zValidator("json", DeleteHeadlineBodySchema),
  async (c) => {
    const { id } = c.req.valid("json");
    try {
      const [deleted] = await deleteHeadline(c.env.DB, id);
      if (!deleted) {
        return c.json({ error: "Headline not found" }, 404);
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
      return handleDatabaseError(c, error, "Failed to delete headline");
    }
  }
);

app.post(
  "/headlines/fetch",
  authMiddleware,
  describeRoute({
    description: "Fetch news headlines from one or more publications via Serper API",
    tags: ["Headlines Fetcher"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: resolver(HeadlinesFetchRequestSchema),
          example: {
            publicationUrls: ["https://bbc.co.uk"],
            region: "UK",
            dateRangeOption: "Past Week",
            maxQueriesPerPublication: 5,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Successful fetch operation",
        content: {
          "application/json": {
            schema: HeadlinesFetchStdResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_HdlFetch"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_HdlFetch"),
          },
        },
      },
      403: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse403_HdlFetch"),
          },
        },
      },
      500: {
        description: "Internal Server Error / Fetch Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_HdlFetch"),
          },
        },
      },
    },
  }),
  zValidator("json", HeadlinesFetchRequestSchema),
  async (c) => {
    const {
      dateRangeOption,
      customTbs,
      region,
      publicationUrls: requestedPublicationUrls, // Renamed for clarity
      maxQueriesPerPublication,
      flattenResults,
      triggerWorkflow, // Added triggerWorkflow
    } = c.req.valid("json");
    const logger = c.get("logger");

    // --- Environment Checks ---
    if (!c.env.SERPER_API_KEY) {
      const error = new Error("SERPER_API_KEY environment variable is not set");
      logger.error("Environment configuration error", { error });
      return c.json(
        {
          data: null,
          success: false,
          error: { message: "Server configuration error: API key missing.", code: "CONFIG_ERROR" },
        },
        500
      );
    }
    // Check queue binding only if workflow trigger is requested
    if (triggerWorkflow && !c.env.NEWS_ITEM_QUEUE) {
      logger.error(
        "Environment configuration error: NEWS_ITEM_QUEUE binding missing for workflow trigger."
      );
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: "Server configuration error: Queue binding missing.",
            code: "CONFIG_ERROR",
          },
        },
        500
      );
    }
    // Workflow binding itself isn't directly used here, but by the queue consumer.
    // No need to check for c.env.PROCESS_NEWS_ITEM_WORKFLOW here.

    // --- Log triggerWorkflow status ---
    logger.debug("Workflow trigger status", { triggerWorkflow });

    // --- Date Range Determination ---
    let filterDateRange: { start: Date; end: Date };
    try {
      if (dateRangeOption === "Custom" && customTbs) {
        logger.debug("Custom date range specified via tbs", { customTbs });
        // Regex to extract MM/DD/YYYY dates from cd_min and cd_max within the customTbs string
        const match = customTbs.match(
          /cd_min:(\d{1,2}\/\d{1,2}\/\d{4}),cd_max:(\d{1,2}\/\d{1,2}\/\d{4})/
        );
        // biome-ignore lint: match[1] and match[2] are guaranteed to exist by the regex
        if (match && match[1] && match[2]) {
          const startDateStr = match[1];
          const endDateStr = match[2];
          const parsedStartDate = parseMmDdYyyy(startDateStr);
          const parsedEndDate = parseMmDdYyyy(endDateStr);

          if (parsedStartDate && parsedEndDate) {
            parsedEndDate.setHours(23, 59, 59, 999); // Ensure end date is inclusive

            if (parsedStartDate > parsedEndDate) {
              logger.warn("Custom start date is after custom end date", {
                startDateStr,
                endDateStr,
              });
              c.status(400);
              return c.json({
                data: null,
                success: false,
                error: {
                  message: "Invalid custom date range: Start date cannot be after end date.",
                  code: "VALIDATION_ERROR",
                },
              });
            }
            filterDateRange = { start: parsedStartDate, end: parsedEndDate };
            logger.info("Using custom date range for filtering", {
              start: filterDateRange.start.toISOString(),
              end: filterDateRange.end.toISOString(),
            });
          } else {
            logger.warn("Failed to parse custom dates from tbs", {
              startDateStr,
              endDateStr,
              customTbs,
            });
            c.status(400);
            return c.json({
              data: null,
              success: false,
              error: {
                message: "Invalid date format in customTbs. Use MM/DD/YYYY for cd_min and cd_max.",
                code: "VALIDATION_ERROR",
              },
            });
          }
        } else {
          logger.warn("Could not extract dates from customTbs string", { customTbs });
          c.status(400);
          return c.json({
            data: null,
            success: false,
            error: {
              message:
                "Invalid format for customTbs. Expected 'cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY' within the string.",
              code: "VALIDATION_ERROR",
            },
          });
        }
      } else {
        // Standard date range calculation
        filterDateRange = getDateRange(dateRangeOption);
        logger.info("Using standard date range option for filtering", { dateRangeOption });
      }
    } catch (e) {
      logger.error("Error determining filter date range", { error: e });
      c.status(500);
      return c.json({
        data: null,
        success: false,
        error: {
          message: "Internal server error determining date range.",
          code: "DATE_RANGE_ERROR",
        },
      });
    }

    // The tbs string sent to Serper still uses the original logic
    const serperTbs = getTbsString(dateRangeOption, customTbs);

    // --- Fetch Publication IDs if triggering workflow ---
    const publicationUrlToIdMap = new Map<string, string>();
    if (triggerWorkflow) {
      try {
        logger.debug("TriggerWorkflow is true, fetching publications for ID mapping.");
        const publications = await getPublications(c.env.DB); // Fetch all publications
        if (publications && publications.length > 0) {
          for (const pub of publications) {
            // Map the *clean* URL (without https://) to its ID for consistency with sync logic
            if (pub.id && pub.url) {
              const cleanUrl = pub.url.replace(/^https?:\/\//, "");
              publicationUrlToIdMap.set(cleanUrl, pub.id); // e.g., theguardian.com -> id
            }
          }
          logger.info(`Mapped ${publicationUrlToIdMap.size} publications for workflow trigger.`);
          // --- Log the created map ---
          logger.debug("Publication URL to ID Map created", {
            map: Object.fromEntries(publicationUrlToIdMap),
          });
        } else {
          logger.warn("No publications found in DB for ID mapping. Workflows cannot be triggered.");
          // We don't fail here, just won't be able to queue items
        }
      } catch (dbError) {
        logger.error(
          "Failed to fetch publications for ID mapping. Workflows cannot be triggered.",
          { dbError }
        );
        // Decide if this should be a fatal error or just log and continue without triggering workflows
        // Let's log and continue, but workflow triggering will effectively be disabled for this run.
        // return handleDatabaseError(c, dbError, "Failed to fetch publications for workflow trigger");
      }
    }

    // --- Fetch Headlines ---
    try {
      const fetchPublicationWithLimit = (url: string) =>
        fetchAllPagesForUrl(
          url, // Expects URL with https://
          serperTbs,
          getGeoParams(region),
          c.env.SERPER_API_KEY,
          maxQueriesPerPublication,
          logger
        );

      // Ensure requested URLs have https:// before fetching
      const publicationUrlsWithHttps = requestedPublicationUrls.map((url) =>
        url.startsWith("https://") ? url : `https://${url}`
      );

      const publicationPromises = publicationUrlsWithHttps.map((url) =>
        publicationLimit(() => fetchPublicationWithLimit(url))
      );

      const results: FetchResult[] = await Promise.all(
        publicationPromises.map(async (resultPromise) => {
          const result: FetchAllPagesResult = await resultPromise;

          if (result.error) {
            return {
              status: "rejected",
              url: result.url, // The URL that failed (with https://)
              queriesMade: result.queriesMade,
              creditsConsumed: result.credits,
              results: [],
              reason: result.error.message,
            };
          }

          // Transform results immediately after fetch
          return {
            status: "fulfilled",
            url: result.url, // Keep the URL used for fetching (with https://)
            queriesMade: result.queriesMade,
            creditsConsumed: result.credits,
            results: result.results.map((item): TransformedNewsItem => {
              // Explicit type
              const parsedDate = parseSerperDate(item.date);
              return {
                headline: item.title,
                publicationUrl: result.url, // Store the fetched URL (with https://)
                url: item.link,
                snippet: item.snippet ?? null, // Ensure null if undefined
                source: item.source,
                rawDate: item.date ?? null, // Ensure null if undefined
                normalizedDate: parsedDate ? parsedDate.toLocaleDateString("en-GB") : undefined,
              };
            }),
          };
        })
      );

      // --- Filter Results and Prepare for Queue (if applicable) ---
      let totalItemsBeforeFiltering = 0;
      let totalItemsAfterFiltering = 0;
      const itemsToQueue: ProcessNewsItemParams[] = []; // Store items destined for the queue

      for (const result of results) {
        if (result.status === "fulfilled") {
          const initialCount = result.results.length;
          totalItemsBeforeFiltering += initialCount;

          // Filter by date
          const dateFilteredResults = result.results;
          console.log("dateFilteredResults", dateFilteredResults.length);

          // Replace original results with filtered ones for the response
          result.results = dateFilteredResults;
          const finalCount = result.results.length;
          totalItemsAfterFiltering += finalCount;

          // If triggering workflow, prepare items for queuing
          if (triggerWorkflow) {
            // Check only triggerWorkflow, handle map lookup/creation inside
            // Only queue if map exists
            // Get the publication URL *without* https:// to match the map key
            const keyUrl = result.url.replace(/^https?:\/\//, "");
            // --- Log the keyUrl being looked up ---
            logger.debug("Attempting to find publication ID for keyUrl", {
              keyUrl,
              fetchUrl: result.url,
            });
            let publicationId = publicationUrlToIdMap.get(keyUrl); // Use let to allow modification
            // --- Log the result of the map lookup ---
            logger.debug("Initial publication ID map lookup result", {
              keyUrl,
              publicationId: publicationId ?? "Not Found",
            });

            // --- If publication ID not found, try to create it ---
            if (!publicationId) {
              logger.info(`Publication not found for keyUrl: ${keyUrl}. Attempting to create.`);
              try {
                // Use original result.url (with https://) for the DB record
                const [newPublication] = await insertPublication(c.env.DB, {
                  name: keyUrl, // Use keyUrl (e.g., bbc.co.uk) as the default name
                  url: result.url, // Store the full URL from the fetch result
                  // category can be omitted or set to null by default based on schema/function
                });
                if (newPublication?.id) {
                  // Use optional chaining
                  publicationId = newPublication.id; // Assign the new ID
                  publicationUrlToIdMap.set(keyUrl, publicationId); // Update map for consistency (though unlikely needed in same request)
                  logger.info("Successfully created new publication", {
                    keyUrl,
                    newId: publicationId,
                  });
                  logger.debug("Updated publication ID map lookup result", {
                    keyUrl,
                    publicationId,
                  }); // Log again after creation
                } else {
                  // This case should ideally not happen if insertPublication resolves successfully
                  logger.error("Failed to create publication or retrieve ID after insert", {
                    keyUrl,
                  });
                  publicationId = undefined; // Ensure it remains undefined/null
                }
              } catch (dbError) {
                // Handle potential conflict (e.g., concurrent creation) or other errors
                if (
                  dbError instanceof Error &&
                  dbError.name === "DatabaseError" &&
                  (dbError as DatabaseError).message?.includes("already exists")
                ) {
                  logger.warn(
                    `Publication likely created concurrently for keyUrl: ${keyUrl}. Queuing will be skipped for this result.`,
                    { dbError }
                  );
                } else {
                  logger.error(
                    `Failed to insert new publication for keyUrl: ${keyUrl}. Queuing will be skipped for this result.`,
                    { dbError }
                  );
                }
                publicationId = undefined; // Ensure queuing is skipped on error
              }
            }
            // --- End of creation logic ---

            if (publicationId) {
              // Iterate through the *date-filtered* results for this publication
              for (const item of dateFilteredResults) {
                itemsToQueue.push({
                  headlineUrl: item.url,
                  publicationId: publicationId,
                  headlineText: item.headline,
                  snippet: item.snippet,
                  source: item.source,
                  rawDate: item.rawDate,
                  normalizedDate: item.normalizedDate ? item.normalizedDate : null,
                });
              }
            } else {
              logger.warn(
                `Could not find publication ID for fetched key URL: ${keyUrl} (from ${result.url}). Skipping workflow trigger for its headlines.`
              );
            }
          }
        }
      }

      const filteredOutCount = totalItemsBeforeFiltering - totalItemsAfterFiltering;
      if (filteredOutCount > 0) {
        logger.info(
          { filteredOutCount, totalItemsBeforeFiltering, totalItemsAfterFiltering },
          `Filtered out ${filteredOutCount} results based on publication date.`
        );
      }

      // --- Send Messages to Queue if requested ---
      let messagesSent = 0;
      let messageSendErrors = 0;
      if (triggerWorkflow && itemsToQueue.length > 0) {
        logger.info(
          `Attempting to queue ${itemsToQueue.length} headlines for workflow processing.`
        );
        const queueSendLimit = pLimit(50); // Use p-limit like in sync
        const queueSendPromises: Promise<unknown>[] = [];
        let messageDelaySeconds = 0; // Use delay like in sync

        for (const payload of itemsToQueue) {
          // Increment delay every 10 messages to stagger queue sends
          if (messagesSent > 0 && messagesSent % 10 === 0) {
            messageDelaySeconds++;
            // logger.debug(`Increased message delay to ${messageDelaySeconds} seconds.`);
          }

          queueSendPromises.push(
            queueSendLimit(async () => {
              try {
                // Send to the queue, like the sync operation
                await c.env.NEWS_ITEM_QUEUE.send(payload, { delaySeconds: messageDelaySeconds });
                logger.debug(
                  `Sent message to queue for headline: ${payload.headlineUrl} with delay ${messageDelaySeconds}s`
                );
                messagesSent++;
              } catch (queueError) {
                logger.error(
                  `Failed to send message to queue for headline: ${payload.headlineUrl}`,
                  { error: queueError }
                );
                messageSendErrors++;
              }
            })
          );
        }
        // Wait for all queue send operations to settle
        await Promise.allSettled(queueSendPromises);
        logger.info(`Successfully sent ${messagesSent} messages to the queue.`);
        if (messageSendErrors > 0) {
          logger.warn(`Failed to send ${messageSendErrors} messages to the queue.`);
        }
      } else if (triggerWorkflow) {
        logger.info(
          "TriggerWorkflow was true, but no eligible headlines found/mapped to queue after filtering."
        );
      }

      // --- Prepare Summary and Final Results ---
      // totalResults should reflect the count *after* filtering
      const totalResultsAfterFiltering = results.reduce(
        (acc, curr) => acc + (curr.status === "fulfilled" ? curr.results.length : 0),
        0
      );
      const totalCreditsConsumed = results.reduce((acc, curr) => acc + curr.creditsConsumed, 0);
      const totalQueriesMade = results.reduce((acc, curr) => acc + curr.queriesMade, 0);
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      const failureCount = results.filter((r) => r.status === "rejected").length;

      // Build the summary object
      const summary: HeadlinesFetchSummary = {
        totalResults: totalResultsAfterFiltering,
        totalCreditsConsumed,
        totalQueriesMade,
        successCount,
        failureCount,
        // Conditionally add messagesSent as workflowsQueued to the summary
        ...(triggerWorkflow && { workflowsQueued: messagesSent }),
      };

      logger.info("Search /headlines/fetch completed", {
        ...summary, // Log the final summary
      });

      // Handle flattenResults - needs to operate on the filtered results
      const finalResults = flattenResults
        ? results.flatMap((r) => (r.status === "fulfilled" ? r.results : [])) // Flatten only successful, filtered results
        : results; // Return grouped, filtered results (including failures)

      // Return the final response
      return c.json(
        {
          data: {
            results: finalResults,
            summary: summary,
          },
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      // Handle generic fetch/processing errors
      logger.error("Search failed in /headlines/fetch", { error });
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: "Failed to fetch news articles",
            code: "FETCH_FAILED",
            details: error instanceof Error ? error.message : String(error),
          },
        },
        500
      );
    }
  }
);

app.post(
  "/stats/headlines",
  authMiddleware,
  describeRoute({
    description: "Get statistics about headlines within a date range.",
    tags: ["Statistics"],
    requestBody: {
      content: { "application/json": { schema: StatsQueryBodySchema } },
    },
    responses: {
      200: {
        description: "Successful statistics query",
        content: { "application/json": { schema: HeadlinesStatsResponseSchema } },
      },
      400: {
        description: "Bad Request (Invalid Date Format)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_Stats"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_Stats"),
          },
        },
      },
    },
  }),
  zValidator("json", StatsQueryBodySchema),
  async (c) => {
    const body = c.req.valid("json");
    const logger = c.get("logger");

    // Use the helper function for date validation and parsing
    const parsedDates = validateAndParseDateRange(c, body);
    if (parsedDates === null) {
      return c.res; // Validation failed, response set by helper
    }

    const { startDate, endDate } = parsedDates;

    // Validate dates are present *after* successful parsing for stats endpoint
    if (startDate === undefined) {
      // Check for undefined specifically
      logger.warn("Start date is required for statistics.");
      c.status(400);
      return c.json({
        data: null,
        success: false,
        error: { message: "Start date is required. Use DD/MM/YYYY.", code: "VALIDATION_ERROR" },
      });
    }
    if (endDate === undefined) {
      // Check for undefined specifically
      logger.warn("End date is required for statistics.");
      c.status(400);
      return c.json({
        data: null,
        success: false,
        error: { message: "End date is required. Use DD/MM/YYYY.", code: "VALIDATION_ERROR" },
      });
    }

    // Now we know startDate and endDate are valid Date objects

    try {
      const rawStats = await getHeadlineStats(c.env.DB, startDate, endDate);

      // Process raw stats into the desired response format

      // 1. Calculate Category Percentages
      const categoryPercentage: Record<string, number> = {};
      if (rawStats.totalCount > 0) {
        for (const item of rawStats.categoryCounts) {
          const categoryName = item.category ?? "uncategorized";
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
      return handleDatabaseError(c, error, "Failed to fetch headline statistics");
    }
  }
);

app.onError((err, c) => {
  const logger = c.get("logger");
  let statusCode = 500;
  let errorPayload: z.infer<typeof StandardErrorSchema> = {
    message: "Internal Server Error",
    code: "INTERNAL_SERVER_ERROR",
  };

  if (err instanceof ZodError) {
    statusCode = 400;
    errorPayload = {
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      details: err.flatten(),
    };
    logger.warn("Validation error", {
      path: c.req.path,
      method: c.req.method,
      errors: err.flatten(),
    });
  } else if (err instanceof HTTPException) {
    statusCode = err.status;
    errorPayload = { message: err.message, code: `HTTP_${statusCode}` };
    logger.error("HTTP exception", { status: err.status, message: err.message, stack: err.stack });
  } else if (err instanceof Error) {
    errorPayload = { message: err.message, code: "UNHANDLED_EXCEPTION", details: err.stack };
    logger.error("Unhandled application error", {
      errorName: err.name,
      errorMessage: err.message,
      errorStack: err.stack,
    });
  } else {
    errorPayload = {
      message: "An unknown error occurred",
      code: "UNKNOWN_ERROR",
      details: String(err),
    };
    logger.error("Unknown error thrown", { error: err });
  }

  // Set status first (cast to StatusCode), then return JSON
  c.status(statusCode as StatusCode);
  return c.json({
    data: null,
    success: false,
    error: errorPayload,
  });
});

type SyncSummary = z.infer<typeof ManualSyncResponseDataSchema>;

async function performHeadlineSync(
  env: Env,
  logger: Logger,
  triggerType: "manual" | "scheduled",
  dateRangeOption: DateRangeEnum,
  customTbs: string | undefined,
  maxQueriesPerPublication: number
): Promise<SyncSummary> {
  logger.info("Starting headline sync...", {
    triggerType,
    dateRangeOption,
    maxQueriesPerPublication,
  });

  let syncRunId: string | undefined;
  try {
    const { id } = await insertSyncRun(env.DB, {
      triggerType,
      dateRangeOption,
      customTbs,
      maxQueriesPerPublication,
    });
    syncRunId = id;
    logger.info(`Created sync run record: ${syncRunId}`);
  } catch (dbError) {
    logger.error("Failed to create initial sync run record. Aborting sync.", { dbError });
    throw new Error("Failed to initialize sync run logging.");
  }

  let summary: SyncSummary | undefined;
  try {
    if (!env.SERPER_API_KEY) {
      throw new Error("Server configuration error: SERPER_API_KEY missing.");
    }
    if (!env.NEWS_ITEM_QUEUE) {
      throw new Error("Server configuration error: NEWS_ITEM_QUEUE binding missing.");
    }

    const publications = await getPublications(env.DB);
    if (!publications || publications.length === 0) {
      logger.info("No publications found in the database. Finishing sync early.", { syncRunId });
      summary = {
        publicationsFetched: 0,
        totalHeadlinesFetched: 0,
        headlinesWithinDateRange: 0,
        workflowsQueued: 0,
        dateRange: { start: new Date(0).toISOString(), end: new Date(0).toISOString() },
      };
      await updateSyncRun(env.DB, syncRunId, {
        status: "completed",
        summaryPublicationsFetched: 0,
        summaryTotalHeadlinesFetched: 0,
        summaryHeadlinesWithinRange: 0,
        summaryWorkflowsQueued: 0,
      });
      logger.info("Sync task finished early: No publications found.", { syncRunId });
      return summary;
    }
    const publicationUrlToIdMap = new Map<string, string>();
    for (const pub of publications) {
      if (pub.id && pub.url) {
        publicationUrlToIdMap.set(pub.url, pub.id);
      }
    }
    const publicationUrls = Array.from(publicationUrlToIdMap.keys());
    logger.info(`Found ${publicationUrls.length} publications to fetch.`);

    const fetchLimit = pLimit(10);
    const region = "UK";
    const tbs = getTbsString(dateRangeOption, customTbs);
    const geoParams = getGeoParams(region);
    const dateRange = getDateRange(dateRangeOption);

    const fetchPromises = publicationUrls.map((url) =>
      fetchLimit(() =>
        fetchAllPagesForUrl(
          `https://${url}`,
          tbs,
          geoParams,
          env.SERPER_API_KEY,
          maxQueriesPerPublication,
          logger
        )
      )
    );

    logger.info(`Fetching headlines for ${publicationUrls.length} publications...`);
    const fetchResults = await Promise.all(fetchPromises);
    logger.info("Finished fetching headlines.");

    let headlinesFilteredCount = 0;
    let messagesSent = 0;
    // biome-ignore lint: This is used in the queue handler
    let messageSendErrors = 0;
    const queueSendLimit = pLimit(50);
    const queueSendPromises: Promise<unknown>[] = [];
    let messageDelaySeconds = 0;

    const processedHeadlines = fetchResults.flatMap((result) => {
      logger.debug({ url: result.url, hasError: !!result.error }, "Processing fetch result");
      if (result.error) {
        logger.warn(`Fetch failed for ${result.url}: ${result.error.message}`);
        return [];
      }
      const urlWithoutProtocol = result.url.replace("https://", "");

      const publicationId = publicationUrlToIdMap.get(urlWithoutProtocol);

      if (!publicationId) {
        logger.warn(`Could not find publication ID for URL: ${result.url}. Skipping its results.`);
        return [];
      }

      const transformedResults = result.results.map((item) => ({
        url: item.link,
        headline: item.title,
        snippet: item.snippet ?? null,
        source: item.source,
        rawDate: item.date ?? null,
        normalizedDate: parseSerperDate(item.date)?.toLocaleDateString("en-GB") ?? null,
        category: null,
        publicationId,
      }));

      logger.debug(
        { url: result.url, count: transformedResults.length },
        "Transformed results for publication"
      );
      return transformedResults;
    });

    const totalFetched = processedHeadlines.length;
    logger.info(`Total headlines fetched across all publications: ${totalFetched}`);

    for (const item of processedHeadlines) {
      const parsedDate = parseSerperDate(item.rawDate);
      if (parsedDate) {
        headlinesFilteredCount++;
        const messagePayload: ProcessNewsItemParams = {
          headlineUrl: item.url,
          publicationId: item.publicationId,
          headlineText: item.headline,
          snippet: item.snippet,
          source: item.source,
          rawDate: item.rawDate,
          normalizedDate: item.normalizedDate,
        };

        if (messagesSent > 0 && messagesSent % 10 === 0) {
          messageDelaySeconds++;
          logger.debug(`Increased message delay to ${messageDelaySeconds} seconds.`);
        }

        queueSendPromises.push(
          queueSendLimit(async () => {
            try {
              await env.NEWS_ITEM_QUEUE.send(messagePayload, { delaySeconds: messageDelaySeconds });
              logger.debug(
                `Sent message to queue for headline: ${item.url} with delay ${messageDelaySeconds}s`
              );
              messagesSent++;
            } catch (queueError) {
              logger.error(`Failed to send message to queue for headline: ${item.url}`, {
                error: queueError,
              });
              messageSendErrors++;
            }
          })
        );
      } else {
        logger.debug(
          { headline: item.headline, rawDate: item.rawDate },
          "Sync: Filtering result, could not parse date"
        );
      }
    }
    await Promise.allSettled(queueSendPromises);

    summary = {
      publicationsFetched: fetchResults.filter((r) => !r.error).length,
      totalHeadlinesFetched: totalFetched,
      headlinesWithinDateRange: headlinesFilteredCount,
      workflowsQueued: messagesSent,
      dateRange: { start: dateRange.start.toISOString(), end: dateRange.end.toISOString() },
    };

    // --- Update Sync Run Record (Completed) ---
    await updateSyncRun(env.DB, syncRunId, {
      status: "completed",
      summaryPublicationsFetched: summary.publicationsFetched,
      summaryTotalHeadlinesFetched: summary.totalHeadlinesFetched,
      summaryHeadlinesWithinRange: summary.headlinesWithinDateRange,
      summaryWorkflowsQueued: summary.workflowsQueued,
    });

    logger.info("Sync task finished successfully.", { syncRunId, ...summary });
    return summary;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error during sync task execution:", { syncRunId, error });

    if (syncRunId) {
      try {
        const updatePayload: UpdateSyncRunData = {
          status: "failed",
          errorMessage: errorMessage,
          summaryPublicationsFetched: summary?.publicationsFetched ?? null,
          summaryTotalHeadlinesFetched: summary?.totalHeadlinesFetched ?? null,
          summaryHeadlinesWithinRange: summary?.headlinesWithinDateRange ?? null,
          summaryWorkflowsQueued: summary?.workflowsQueued ?? null,
        };

        await updateSyncRun(env.DB, syncRunId, updatePayload);
        logger.info("Updated sync run record to failed status.", { syncRunId });
      } catch (updateError) {
        logger.error("Failed to update sync run record to failed status.", {
          syncRunId,
          updateError,
        });
      }
    }
    throw error;
  }
}

app.post(
  "/sync",
  authMiddleware,
  describeRoute({
    description: "Manually trigger a headline sync operation for a specified date range.",
    tags: ["Sync"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: { "application/json": { schema: ManualSyncRequestSchema } },
    },
    responses: {
      200: {
        description: "Sync operation completed successfully.",
        content: { "application/json": { schema: ManualSyncStdResponseSchema } },
      },
      400: {
        description: "Bad Request (Invalid Input)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_Sync"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_Sync"),
          },
        },
      },
      500: {
        description: "Internal Server Error (Sync Failed)",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_Sync"),
          },
        },
      },
    },
  }),
  zValidator("json", ManualSyncRequestSchema),
  async (c) => {
    const { dateRangeOption, customTbs, maxQueriesPerPublication } = c.req.valid("json");
    const logger = c.get("logger");

    try {
      // Pass 'manual' as the trigger type
      const syncSummary = await performHeadlineSync(
        c.env,
        logger,
        "manual",
        dateRangeOption,
        customTbs,
        maxQueriesPerPublication
      );

      return c.json(
        {
          data: syncSummary,
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      logger.error("Manual sync request failed", { error });
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: "Failed to perform headline sync.",
            code: "SYNC_FAILED",
            details: error instanceof Error ? error.message : String(error),
          },
        },
        500
      );
    }
  }
);

// --- New Endpoint to Get Last Sync Run ---
app.get(
  "/sync/latest",
  describeRoute({
    description: "Get the details of the most recent sync run.",
    tags: ["Sync"],
    responses: {
      200: {
        description: "Successful retrieval of the last sync run.",
        content: { "application/json": { schema: LastSyncRunStdResponseSchema } },
      },
      404: {
        description: "No sync runs found.",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse404_SyncLatest"),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_SyncLatest"),
          },
        },
      },
    },
  }),
  async (c) => {
    const logger = c.get("logger");
    try {
      const lastRun = await getLastSyncRun(c.env.DB);

      if (!lastRun) {
        logger.info("No sync runs found in the database.");
        return c.json(
          {
            data: null,
            success: false,
            error: { message: "No sync runs found.", code: "NOT_FOUND" },
          },
          404
        );
      }

      return c.json(
        {
          data: lastRun, // Already conforms to SyncRunSchema
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      // Use the standard DB error handler, providing a specific message
      return handleDatabaseError(c, error, "Failed to retrieve the last sync run");
    }
  }
);

// --- Export including scheduled and queue handlers ---
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(env);
    logger.info(`Cron Trigger Fired: ${new Date(event.scheduledTime).toISOString()}`);

    ctx.waitUntil(
      (async () => {
        try {
          await performHeadlineSync(env, logger, "scheduled", "Past 24 Hours", undefined, 5);
        } catch (error) {
          logger.error("Scheduled headline sync failed.", { error });
        }
      })()
    );
  },

  // --- Reinstate Queue Consumer Handler (using Workflow Binding) ---
  async queue(
    batch: MessageBatch<ProcessNewsItemParams>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const logger = createLogger(env);
    logger.info(`Queue handler started processing batch of size ${batch.messages.length}`);

    // Check for necessary bindings
    if (!env.PROCESS_NEWS_ITEM_WORKFLOW) {
      logger.error(
        "Queue Handler Error: PROCESS_NEWS_ITEM_WORKFLOW binding missing. Cannot process batch."
      );
      batch.retryAll();
      return;
    }
    // We assume the workflow itself has access to its needed bindings (DB, AI) via the runtime

    const promises = batch.messages.map(async (message) => {
      const messageId = message.id;
      const messageBody = message.body;
      logger.info(`Processing message ${messageId}`, { headlineUrl: messageBody.headlineUrl });

      try {
        // Create a new workflow instance for this message
        const instance = await env.PROCESS_NEWS_ITEM_WORKFLOW.create({ params: messageBody });
        logger.info(
          `Successfully triggered workflow instance ${instance.id} for message ${messageId}`
        );

        // Note: We don't await the workflow completion here.
        // The queue message is acknowledged once the workflow is successfully triggered.
        // Workflow success/failure is handled internally by the workflow and its steps.
        message.ack();
      } catch (error) {
        logger.error(`Error triggering workflow for message ${messageId}:`, { error });
        // Decide whether to retry based on the error.
        // Retrying might be suitable for transient issues creating the workflow instance.
        // If the error is persistent (e.g., invalid params), retrying won't help.
        // For now, let's retry on any error during creation.
        message.retry();
      }
    });

    // Wait for all workflow triggering promises to settle
    await Promise.allSettled(promises);
    logger.info(`Queue handler finished processing batch of size ${batch.messages.length}`);
  },
};

// Define the Workflow parameters
type ProcessNewsItemParams = {
  headlineUrl: string;
  publicationId: string;
  headlineText: string;
  snippet: string | null;
  source: string;
  rawDate: string | null;
  normalizedDate: string | null;
};

// Define the Workflow class (reverted to original structure)
export class ProcessNewsItemWorkflow extends WorkflowEntrypoint<Env, ProcessNewsItemParams> {
  async run(event: WorkflowEvent<ProcessNewsItemParams>, step: WorkflowStep) {
    // `this.env` is automatically populated by the runtime
    const { headlineUrl, publicationId, headlineText, snippet, source, rawDate, normalizedDate } =
      event.payload;
    const workflowLogger = {
      log: (message: string, data?: object) =>
        console.log(
          `[WF ${event.instanceId ?? "N/A"}] ${message}`,
          data ? JSON.stringify(data) : ""
        ),
      warn: (message: string, data?: object) =>
        console.warn(
          `[WF ${event.instanceId ?? "N/A"}] WARN: ${message}`,
          data ? JSON.stringify(data) : ""
        ),
      error: (message: string, data?: object) =>
        console.error(
          `[WF ${event.instanceId ?? "N/A"}] ERROR: ${message}`,
          data ? JSON.stringify(data) : ""
        ),
    };
    workflowLogger.log("Starting ProcessNewsItemWorkflow", { headlineUrl, publicationId });

    // Step 1: Check if headline exists
    const existingHeadline = await step.do(
      "check database for existing record",
      {
        retries: {
          // Add retry logic
          limit: 3,
          delay: "1 second",
          backoff: "exponential",
        },
        timeout: "30 seconds", // Add a reasonable timeout
      },
      async () => {
        workflowLogger.log("Checking database for URL", { headlineUrl });
        if (!this.env.DB) {
          workflowLogger.error("Workflow Error: DB binding missing.");
          throw new Error("Database binding (DB) is not configured.");
        }
        try {
          const record = await getHeadlineByUrl(this.env.DB, headlineUrl);
          workflowLogger.log("Database check result", { exists: !!record });
          return record ? { exists: true, id: record.id } : { exists: false };
        } catch (dbError) {
          workflowLogger.error("Workflow Step Error: Failed to query database", {
            headlineUrl,
            dbError,
          });
          throw dbError;
        }
      }
    );

    // Step 2: Decide Path
    if (existingHeadline.exists) {
      workflowLogger.log("Record already exists, skipping.", {
        id: existingHeadline.id,
        url: headlineUrl,
      });
      // @ts-ignore - state property might not be in WorkflowStep type yet
      step.state = { outcome: "skipped_exists", existingId: existingHeadline.id };
      return;
    }

    // Step 3: Analyze New Headline with Google AI
    workflowLogger.log("Headline does not exist, proceeding to analyze.", { headlineUrl });
    await step.do(
      "analyze and categorize headline",
      {
        retries: {
          limit: 3,
          delay: "5 seconds",
          backoff: "exponential",
        },
        timeout: "1 minute",
      },
      async () => {
        workflowLogger.log("Starting Google AI analysis", { headlineText });
        if (!this.env.GOOGLE_AI_STUDIO_API_KEY) {
          workflowLogger.error("Workflow Error: GOOGLE_AI_STUDIO_API_KEY missing.");
          throw new Error("Google AI API Key is not configured.");
        }
        if (!this.env.AI) {
          workflowLogger.error("Workflow Error: AI binding missing.");
          throw new Error("AI binding is not configured.");
        }
        return "other";
      }
    );

    // --- Retrieve category from step state ---
    // @ts-ignore - state property might not be in WorkflowStep type yet
    const stateCategory = (step.state as { category: string | null })?.category;
    // Ensure the category is valid or default to 'other' - use specific type assertion
    const headlineCategory = headlineCategories.includes(
      stateCategory as (typeof headlineCategories)[number]
    )
      ? (stateCategory as (typeof headlineCategories)[number])
      : "other";

    // Step 4: Store New Headline in DB
    await step.do(
      "store new headline in db",
      {
        // Add retry logic
        retries: {
          limit: 3,
          delay: "1 second",
          backoff: "exponential",
        },
        timeout: "30 seconds", // Add a reasonable timeout
      },
      async () => {
        // ---> Add check for valid publicationId from payload <---
        if (!publicationId) {
          workflowLogger.error(
            "Workflow Step Error: Missing or invalid publicationId in payload. Cannot store headline.",
            {
              headlineUrl,
              receivedPublicationId: publicationId,
            }
          );
          // Skip the insert attempt if publicationId is invalid
          // @ts-ignore - state property might not be in WorkflowStep type yet
          step.state = { outcome: "skipped_invalid_pub_id" };
          return { inserted: false, skipped: true };
        }
        // ---> End check <---

        workflowLogger.log("Attempting to store new headline", {
          headlineUrl,
          category: headlineCategory,
        });
        if (!this.env.DB) {
          workflowLogger.error("Workflow Error: DB binding missing for insert.");
          throw new Error("Database binding (DB) is not configured.");
        }
        const headlineData: Omit<InsertHeadline, "id"> = {
          url: headlineUrl,
          headline: headlineText,
          snippet: snippet,
          source: source,
          rawDate: rawDate,
          normalizedDate: normalizedDate,
          category: headlineCategory, // Use the validated category
          publicationId: publicationId,
        };
        try {
          await insertHeadline(this.env.DB, headlineData);
          workflowLogger.log("Successfully inserted new headline", { headlineUrl });
          // @ts-ignore - state property might not be in WorkflowStep type yet
          step.state = { outcome: "inserted_new" };
          return { inserted: true };
        } catch (dbError) {
          if (
            dbError instanceof Error &&
            dbError.name === "DatabaseError" &&
            dbError.message.includes("already exists")
          ) {
            workflowLogger.warn(`Headline likely inserted concurrently. URL: ${headlineUrl}`, {
              dbErrorDetails: (dbError as DatabaseError).details,
            });
            // @ts-ignore - state property might not be in WorkflowStep type yet
            step.state = { outcome: "skipped_concurrent_insert" };
            return { inserted: false, concurrent: true };
          }
          workflowLogger.error("Workflow Step Error: Failed to insert headline", {
            headlineData,
            dbError,
          });
          throw dbError;
        }
      }
    );

    workflowLogger.log("Finished ProcessNewsItemWorkflow", { headlineUrl });
  }
}
