import { type ZodTypeAny, z } from 'zod';
import 'zod-openapi/extend'; // Import the extend for .openapi()
import { headlineCategories, publicationCategories } from './db/schema'; // Import enums

// --- Base Schemas ---
// const RegionSchema = z.enum(['US', 'UK']); // Remove unused enum conflicting with Zod schema
const PublicationUrlsSchema = z
  .array(z.string().url({ message: 'Each publication URL must be a valid URL.' }))
  .min(1, { message: 'At least one publication URL is required.' })
  .default([
    'https://bbc.co.uk',
    'https://theguardian.com',
    'https://telegraph.co.uk',
    'https://thetimes.co.uk',
    'https://ft.com',
    'https://economist.com',
    'https://independent.co.uk',
    'https://thesun.co.uk',
    'https://dailymail.co.uk',
    'https://mirror.co.uk',
    'https://express.co.uk',
    'https://standard.co.uk',
    'https://spectator.co.uk',
    'https://newstatesman.com',
  ]);
const DateRangeEnumSchema = z.enum([
  'Past Hour',
  'Past 24 Hours',
  'Past Week',
  'Past Month',
  'Past Year',
  'Custom',
]);

// Export the schema and inferred type
export { DateRangeEnumSchema };
export type DateRangeEnum = z.infer<typeof DateRangeEnumSchema>;

// --- Serper API Schemas ---
const SerperNewsItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string(),
  date: z.string(),
  source: z.string(),
  imageUrl: z.string().optional(),
  position: z.number().optional(),
});

// New schema for transformed news items
const TransformedNewsItemSchema = z.object({
  headline: z.string(),
  publicationUrl: z.string(),
  url: z.string(),
  snippet: z.string(),
  source: z.string(),
  rawDate: z.string(),
  normalizedDate: z.string().optional(),
});

const SerperSearchParametersSchema = z.object({
  q: z.string(),
  gl: z.string().optional(),
  location: z.string().optional(),
  type: z.string(),
  engine: z.string(),
  page: z.number().optional(),
  num: z.number().optional(),
  tbs: z.string().optional(),
});

const SerperNewsResultSchema = z.object({
  searchParameters: SerperSearchParametersSchema,
  news: z.array(SerperNewsItemSchema),
  credits: z.number(),
});

// --- API Response Schemas ---
const BaseResponseSchema = z.object({
  url: z.string(),
  queriesMade: z.number(),
  creditsConsumed: z.number(),
  results: z.array(TransformedNewsItemSchema),
});

const FetchSuccessSchema = BaseResponseSchema.extend({
  status: z.literal('fulfilled'),
});

const FetchFailureSchema = BaseResponseSchema.extend({
  status: z.literal('rejected'),
  reason: z.string(),
});

const FetchResultSchema = z.discriminatedUnion('status', [FetchSuccessSchema, FetchFailureSchema]);

// --- Request Schemas ---
const HeadlinesFetchRequestBaseSchema = z.object({
  publicationUrls: PublicationUrlsSchema,
  region: z.enum(['US', 'UK']),
  startDate: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'Start date must be in DD/MM/YYYY format' })
    .describe('Start date in DD/MM/YYYY format'),
  endDate: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'End date must be in DD/MM/YYYY format' })
    .describe('End date in DD/MM/YYYY format'),
  maxQueriesPerPublication: z
    .number()
    .int()
    .positive('Max queries per publication must be a positive integer.')
    .optional()
    .default(5),
  flattenResults: z
    .boolean()
    .optional()
    .default(true)
    .describe('If true, returns a flat array of headlines. If false, groups by publication URL.'),
  triggerWorkflow: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, trigger a processing workflow (categorization, DB check/insert) for each fetched headline that matches the date range.'
    ),
});

// --- Hono Request Input Schema ---
export const HeadlinesFetchRequestSchema = HeadlinesFetchRequestBaseSchema.refine(
  (data) => {
    // Validate that startDate is before or equal to endDate
    const startParts = data.startDate.split('/').map(Number);
    const endParts = data.endDate.split('/').map(Number);

    // Convert DD/MM/YYYY to Date objects for comparison
    const startDate = new Date(startParts[2], startParts[1] - 1, startParts[0]);
    const endDate = new Date(endParts[2], endParts[1] - 1, endParts[0]);

    return startDate <= endDate;
  },
  {
    message: 'Start date must be before or equal to end date',
    path: ['startDate'],
  }
).openapi({
  ref: 'HeadlinesFetchRequest',
  example: {
    publicationUrls: ['https://bbc.co.uk'],
    region: 'UK',
    startDate: '01/04/2025',
    endDate: '08/04/2025',
    maxQueriesPerPublication: 5,
    flattenResults: true,
    triggerWorkflow: false,
  },
});

