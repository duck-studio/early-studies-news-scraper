import { z } from 'zod';

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
  publicationDate: z.string(),
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
