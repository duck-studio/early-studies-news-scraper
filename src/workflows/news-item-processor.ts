import { getHeadlineByUrl, insertHeadline } from '../db/queries';
import { HeadlineCategory, headlineCategories } from '../db/schema';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

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

/**
 * Workflow for processing and categorizing news headlines
 */
export class ProcessNewsItemWorkflow extends WorkflowEntrypoint<Env, ProcessNewsItemParams> {
  async run(event: WorkflowEvent<ProcessNewsItemParams>, step: WorkflowStep) {
    const { headlineUrl, publicationId, headlineText, snippet, source, rawDate, normalizedDate } =
      event.payload;

    // Simple logger for workflow steps
    const workflowLogger = {
      log: (message: string, data?: object) =>
        console.log(
          `[WF ${event.instanceId ?? 'N/A'}] ${message}`,
          data ? JSON.stringify(data) : ''
        ),
      warn: (message: string, data?: object) =>
        console.warn(
          `[WF ${event.instanceId ?? 'N/A'}] WARN: ${message}`,
          data ? JSON.stringify(data) : ''
        ),
      error: (message: string, data?: object) =>
        console.error(
          `[WF ${event.instanceId ?? 'N/A'}] ERROR: ${message}`,
          data ? JSON.stringify(data) : ''
        ),
    };

    workflowLogger.log('Starting ProcessNewsItemWorkflow', { headlineUrl, publicationId });

    // Step 1: Check if headline exists
    const existingHeadline = await step.do(
      'check database for existing record',
      {
        retries: {
          limit: 3,
          delay: '1 second',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        workflowLogger.log('Checking database for URL', { headlineUrl });
        if (!this.env.DB) {
          workflowLogger.error('Workflow Error: DB binding missing.');
          throw new Error('Database binding (DB) is not configured.');
        }
        try {
          const record = await getHeadlineByUrl(this.env.DB, headlineUrl);
          workflowLogger.log('Database check result', { exists: !!record });
          return record ? { exists: true, id: record.id } : { exists: false };
        } catch (dbError) {
          workflowLogger.error('Workflow Step Error: Failed to query database', {
            headlineUrl,
            dbError,
          });
          throw dbError;
        }
      }
    );

    // Step 2: Decide Path
    if (existingHeadline.exists) {
      workflowLogger.log('Record already exists, skipping.', {
        id: existingHeadline.id,
        url: headlineUrl,
      });
      // @ts-ignore - state property might not be in WorkflowStep type yet
      step.state = { outcome: 'skipped_exists', existingId: existingHeadline.id };
      return;
    }

    // Step 3: Analyze New Headline with Google AI (simplified for now)
    workflowLogger.log('Headline does not exist, proceeding to analyze.', { headlineUrl });
    const headlineCategory = await step.do(
      'analyze and categorize headline',
      {
        retries: {
          limit: 3,
          delay: '5 seconds',
          backoff: 'exponential',
        },
        timeout: '1 minute',
      },
      async () => {
        workflowLogger.log('Starting headline analysis', { headlineText });
        // Simplified category assignment - in production this would use AI
        return 'other';
      }
    );

    // Ensure the category is valid
    const category = headlineCategories.includes(headlineCategory as HeadlineCategory)
      ? headlineCategory
      : 'other';

    // Step 4: Store New Headline in DB
    await step.do(
      'store new headline in db',
      {
        retries: {
          limit: 3,
          delay: '1 second',
          backoff: 'exponential',
        },
        timeout: '30 seconds',
      },
      async () => {
        if (!publicationId) {
          workflowLogger.error(
            'Workflow Step Error: Missing or invalid publicationId in payload. Cannot store headline.',
            {
              headlineUrl,
              receivedPublicationId: publicationId,
            }
          );
          // Skip the insert attempt if publicationId is invalid
          // @ts-ignore - state property assignment
          step.state = { outcome: 'skipped_invalid_pub_id' };
          return { inserted: false, skipped: true };
        }

        workflowLogger.log('Attempting to store new headline', {
          headlineUrl,
          category,
        });

        if (!this.env.DB) {
          workflowLogger.error('Workflow Error: DB binding missing for insert.');
          throw new Error('Database binding (DB) is not configured.');
        }

        const headlineData = {
          url: headlineUrl,
          headline: headlineText,
          snippet: snippet,
          source: source,
          rawDate: rawDate,
          normalizedDate: normalizedDate,
          category: category,
          publicationId: publicationId,
        };

        try {
          await insertHeadline(this.env.DB, headlineData);
          workflowLogger.log('Successfully inserted new headline', { headlineUrl });
          // @ts-ignore - state property assignment
          step.state = { outcome: 'inserted_new' };
          return { inserted: true };
        } catch (dbError) {
          if (
            dbError instanceof Error &&
            dbError.name === 'DatabaseError' &&
            dbError.message.includes('already exists')
          ) {
            workflowLogger.warn(`Headline likely inserted concurrently. URL: ${headlineUrl}`);
            // @ts-ignore - state property assignment
            step.state = { outcome: 'skipped_concurrent_insert' };
            return { inserted: false, concurrent: true };
          }

          workflowLogger.error('Workflow Step Error: Failed to insert headline', {
            headlineData,
            dbError,
          });
          throw dbError;
        }
      }
    );

    workflowLogger.log('Finished ProcessNewsItemWorkflow', { headlineUrl });
  }
}