// --- OpenAPI Response Schemas ---
const HeadlinesFetchSummarySchema = z.object({
  totalResults: z
    .number()
    .openapi({ description: 'Total number of headlines returned after filtering.' }),
  totalCreditsConsumed: z
    .number()
    .openapi({ description: 'Total Serper credits consumed by the requests.' }),
  totalQueriesMade: z
    .number()
    .openapi({ description: 'Total number of individual Serper API queries made.' }),
  successCount: z
    .number()
    .openapi({ description: 'Number of publication URLs successfully fetched.' }),
  failureCount: z
    .number()
    .openapi({ description: 'Number of publication URLs that failed to fetch.' }),
  workflowsQueued: z
    .number()
    .int()
    .optional()
    .openapi({ description: 'Number of workflows triggered if triggerWorkflow was true.' }),
});

// Export the summary schema type as well
export type HeadlinesFetchSummary = z.infer<typeof HeadlinesFetchSummarySchema>;

export const HeadlinesFetchResponseSchema = z
  .object({
    results: z.union([z.array(TransformedNewsItemSchema), z.array(FetchResultSchema)]).openapi({
      description:
        'Array of fetched headline results. Flat array if flattenResults is true, grouped by publication if false.',
    }),
    summary: HeadlinesFetchSummarySchema,
  })
  .openapi({ ref: 'HeadlinesFetchResponseData' });

// Updated Error Detail Schema (can be string or object)
const ErrorDetailSchema = z.union([z.string(), z.record(z.unknown())]).openapi({
  description:
    'Details about the error, can be a simple message or a structured object (e.g., Zod validation issues)',
});

// Simplified Error Response Schema for the `error` field
export const StandardErrorSchema = z
  .object({
    message: z.string().openapi({ description: 'Primary error message' }),
    code: z
      .string()
      .optional()
      .openapi({ description: 'Optional error code for programmatic handling' }),
    details: ErrorDetailSchema.optional(),
  })
  .openapi({
    ref: 'StandardError',
    description: 'Structure for error details in standard responses',
  });

// Generic function to create the standard response schema
export function createStandardResponseSchema<T extends ZodTypeAny>(
  dataSchema: T,
  refName?: string
) {
  const schema = z.object({
    data: dataSchema.nullable().openapi({
      description: 'Response data payload. Null if the operation failed or returned no data.',
    }),
    success: z.boolean().openapi({ description: 'Indicates whether the API call was successful.' }),
    error: StandardErrorSchema.nullable().openapi({
      description: 'Error details if success is false, otherwise null.',
    }),
  });
  // Apply the refName if provided for OpenAPI documentation
  return refName ? schema.openapi({ ref: refName }) : schema;
}

// Define standard validation error messages
const ValidationMessages = {
  required: 'This field is required',
  format: {
    url: 'Must be a valid URL',
    date: 'Must be a valid date in ISO format (YYYY-MM-DD)',
    datetime: 'Must be a valid date and time in ISO format',
  },
  string: {
    min: (min: number) => `Must be at least ${min} characters`,
    max: (max: number) => `Must be at most ${max} characters`,
    regex: 'Invalid format',
  },
  array: {
    min: (min: number) => `Must have at least ${min} item(s)`,
    max: (max: number) => `Must have at most ${max} item(s)`,
  },
};

// --- Derived Types ---
export type HeadlinesFetchRequestInput = z.input<typeof HeadlinesFetchRequestSchema>;
export type ValidatedHeadlinesFetchData = z.output<typeof HeadlinesFetchRequestSchema>;
export type SerperNewsItem = z.infer<typeof SerperNewsItemSchema>;
export type SerperNewsResult = z.infer<typeof SerperNewsResultSchema>;
export type FetchResult = z.infer<typeof FetchResultSchema>;
export type FetchSuccess = z.infer<typeof FetchSuccessSchema>;
export type FetchFailure = z.infer<typeof FetchFailureSchema>;
export type TransformedNewsItem = z.infer<typeof TransformedNewsItemSchema>;

