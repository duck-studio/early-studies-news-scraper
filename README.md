# Hono Serper News Search API

A TypeScript-based API service built with Hono that aggregates news articles from multiple publications using the Serper API.

## Features

- Concurrent fetching of news articles from multiple publication URLs
- Configurable date ranges for news articles
- Region-specific search (US/UK)
- Rate limiting and credit management
- Robust error handling and retries
- Comprehensive logging
- Type-safe API with Zod validation

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Serper API key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd hono-serper-search
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your Serper API key:
```env
SERPER_API_KEY=your_api_key_here
PORT=3000
LOG_LEVEL=debug
NODE_ENV=development
```

## Development

Start the development server:
```bash
npm run dev
```

The server will start on port 3000 (or the port specified in your .env file).

## Building for Production

Build the TypeScript files:
```bash
npm run build
```

Start the production server:
```bash
npm start
```

## API Endpoints

### POST /search

Search for news articles from specified publications.

#### Request Body

```json
{
  "publicationUrls": ["https://example.com"],
  "region": "US",
  "dateRangeOption": "Past Week",
  "customTbs": "tbs=cdr:1,cd_min:2024-01-01", // Optional, required if dateRangeOption is "Custom"
  "maximumCreditsUsed": 300, // Optional, defaults to 300
  "maxQueriesPerPublication": 3, // Optional, defaults to 3
  "serperApiKey": "your_api_key" // Optional, can be provided via SERPER_API_KEY env var
}
```

#### Response

```json
[
  {
    "status": "fulfilled",
    "url": "https://example.com",
    "queriesMade": 2,
    "results": [
      {
        "title": "Article Title",
        "link": "https://example.com/article",
        "snippet": "Article snippet...",
        "date": "2024-03-20",
        "source": "Example News",
        "imageUrl": "https://example.com/image.jpg",
        "position": 1
      }
    ]
  }
]
```

## Error Handling

The API returns appropriate HTTP status codes and error messages:

- 400: Bad Request (validation errors, missing API key)
- 500: Internal Server Error

## Logging

The service uses Pino for logging. Log levels can be configured via the `LOG_LEVEL` environment variable:

- debug: Detailed logging (development)
- info: Standard logging (production)
- warn: Warning messages
- error: Error messages

## License

ISC 