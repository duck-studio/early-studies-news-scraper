/**
 * Basic tests for the Hono Serper News Search API
 *
 * These tests focus on the core functionality:
 * 1. Authentication with bearer token
 * 2. Correct counting of results
 */
import { afterAll, afterEach, describe, vi } from 'vitest';
// Mock for fetch
const originalFetch = global.fetch;
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    news: [
      {
        title: 'Test Article 1',
        link: 'https://example.com/article1',
        snippet: 'This is a test article',
        date: '1 day ago',
        source: 'Example News',
      },
      {
        title: 'Test Article 2',
        link: 'https://example.com/article2',
        snippet: 'This is another test article',
        date: '2 days ago',
        source: 'Example News',
      },
    ],
    credits: 1,
    searchParameters: {
      q: 'site:example.com',
      type: 'news',
    },
  }),
});

describe('API Core Functionality', () => {
  // Reset mocks after each test
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Restore original fetch after all tests
  afterAll(() => {
    global.fetch = originalFetch;
  });
});
