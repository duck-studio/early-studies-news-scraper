import { Logger } from 'pino';

/**
 * Global variables and types used in the application
 * Note: Env types come from worker-configuration.d.ts
 */
declare global {
  /**
   * Variables available in Hono context
   */
  interface Variables {
    requestId: string;
    logger: Logger;
  }
}

/**
 * Workflow parameters for processing a news item
 */
export type ProcessNewsItemParams = {
  headlineUrl: string;
  publicationId: string;
  headlineText: string;
  snippet: string | null;
  source: string;
  rawDate: string | null;
  normalizedDate: string | null;
};
