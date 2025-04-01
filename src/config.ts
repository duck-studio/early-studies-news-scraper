/** Configuration constants for the Serper search service. */
export const config = {
  /** Serper API endpoint for news search. */
  serperApiUrl: 'https://google.serper.dev/news',

  /** Number of results to request per Serper API page. Max is often 100. */
  resultsPerPage: 100,
  
  /** Maximum total results to fetch per publication (safety limit) */
  maxResultsPerPublication: 300,

  /** Maximum number of concurrent requests allowed to the Serper API. Adjust based on API limits and testing. */
  concurrencyLimit: 10, // Start conservatively

  /** Retry options for fetching individual Serper API pages. */
  retryOptions: {
    retries: 3, // Number of retry attempts on failure
    factor: 2, // Exponential backoff factor
    minTimeout: 1000, // Minimum delay between retries (ms)
    maxTimeout: 5000, // Maximum delay between retries (ms)
    randomize: true, // Add jitter to delays
  }
};
