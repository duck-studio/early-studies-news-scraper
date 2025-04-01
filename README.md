# Hono Serper News Search API

A TypeScript-based API service built with [Hono](https://hono.dev/) and deployed on [Cloudflare Workers](https://workers.cloudflare.com/) that aggregates news articles from multiple publications using the [Serper API](https://serper.dev/).

## Features

- Concurrent fetching of news articles from multiple publication URLs using `p-limit`.
- Configurable date ranges for news articles (including relative and custom ranges).
- Post-fetch date filtering using `date-fns` for improved accuracy against Serper's results.
- Region-specific search (US/UK supported).
- Configurable concurrency limit for Serper API calls.
- Robust error handling and retries using `async-retry`.
- Comprehensive logging with [Pino](https://getpino.io/).
  - Pretty-printed, human-readable logs in development using `pino-pretty`.
  - JSON logs suitable for production environments.
- Type-safe API with Zod validation and OpenAPI documentation generation.
- Bearer token authentication.

## Prerequisites

- Node.js (v18 or higher recommended)
- `pnpm` (recommended), `npm`, or `yarn`
- Cloudflare account and `wrangler` CLI installed (`npm install -g wrangler`)
- Serper API key

## Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd hono-serper-search
    ```

2.  Install dependencies:
    ```bash
    pnpm install
    # or npm install / yarn install
    ```

3.  Create a `.env` file in the root directory and add your secrets:
    ```dotenv
    # Your Serper API Key
    SERPER_API_KEY=your_serper_api_key_here

    # A secret token clients must send in the Authorization header
    BEARER_TOKEN=your_secret_bearer_token

    # Optional: Logging level (trace, debug, info, warn, error, fatal)
    # Defaults to 'debug' if NODE_ENV is not 'production', otherwise 'info'
    LOG_LEVEL=debug

    # Set to 'production' for production deployments (enables JSON logging)
    NODE_ENV=development
    ```
    *(Note: For actual Cloudflare deployments, use `wrangler secret put` to manage these secrets securely instead of a `.env` file)*

## Development

Start the development server using Wrangler:
```bash
pnpm run dev
# or npm run dev / yarn dev
# This typically runs `wrangler dev`
```
The worker will be available locally, usually at `http://localhost:8787`. Development logs will be pretty-printed to the console.

## Deployment

Deploy the worker to Cloudflare:
```bash
pnpm run deploy
# or npm run deploy / yarn deploy
# This typically runs `wrangler deploy`
```

## API Endpoints

### `GET /`
Returns basic information about the API.

### `GET /docs`
Serves an interactive API documentation UI (via Scalar).

### `GET /openapi`
Returns the OpenAPI specification JSON.

### `POST /search`

Search for news articles from specified publications.

**Authentication:** Requires an `Authorization: Bearer <token>` header, where `<token>` matches the `BEARER_TOKEN` environment variable/secret.

#### Request Body

```json
{
  "publicationUrls": ["https://www.bbc.co.uk/news", "https://www.nytimes.com"],
  "region": "UK", // "US" or "UK"
  "dateRangeOption": "Past 24 Hours", // "Past Hour", "Past 24 Hours", "Past Week", "Past Month", "Past Year", "Custom"
  "customTbs": null, // Required if dateRangeOption is "Custom", e.g., "cdr:1,cd_min:YYYY-MM-DD,cd_max:YYYY-MM-DD" (excluding "tbs=")
  "maxQueriesPerPublication": 5, // Optional, default: 5. Max Serper pages per URL.
  "flattenResults": true // Optional, default: true. If true, returns a single flat array of articles. If false, returns results grouped by publication.
}
```

#### Response (`flattenResults: true` - Default)

```json
{
  "results": [
    {
      "headline": "Article Headline from BBC",
      "publicationUrl": "https://www.bbc.co.uk/news",
      "url": "https://www.bbc.co.uk/news/article-id-1",
      "snippet": "Snippet of the BBC article...",
      "source": "bbc.co.uk",
      "publicationDate": "1 day ago" // Parsable date string from Serper
    },
    {
      "headline": "Article Headline from NYT",
      "publicationUrl": "https://www.nytimes.com",
      "url": "https://www.nytimes.com/article-id-2",
      "snippet": "Snippet of the NYT article...",
      "source": "nytimes.com",
      "publicationDate": "20 hours ago"
    }
    // ... more articles
  ],
  "summary": {
    "totalResults": 25, // Total articles *after* date filtering
    "totalCreditsConsumed": 6,
    "totalQueriesMade": 6, // Total Serper API calls made
    "successCount": 2, // Number of publications successfully fetched
    "failureCount": 0 // Number of publications that failed
  }
}
```

#### Response (`flattenResults: false`)

```json
{
  "results": [
    {
      "status": "fulfilled", // or "rejected"
      "url": "https://www.bbc.co.uk/news",
      "queriesMade": 3,
      "creditsConsumed": 3,
      "results": [ // Articles from this specific publication (after date filtering)
         {
           "headline": "Article Headline from BBC",
           "publicationUrl": "https://www.bbc.co.uk/news",
           "url": "https://www.bbc.co.uk/news/article-id-1",
           "snippet": "Snippet of the BBC article...",
           "source": "bbc.co.uk",
           "publicationDate": "1 day ago"
         }
         // ... more articles from BBC
      ]
      // "reason": "Error message" // Present only if status is "rejected"
    },
    {
       "status": "fulfilled",
       "url": "https://www.nytimes.com",
       "queriesMade": 3,
       "creditsConsumed": 3,
       "results": [
         {
           "headline": "Article Headline from NYT",
           "publicationUrl": "https://www.nytimes.com",
           "url": "https://www.nytimes.com/article-id-2",
           "snippet": "Snippet of the NYT article...",
           "source": "nytimes.com",
           "publicationDate": "20 hours ago"
         }
         // ... more articles from NYT
       ]
    }
  ],
  "summary": { // Summary remains the same structure
    "totalResults": 25,
    "totalCreditsConsumed": 6,
    "totalQueriesMade": 6,
    "successCount": 2,
    "failureCount": 0
  }
}
```


## Error Handling

The API returns appropriate HTTP status codes and error messages:

- `400 Bad Request`: Validation errors in the request body.
- `401 Unauthorized`: Missing or invalid `Authorization` header/token.
- `500 Internal Server Error`: Unhandled errors during processing, Serper API key missing, etc.

## Logging

The service uses Pino for structured logging.
- **Development:** When `NODE_ENV` is not `production`, logs are pretty-printed to the console via `pino-pretty`.
- **Production:** When `NODE_ENV` is `production`, logs are output as JSON, suitable for log aggregation services (like Cloudflare Logpush).
Log levels can be configured via the `LOG_LEVEL` environment variable/secret.

## License

ISC 