// --- Internal Fetcher Helper Types ---
export type FetchAllPagesResult = {
  url: string;
  queriesMade: number;
  credits: number;
  results: SerperNewsItem[];
  error?: Error;
};

export type GeoParams = {
  gl: string;
  location: string;
};

// --- Basic Schemas ---
export const PublicationBaseSchema = z.object({
  id: z.string().optional().openapi({ description: 'Internal unique ID (auto-generated)' }),
  name: z
    .string()
    .min(1, { message: ValidationMessages.string.min(1) })
    .openapi({ description: 'Name of the publication', example: 'The Guardian' }),
  url: z.string().url({ message: ValidationMessages.format.url }).openapi({
    description: 'Primary URL of the publication (must be unique)',
    example: 'https://theguardian.com',
  }),
  category: z
    .enum(publicationCategories)
    .optional()
    .nullable()
    .openapi({ description: 'Category of the publication', example: 'broadsheet' }),
  createdAt: z.date().optional().openapi({ description: 'Timestamp of creation' }),
  updatedAt: z.date().optional().openapi({ description: 'Timestamp of last update' }),
});

export const RegionBaseSchema = z.object({
  id: z.string().optional().openapi({ description: 'Internal unique ID (auto-generated)' }),
  name: z
    .string()
    .min(1, { message: ValidationMessages.string.min(1) })
    .openapi({ description: 'Name of the region (must be unique)', example: 'UK' }),
});

export const HeadlineBaseSchema = z.object({
  id: z.string().optional().openapi({ description: 'Internal unique ID (auto-generated)' }),
  url: z.string().url({ message: ValidationMessages.format.url }).openapi({
    description: 'Canonical URL of the headline (must be unique)',
    example: 'https://www.bbc.co.uk/news/uk-politics-12345678',
  }),
  headline: z
    .string()
    .min(1, { message: ValidationMessages.string.min(1) })
    .openapi({
      description: 'The headline text',
      example: 'UK Government Announces New Budget Measures',
    }),
  snippet: z.string().optional().nullable().openapi({
    description: 'A short snippet or summary',
    example: 'Chancellor details spending plans for the upcoming fiscal year.',
  }),
  source: z
    .string()
    .min(1, { message: ValidationMessages.string.min(1) })
    .openapi({ description: 'The source or outlet reporting the headline', example: 'BBC News' }),
  rawDate: z.string().optional().nullable().openapi({
    description: 'The original date string found for the headline',
    example: '3 days ago',
  }),
  normalizedDate: z
    .string()
    .regex(/^\d{2}\/\d{2}\/\d{4}$/, {
      message: 'Normalized date must be in DD/MM/YYYY format, if provided',
    })
    .optional()
    .nullable()
    .openapi({
      description: 'A date string in DD/MM/YYYY format for display or simple filtering',
      example: '18/05/2024',
    }),
  category: z
    .enum(headlineCategories)
    .optional()
    .nullable()
    .openapi({ description: 'Categorization of the headline topic', example: 'politics' }),
  publicationId: z
    .string()
    .min(1, { message: ValidationMessages.string.min(1) })
    .openapi({
      description: 'ID of the publication this headline belongs to',
      example: '0VrZ2G7e',
    }),
  createdAt: z.date().optional().openapi({ description: 'Timestamp of creation' }),
  updatedAt: z.date().optional().openapi({ description: 'Timestamp of last update' }),
});

