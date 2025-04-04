import { z } from 'zod';
import { headlineCategories, publicationCategories } from './db/schema'; // Import enums

// --- Base Schemas ---
const RegionSchema = z.enum(['US', 'UK']);
const PublicationUrlsSchema = z
  .array(z.string().url({ message: 'Each publication URL must be a valid URL.' }))
  .min(1, { message: 'At least one publication URL is required.' });
const DateRangeEnumSchema = z.enum([
  'Past Hour',
  'Past 24 Hours',
  'Past Week',
  'Past Month',
  'Past Year',
  'Custom',
]);

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
  region: RegionSchema,
  dateRangeOption: DateRangeEnumSchema.optional()
    .default('Past Week')
    .describe("Date range for the search. Defaults to 'Past Week' if not specified."),
  customTbs: z
    .string()
    .startsWith('tbs=cdr:1,cd_min:', {
      message: "Custom TBS string must start with 'tbs=cdr:1,cd_min:' (note: the 'tbs=' prefix will be automatically removed when sent to the API).",
    })
    .optional(),
  maxQueriesPerPublication: z
    .number()
    .int()
    .positive('Max queries per publication must be a positive integer.')
    .optional()
    .default(5),
  flattenResults: z.boolean().optional().default(true),
});

// --- Hono Request Input Schema ---
export const HeadlinesFetchRequestSchema = HeadlinesFetchRequestBaseSchema.refine(
  (data) =>
    data.dateRangeOption !== 'Custom' ||
    (typeof data.customTbs === 'string' && data.customTbs.length > 0),
  {
    message:
      "The 'customTbs' parameter is required and must be non-empty when 'dateRangeOption' is 'Custom'.",
    path: ['customTbs'],
  }
);

// --- OpenAPI Response Schemas ---
const HeadlinesFetchSummarySchema = z.object({
  totalResults: z.number(),
  totalCreditsConsumed: z.number(),
  totalQueriesMade: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
});

export const HeadlinesFetchResponseSchema = z.object({
  results: z.array(TransformedNewsItemSchema),
  summary: HeadlinesFetchSummarySchema,
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

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
    id: z.string().optional(), // Optional for insert, present for select
    name: z.string(),
    url: z.string().url(),
    category: z.enum(publicationCategories).optional().nullable(),
    createdAt: z.date().optional(), // Will be string date from DB, Zod handles conversion
    updatedAt: z.date().optional(), // Will be string date from DB
});

export const RegionBaseSchema = z.object({
    name: z.string(),
});

export const HeadlineBaseSchema = z.object({
    id: z.string().optional(),
    url: z.string().url(),
    headline: z.string(),
    snippet: z.string().optional().nullable(),
    source: z.string(),
    rawDate: z.string().optional().nullable(),
    normalizedDate: z.string().optional().nullable(), // Stored as text, may be date-like string
    category: z.enum(headlineCategories).optional().nullable(),
    publicationId: z.string().url(), // Foreign key
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
});

// --- Schema for Select/Response (reflecting potential DB types) ---
export const PublicationSchema = PublicationBaseSchema.extend({
    id: z.string(), // Required for select
    createdAt: z.coerce.date(), // Coerce from DB format (likely integer/timestamp)
    updatedAt: z.coerce.date(),
    // Potentially add publicationRegions relationship if needed in response
    publicationRegions: z.array(z.object({ regionName: z.string() })).optional(),
});

export const HeadlineSchema = HeadlineBaseSchema.extend({
    id: z.string(), // Required for select
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    // Add fields from Publication join for getHeadlines response
    publicationName: z.string().optional(),
    publicationCategory: z.enum(publicationCategories).optional().nullable(),
    publicationUrl: z.string().url().optional(),
});


// --- Schema for Insert/Upsert (matching Insert types from queries.ts) ---
export const InsertPublicationSchema = PublicationBaseSchema.omit({ id: true, createdAt: true, updatedAt: true }); // DB handles these
export const InsertRegionSchema = RegionBaseSchema; // Simple, no changes needed
export const InsertHeadlineSchema = HeadlineBaseSchema.omit({ id: true, createdAt: true, updatedAt: true }); // DB handles these

// --- Schemas for Route Parameters ---
export const UrlParamSchema = z.object({ url: z.string().transform(val => encodeURIComponent(val)) }); // Ensure URL safe param
export const NameParamSchema = z.object({ name: z.string().transform(val => encodeURIComponent(val)) });
export const IdParamSchema = z.object({ id: z.string() });


// --- Schemas for Query Parameters ---
export const GetPublicationsQuerySchema = z.object({
    category: z.enum(publicationCategories).optional(),
    regions: z.preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val), // Handle comma-separated string
        z.array(z.string()).optional()
    ),
});

export const GetHeadlinesQuerySchema = z.object({
    startDate: z.string().datetime().optional(), // Expect ISO string
    endDate: z.string().datetime().optional(),   // Expect ISO string
    publicationCategory: z.enum(publicationCategories).optional(),
    publicationRegions: z.preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.string()).optional()
    ),
    categories: z.preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.enum(headlineCategories)).optional()
    ),
    page: z.coerce.number().int().positive().optional().default(1),
    pageSize: z.coerce.number().int().positive().optional().default(100), // Match default in query
}).transform(values => ({ // Remap to match HeadlineFilters structure
    ...values,
    publicationFilters: {
        category: values.publicationCategory,
        regions: values.publicationRegions,
    }
}));

// For use with getHeadlines endpoint which returns paginated data directly
export const HeadlinesQueryResponseSchema = z.object({
    data: z.array(HeadlineSchema), // Use the detailed HeadlineSchema
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalPages: z.number().int(),
});
