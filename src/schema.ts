import { z } from "zod";

// --- Base Schemas ---
const RegionSchema = z.enum(["US", "UK"]);
const PublicationUrlsSchema = z
  .array(z.string().url({ message: "Each publication URL must be a valid URL." }))
  .min(1, { message: "At least one publication URL is required." });
const DateRangeEnumSchema = z.enum([
  "Past Hour",
  "Past 24 Hours",
  "Past Week",
  "Past Month",
  "Past Year",
  "Custom",
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
});

// --- API Response Schemas ---
const BaseResponseSchema = z.object({
  url: z.string(),
  queriesMade: z.number(),
  results: z.array(SerperNewsItemSchema),
});

const FetchSuccessSchema = BaseResponseSchema.extend({
  status: z.literal("fulfilled"),
});

const FetchFailureSchema = BaseResponseSchema.extend({
  status: z.literal("rejected"),
  reason: z.string(),
});

const FetchResultSchema = z.discriminatedUnion("status", [
  FetchSuccessSchema,
  FetchFailureSchema,
]);

// --- Request Schemas ---
const SearchRequestBaseSchema = z.object({
  publicationUrls: PublicationUrlsSchema,
  region: RegionSchema,
  dateRangeOption: DateRangeEnumSchema.optional().default("Past Week"),
  customTbs: z
    .string()
    .startsWith("tbs=cdr:1,cd_min:", {
      message: "Custom TBS string must start with 'tbs=cdr:1,cd_min:'.",
    })
    .optional(),
  maximumCreditsUsed: z
    .number()
    .int()
    .positive("Maximum credits must be a positive integer.")
    .optional()
    .default(300),
  maxQueriesPerPublication: z
    .number()
    .int()
    .positive("Max queries per publication must be a positive integer.")
    .optional()
    .default(3),
  serperApiKey: z
    .string()
    .min(1, { message: "API Key cannot be empty string if provided." })
    .optional(),
});

// --- Hono Request Input Schema ---
export const SearchRequestSchema = SearchRequestBaseSchema.refine(
  (data) =>
    data.dateRangeOption !== "Custom" ||
    (typeof data.customTbs === "string" && data.customTbs.length > 0),
  {
    message:
      "The 'customTbs' parameter is required and must be non-empty when 'dateRangeOption' is 'Custom'.",
    path: ["customTbs"],
  }
);

// --- OpenAPI Response Schemas ---
export const SearchResponseSchema = z.array(FetchResultSchema);
export const ErrorResponseSchema = z.object({
  error: z.string(),
});

// --- Derived Types ---
export type SearchRequestInput = z.input<typeof SearchRequestSchema>;
export type ValidatedSearchData = z.output<typeof SearchRequestSchema>;
export type SerperNewsItem = z.infer<typeof SerperNewsItemSchema>;
export type SerperNewsResult = z.infer<typeof SerperNewsResultSchema>;
export type FetchResult = z.infer<typeof FetchResultSchema>;
export type FetchSuccess = z.infer<typeof FetchSuccessSchema>;
export type FetchFailure = z.infer<typeof FetchFailureSchema>;

// --- Internal Fetcher Helper Types ---
export type FetchAllPagesResult = {
  url: string;
  queriesMade: number;
  results: SerperNewsItem[];
  error?: Error;
};

export type TryConsumeCredit = () => boolean;

export type GeoParams = {
  gl: string;
  location: string;
};