// --- Schema for Select/Response (reflecting potential DB types) ---
export const PublicationSchema = PublicationBaseSchema.extend({
  id: z.string().openapi({ description: 'Internal unique ID' }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  publicationRegions: z
    .array(z.object({ regionName: z.string() }))
    .optional()
    .openapi({ description: 'Regions associated with this publication' }),
}).openapi({ ref: 'Publication' });

export const RegionSchema = RegionBaseSchema.extend({
  id: z.string().openapi({ description: 'Internal unique ID' }),
}).openapi({ ref: 'Region' });

export const HeadlineSchema = HeadlineBaseSchema.extend({
  id: z.string().openapi({ description: 'Internal unique ID' }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  publicationName: z
    .string()
    .optional()
    .openapi({ description: 'Name of the associated publication' }),
  publicationCategory: z
    .enum(publicationCategories)
    .optional()
    .nullable()
    .openapi({ description: 'Category of the associated publication' }),
  publicationUrl: z
    .string()
    .optional()
    .openapi({ description: 'URL of the associated publication' }),
}).openapi({ ref: 'Headline' });

// --- Schema for Insert/Upsert (matching Insert types from queries.ts) ---
export const InsertPublicationSchema = PublicationBaseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).openapi({
  ref: 'InsertPublication',
  example: {
    name: 'The Example Herald',
    url: 'https://exampleherald.com',
    category: 'digital',
  },
});
export const InsertRegionSchema = RegionBaseSchema.omit({ id: true }).openapi({
  ref: 'InsertRegion',
  example: { name: 'Canada' },
});
export const InsertHeadlineSchema = HeadlineBaseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).openapi({
  ref: 'InsertHeadline',
  example: {
    url: 'https://www.bbc.co.uk/news/science-environment-99887766',
    headline: 'New Study Reveals Impact of Space Weather',
    snippet: 'Scientists release findings on solar flares and satellite communications.',
    source: 'BBC News',
    rawDate: '1 hour ago',
    normalizedDate: '21/05/2024',
    category: 'science',
    publicationId: '0VrZ2G7e',
  },
});

// --- Schemas for Request Bodies (Replacing Params/Queries) ---

// Body for POST /stats/headlines
export const StatsQueryBodySchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'Start date must be in DD/MM/YYYY format' })
      .openapi({
        description: 'Start date for statistics range (DD/MM/YYYY format)',
        example: '01/05/2024',
      }),
    endDate: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'End date must be in DD/MM/YYYY format' })
      .openapi({
        description: 'End date for statistics range (DD/MM/YYYY format)',
        example: '31/05/2024',
      }),
  })
  .openapi({ ref: 'StatsQueryBody' });

// Body for POST /publications/query (was GetPublicationsQuerySchema)
export const PublicationsQueryBodySchema = z
  .object({
    category: z
      .enum(publicationCategories)
      .optional()
      .openapi({ description: 'Filter by publication category', example: 'broadcaster' }),
    regionNames: z
      .preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.string()).optional()
      )
      .openapi({
        description: 'Filter by associated region names (comma-separated string or array)',
        example: ['UK'],
      }),
  })
  .openapi({ ref: 'PublicationsQueryBody' });

// Body for POST /headlines/query (was GetHeadlinesQueryObjectSchema)
export const HeadlinesQueryBodySchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'Start date must be in DD/MM/YYYY format' })
      .optional()
      .openapi({ description: 'Filter by start date (DD/MM/YYYY format)', example: '18/05/2024' }),
    endDate: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'End date must be in DD/MM/YYYY format' })
      .optional()
      .openapi({ description: 'Filter by end date (DD/MM/YYYY format)', example: '21/05/2024' }),
    publicationCategory: z.enum(publicationCategories).optional().openapi({
      description: 'Filter by the category of the publication',
      example: 'broadcaster',
    }),
    publicationRegionNames: z
      .preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.string()).optional()
      )
      .openapi({
        description:
          'Filter by the names of regions associated with the publication (comma-separated string or array)',
        example: ['UK'],
      }),
    categories: z
      .preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.enum(headlineCategories)).optional()
      )
      .openapi({
        description: 'Filter by headline category (comma-separated string or array)',
        example: ['politics', 'technology'],
      }),
    page: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(1)
      .openapi({ description: 'Page number for pagination', example: 1 }),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .default(100)
      .openapi({ description: 'Number of results per page', example: 10 }),
  })
  .openapi({ ref: 'HeadlinesQueryBody' });

// Body for DELETE /publications (was UrlParamSchema)
export const DeletePublicationBodySchema = z
  .object({
    id: z.string().openapi({ description: 'ID of the publication to delete', example: 'aV_4vVQq' }),
  })
  .openapi({ ref: 'DeletePublicationBody' });

// Body for DELETE /regions (was NameParamSchema)
export const DeleteRegionBodySchema = z
  .object({
    id: z.string().openapi({ description: 'ID of the region to delete', example: '9AS6YO5R' }),
  })
  .openapi({ ref: 'DeleteRegionBody' });

// Body for DELETE /headlines (was IdParamSchema)
export const DeleteHeadlineBodySchema = z
  .object({
    id: z.string().openapi({ description: 'ID of the headline to delete', example: 'eXIJBGp5' }),
  })
  .openapi({ ref: 'DeleteHeadlineBody' });

