import { z } from 'zod';
import "zod-openapi/extend"; // Import the extend for .openapi()
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
).openapi({ ref: 'HeadlinesFetchRequest' });

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
}).openapi({ ref: 'HeadlinesFetchResponse' });

export const ErrorResponseSchema = z.object({
  error: z.string(),
}).openapi({ ref: 'ErrorResponse' });

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
    name: z.string().openapi({ description: 'Name of the publication', example: 'The Example Times'}),
    url: z.string().openapi({ description: 'Primary URL of the publication (used as ID)', example: 'https://example.com/news'}),
    category: z.enum(publicationCategories).optional().nullable().openapi({ description: 'Category of the publication', example: 'broadsheet' }),
    createdAt: z.date().optional().openapi({ description: 'Timestamp of creation'}),
    updatedAt: z.date().optional().openapi({ description: 'Timestamp of last update'}),
});

export const RegionBaseSchema = z.object({
    name: z.string().openapi({ description: 'Name of the region (used as ID)', example: 'UK'}),
});

export const HeadlineBaseSchema = z.object({
    id: z.string().optional().openapi({ description: 'Internal unique ID (auto-generated)' }),
    url: z.string().openapi({ description: 'Canonical URL of the headline (used as ID)', example: 'https://example.com/news/article123'}),
    headline: z.string().openapi({ description: 'The headline text', example: 'Example Headline Takes World by Storm'}),
    snippet: z.string().optional().nullable().openapi({ description: 'A short snippet or summary', example: 'An example snippet describing the headline.' }),
    source: z.string().openapi({ description: 'The source or outlet reporting the headline', example: 'Example News Source' }),
    rawDate: z.string().optional().nullable().openapi({ description: 'The original date string found for the headline', example: 'Jan 1, 2024' }),
    normalizedDate: z.string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, { message: "Normalized date must be in DD/MM/YYYY format, if provided" })
      .optional()
      .nullable()
      .openapi({ description: 'A date string in DD/MM/YYYY format for display or simple filtering', example: '01/01/2024'}),
    category: z.enum(headlineCategories).optional().nullable().openapi({ description: 'Categorization of the headline topic', example: 'technology' }),
    publicationUrl: z.string().openapi({ description: 'URL of the publication this headline belongs to (must match a publication URL)', example: 'bbc.co.uk' }),
    createdAt: z.date().optional().openapi({ description: 'Timestamp of creation'}),
    updatedAt: z.date().optional().openapi({ description: 'Timestamp of last update'}),
});

// --- Schema for Select/Response (reflecting potential DB types) ---
export const PublicationSchema = PublicationBaseSchema.extend({
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    publicationRegions: z.array(z.object({ regionName: z.string() })).optional().openapi({ description: 'Regions associated with this publication'}),
}).openapi({ ref: 'Publication' });

export const HeadlineSchema = HeadlineBaseSchema.extend({
    id: z.string().openapi({ description: 'Internal unique ID' }),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    publicationName: z.string().optional().openapi({ description: 'Name of the associated publication'}),
    publicationCategory: z.enum(publicationCategories).optional().nullable().openapi({ description: 'Category of the associated publication'}),
    publicationUrl: z.string().optional().openapi({ description: 'URL of the associated publication'}),
}).openapi({ ref: 'Headline' });


// --- Schema for Insert/Upsert (matching Insert types from queries.ts) ---
export const InsertPublicationSchema = PublicationBaseSchema.omit({ createdAt: true, updatedAt: true })
    .openapi({ 
        ref: 'InsertPublication',
        example: { 
            name: "The Example Times",
            url: "https://example.com/news",
            category: "broadsheet"
        }
     }); 
export const InsertRegionSchema = RegionBaseSchema
    .openapi({ 
        ref: 'InsertRegion',
        example: { name: "UK" }
    }); 
export const InsertHeadlineSchema = HeadlineBaseSchema.omit({ id: true, createdAt: true, updatedAt: true })
    .openapi({ 
        ref: 'InsertHeadline',
        example: { 
            url: "https://www.bbc.co.uk/news/uk-politics-12345678", 
            headline: "Example BBC Headline Update",
            snippet: "An example snippet describing the latest political update from the BBC.",
            source: "BBC News",
            rawDate: "4 Apr 2025",
            normalizedDate: "04/04/2025",
            category: "politics",
            publicationUrl: "bbc.co.uk"
        }
    }); 

// --- Schemas for Request Bodies (Replacing Params/Queries) ---

// Body for POST /publications/query (was GetPublicationsQuerySchema)
export const PublicationsQueryBodySchema = z.object({
    category: z.enum(publicationCategories).optional().openapi({ description: 'Filter by publication category', example: 'broadsheet'}),
    regions: z.preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.string()).optional()
    ).openapi({ description: 'Filter by associated regions (comma-separated string or array)', example: ['UK','US'] }),
}).openapi({ ref: 'PublicationsQueryBody' });

// Body for POST /headlines/query (was GetHeadlinesQueryObjectSchema)
export const HeadlinesQueryBodySchema = z.object({
    startDate: z.string().datetime().optional().openapi({ description: 'Filter by start date (ISO 8601 format)', example: '2024-01-01T00:00:00Z'}),
    endDate: z.string().datetime().optional().openapi({ description: 'Filter by end date (ISO 8601 format)', example: new Date().toISOString() }),
    publicationCategory: z.enum(publicationCategories).optional().openapi({ description: 'Filter by the category of the publication', example: 'broadcaster'}),
    publicationRegions: z.preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.string()).optional()
    ).openapi({ description: 'Filter by the regions associated with the publication (comma-separated string or array)', example: ['UK']}),
    categories: z.preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.enum(headlineCategories)).optional()
    ).openapi({ description: 'Filter by headline category (comma-separated string or array)', example: ['politics']}),
    page: z.coerce.number().int().positive().optional().default(1).openapi({ description: 'Page number for pagination', example: 1}),
    pageSize: z.coerce.number().int().positive().optional().default(100).openapi({ description: 'Number of results per page', example: 10}),
}).openapi({ ref: 'HeadlinesQueryBody' });

// Body for DELETE /publications (was UrlParamSchema)
export const DeletePublicationBodySchema = z.object({ 
    url: z.string().openapi({ description: 'URL of the publication to delete', example: 'https://example.com/news' })
}).openapi({ ref: 'DeletePublicationBody' });

// Body for DELETE /regions (was NameParamSchema)
export const DeleteRegionBodySchema = z.object({ 
    name: z.string().openapi({ description: 'Name of the region to delete', example: 'UK' })
}).openapi({ ref: 'DeleteRegionBody' });

// Body for DELETE /headlines (was IdParamSchema)
export const DeleteHeadlineBodySchema = z.object({ 
    id: z.string().openapi({ description: 'ID of the headline to delete', example: 'abc123xyz' })
}).openapi({ ref: 'DeleteHeadlineBody' });

// --- Response Schemas (Unchanged) ---

// Response Schema for POST /headlines/query (was GET /headlines)
export const HeadlinesQueryResponseSchema = z.object({
    data: z.array(HeadlineSchema).openapi({ description: 'Array of headline objects matching the query' }),
    total: z.number().int().openapi({ description: 'Total number of headlines matching the query', example: 153 }),
    page: z.number().int().openapi({ description: 'The current page number', example: 1 }),
    pageSize: z.number().int().openapi({ description: 'The number of results per page', example: 100 }),
    totalPages: z.number().int().openapi({ description: 'The total number of pages available', example: 2 }),
}).openapi({ ref: 'HeadlinesQueryResponse' });
