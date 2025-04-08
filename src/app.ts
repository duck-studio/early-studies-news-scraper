// Use types from worker-configuration.d.ts
import { createLogger } from './logger';
import { createAppRouter } from './routes';
import { performHeadlineSync } from './routes/sync';
import { ProcessNewsItemParams, ProcessNewsItemWorkflow } from './workflows';

/**
 * Main application export for Cloudflare Workers
 */
export default {
  // API request handler
  fetch: createAppRouter().fetch,

  // Scheduled task handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(env);
    logger.info(`Cron Trigger Fired: ${new Date(event.scheduledTime).toISOString()}`);

    ctx.waitUntil(
      (async () => {
        try {
          await performHeadlineSync(env, logger, 'scheduled', 'Past 24 Hours', 'Past 24 Hours', 5);
        } catch (error) {
          logger.error('Scheduled headline sync failed.', { error });
        }
      })()
    );
  },

  // Queue consumer handler
  async queue(
    batch: MessageBatch<ProcessNewsItemParams>,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const logger = createLogger(env);
    logger.info(`Queue handler started processing batch of size ${batch.messages.length}`);

    // Check for necessary bindings
    if (!env.PROCESS_NEWS_ITEM_WORKFLOW) {
      logger.error(
        'Queue Handler Error: PROCESS_NEWS_ITEM_WORKFLOW binding missing. Cannot process batch.'
      );
      batch.retryAll();
      return;
    }

    const promises = batch.messages.map(async (message) => {
      const messageId = message.id;
      const messageBody = message.body;
      logger.info(`Processing message ${messageId}`, { headlineUrl: messageBody.headlineUrl });

      try {
        // Create a new workflow instance for this message
        const instance = await env.PROCESS_NEWS_ITEM_WORKFLOW.create({ params: messageBody });
        logger.info(
          `Successfully triggered workflow instance ${instance.id} for message ${messageId}`
        );
        message.ack();
      } catch (error) {
        logger.error(`Error triggering workflow for message ${messageId}:`, { error });
        message.retry();
      }
    });

    // Wait for all workflow triggering promises to settle
    await Promise.allSettled(promises);
    logger.info(`Queue handler finished processing batch of size ${batch.messages.length}`);
  },
};

// Export workflow implementation
export { ProcessNewsItemWorkflow };
