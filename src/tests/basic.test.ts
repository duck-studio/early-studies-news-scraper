/**
 * Basic tests for the Hono Serper News Search API
 * 
 * These tests focus on the core functionality:
 * 1. Authentication with bearer token
 * 2. Correct counting of results
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
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
        source: 'Example News'
      },
      {
        title: 'Test Article 2',
        link: 'https://example.com/article2',
        snippet: 'This is another test article',
        date: '2 days ago',
        source: 'Example News'
      }
    ],
    credits: 1,
    searchParameters: {
      q: 'site:example.com',
      type: 'news'
    }
  })
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

  it('should correctly count results', async () => {
    const mockEnv = { BEARER_TOKEN: 'test-token', SERPER_API_KEY: 'test-key' };
    const res = await app.request('/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mockEnv.BEARER_TOKEN}`
      },
      body: JSON.stringify({
        publicationUrls: ['https://example.com'],
        region: 'US',
        flattenResults: true
      })
    }, mockEnv);

    expect(res.status).toBe(200);
    
    const data = await res.json() as unknown as {
      results: {
        headline: string;
      }[];
      summary: {
        totalResults: number;
      };
    };
    // We should have two results from our mock
    expect(data.results.length).toBe(2);
    expect(data.summary.totalResults).toBe(2);
    
    // Verify specific content in the results
    expect(data.results[0].headline).toBe('Test Article 1');
    expect(data.results[1].headline).toBe('Test Article 2');
  });
});