// --- Response Schemas (Unchanged) ---

// Response Schema for POST /headlines/query (was GET /headlines)
export const HeadlinesQueryResponseSchema = z
  .object({
    data: z
      .array(HeadlineSchema)
      .openapi({ description: 'Array of headline objects matching the query' }),
    total: z
      .number()
      .int()
      .openapi({ description: 'Total number of headlines matching the query', example: 153 }),
    page: z.number().int().openapi({ description: 'The current page number', example: 1 }),
    pageSize: z
      .number()
      .int()
      .openapi({ description: 'The number of results per page', example: 100 }),
    totalPages: z
      .number()
      .int()
      .openapi({ description: 'The total number of pages available', example: 2 }),
  })
  .openapi({ ref: 'HeadlinesQueryResponse' });

// --- Response Schemas using the standard format ---

// Define the structure for the data part of the stats response
const CategoryPercentageSchema = z
  .record(
    z.string(), // Category name
    z
      .number()
      .min(0)
      .max(100) // Percentage
  )
  .openapi({
    description: 'Percentage breakdown of headlines by category.',
    example: { politics: 55.5, world: 20.0, technology: 15.5, business: 9.0 },
  });

const PublicationCountSchema = z
  .object({
    publication: PublicationSchema.pick({ id: true, name: true, url: true, category: true }), // Include specific publication fields
    count: z
      .number()
      .int()
      .positive()
      .openapi({ description: 'Number of headlines for this publication in the range.' }),
  })
  .openapi({
    ref: 'PublicationCount',
    description: 'Headline count per publication within the date range.',
  });

const DailyCountSchema = z
  .object({
    date: z.string().openapi({ description: 'Date (DD/MM/YYYY)' }),
    count: z
      .number()
      .int()
      .positive()
      .openapi({ description: 'Number of headlines on this date.' }),
  })
  .openapi({
    ref: 'DailyCount',
    description: 'Headline count per day within the date range.',
  });

export const HeadlinesStatsSchema = z
  .object({
    categoryPercentage: CategoryPercentageSchema,
    publicationCounts: z.array(PublicationCountSchema),
    dailyCounts: z.array(DailyCountSchema),
  })
  .openapi({ ref: 'HeadlinesStatsData' });

// Standard response schema for the stats endpoint
export const HeadlinesStatsResponseSchema = createStandardResponseSchema(
  HeadlinesStatsSchema,
  'HeadlinesStatsResponse'
);

// Example: Standard response for getting a single publication
export const PublicationResponseSchema = createStandardResponseSchema(
  PublicationSchema,
  'PublicationResponse'
);

// Example: Standard response for getting a list of publications
export const PublicationsListResponseSchema = createStandardResponseSchema(
  z.array(PublicationSchema),
  'PublicationsListResponse'
);

// Standard response for getting regions
export const RegionsListResponseSchema = createStandardResponseSchema(
  z.array(RegionSchema),
  'RegionsListResponse'
);

// Standard response for getting headlines (paginated)
export const HeadlinesQueryStdResponseSchema = createStandardResponseSchema(
  HeadlinesQueryResponseSchema, // Original data structure is nested here
  'HeadlinesQueryResponse'
);

// Standard response for fetching headlines
export const HeadlinesFetchStdResponseSchema = createStandardResponseSchema(
  HeadlinesFetchResponseSchema, // Original data structure is nested here
  'HeadlinesFetchResponse' // Ref name for the whole standard response
);

// Standard response for single item creates/updates/deletes where the item is returned
export const SinglePublicationResponseSchema = createStandardResponseSchema(
  PublicationSchema,
  'SinglePublicationResponse'
);
export const SingleRegionResponseSchema = createStandardResponseSchema(
  RegionSchema,
  'SingleRegionResponse'
);
export const SingleHeadlineResponseSchema = createStandardResponseSchema(
  HeadlineSchema,
  'SingleHeadlineResponse'
);

// Generic success response with no specific data (e.g., for delete confirmation if not returning the item)
// If we *always* return the deleted item, we might not need this.
// export const SuccessResponseSchema = createStandardResponseSchema(z.null(), 'SuccessResponse');

// Keep the old ErrorResponseSchema for reference or direct use if needed,
// but StandardErrorSchema is preferred within the standard response envelope.
export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: 'Error message' }),
    code: z.string().optional().openapi({ description: 'Error code for programmatic handling' }),
    details: z.record(z.unknown()).optional().openapi({
      description: 'Additional error details that may help in debugging or understanding the error',
    }),
  })
  .openapi({ ref: 'ErrorResponse' }); // Keep original ref for now

// --- Schemas for Manual Sync Endpoint ---

export const ManualSyncRequestSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'Start date must be in DD/MM/YYYY format' })
      .describe('Start date in DD/MM/YYYY format'),
    endDate: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: 'End date must be in DD/MM/YYYY format' })
      .describe('End date in DD/MM/YYYY format'),
    maxQueriesPerPublication: z
      .number()
      .int()
      .positive('Max queries per publication must be a positive integer.')
      .optional()
      .default(5)
      .describe('Maximum number of Serper API queries per publication URL.'),
  })
  .refine(
    (data) => {
      // Validate that startDate is before or equal to endDate
      const startParts = data.startDate.split('/').map(Number);
      const endParts = data.endDate.split('/').map(Number);

      // Convert DD/MM/YYYY to Date objects for comparison
      const startDate = new Date(startParts[2], startParts[1] - 1, startParts[0]);
      const endDate = new Date(endParts[2], endParts[1] - 1, endParts[0]);

      return startDate <= endDate;
    },
    {
      message: 'Start date must be before or equal to end date',
      path: ['startDate'],
    }
  )
  .openapi({
    ref: 'ManualSyncRequest',
    description: 'Parameters for manually triggering a headline sync operation.',
    example: {
      startDate: '01/04/2025',
      endDate: '08/04/2025',
      maxQueriesPerPublication: 10,
    },
  });

export const ManualSyncResponseDataSchema = z
  .object({
    publicationsFetched: z
      .number()
      .int()
      .openapi({ description: 'Number of publications successfully fetched from Serper.' }),
    totalHeadlinesFetched: z.number().int().openapi({
      description: 'Total number of headlines initially fetched across all publications.',
    }),
    headlinesWithinDateRange: z
      .number()
      .int()
      .openapi({ description: 'Number of headlines that fell within the specified date range.' }),
    workflowsQueued: z.number().int().openapi({
      description: 'Number of ProcessNewsItemWorkflow instances successfully triggered.',
    }),
    dateRange: z
      .object({
        start: z.string().datetime(),
        end: z.string().datetime(),
      })
      .openapi({ description: 'The calculated date range used for the sync.' }),
  })
  .openapi({
    ref: 'ManualSyncResponseData',
    description: 'Summary results of the manual sync operation.',
  });

export const ManualSyncStdResponseSchema = createStandardResponseSchema(
  ManualSyncResponseDataSchema,
  'ManualSyncResponse'
);

// --- Sync Run API Schema ---

// Define the base schema corresponding to the syncRuns table
export const SyncRunSchema = z
  .object({
    id: z.string().openapi({ description: 'Unique ID of the sync run.' }),
    triggerType: z
      .enum(['manual', 'scheduled'])
      .openapi({ description: 'How the sync was triggered.' }),
    status: z
      .enum(['started', 'completed', 'failed'])
      .openapi({ description: 'Current status of the sync run.' }),
    startedAt: z.coerce.date().openapi({ description: 'Timestamp when the sync run started.' }),
    finishedAt: z.coerce
      .date()
      .nullable()
      .openapi({ description: 'Timestamp when the sync run finished (null if not finished).' }),
    dateRangeOption: z
      .string()
      .nullable()
      .openapi({ description: 'The date range option used for the sync.' }),
    customTbs: z
      .string()
      .nullable()
      .openapi({ description: 'The custom TBS string used, if any.' }),
    maxQueriesPerPublication: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'The max queries setting used.' }),
    summaryPublicationsFetched: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Number of publications fetched.' }),
    summaryTotalHeadlinesFetched: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Total headlines fetched.' }),
    summaryHeadlinesWithinRange: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Headlines within the date range.' }),
    summaryWorkflowsQueued: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Workflows triggered.' }),
    errorMessage: z
      .string()
      .nullable()
      .openapi({ description: "Error message if the status is 'failed'." }),
  })
  .openapi({ ref: 'SyncRun' });

// Standard response for getting the last sync run
export const LastSyncRunStdResponseSchema = createStandardResponseSchema(
  SyncRunSchema, // Use the SyncRunSchema for the data part
  'LastSyncRunResponse'
);
