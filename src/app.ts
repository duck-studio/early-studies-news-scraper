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
          // Check if sync is enabled in settings
          const { getSettings } = await import('./db/queries');
          let settings = null;

          try {
            settings = await getSettings(env.DB);
          } catch (dbError) {
            logger.warn('Could not fetch settings from database. Using environment variables.', {
              dbError,
            });
          }

          // If settings aren't available, use environment variables
          const syncEnabled = settings?.syncEnabled ?? env.SYNC_ENABLED === 'true';
          const syncFrequency = settings?.syncFrequency ?? env.SYNC_FREQUENCY ?? 'daily';
          const defaultRegion = settings?.defaultRegion ?? env.DEFAULT_REGION ?? 'UK';

          if (!syncEnabled) {
            logger.info('Scheduled sync is disabled in settings. Skipping sync.');
            return;
          }

          // Get current cron expression from scheduled event
          const cronExpression = event.cron;
          // Use syncFrequency from earlier (with fallbacks)

          // Determine if we should run based on sync frequency setting
          let shouldRun = false;

          // Map cron expressions to frequency options
          if (cronExpression === '0 0 * * *' && syncFrequency === 'daily') {
            shouldRun = true;
          } else if (cronExpression === '0 0 */2 * *' && syncFrequency === 'everyOtherDay') {
            shouldRun = true;
          } else if (cronExpression === '0 0 * * 1' && syncFrequency === 'weekly') {
            shouldRun = true;
          } else if (cronExpression === '0 0 1,15 * *' && syncFrequency === 'fortnightly') {
            shouldRun = true;
          } else if (cronExpression === '0 0 1 * *' && syncFrequency === 'monthly') {
            shouldRun = true;
          }

          // If frequency doesn't match the current cron, skip execution
          if (!shouldRun) {
            logger.info(
              `Scheduled sync skipped: Current frequency setting (${syncFrequency}) doesn't match this cron trigger (${cronExpression}).`
            );
            return;
          }

          // Get yesterday and today's dates in DD/MM/YYYY format
          const today = new Date();
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);

          const yesterdayStr = yesterday.toLocaleDateString('en-GB'); // Format as DD/MM/YYYY
          const todayStr = today.toLocaleDateString('en-GB'); // Format as DD/MM/YYYY

          logger.info(`Running scheduled sync with defaultRegion: ${defaultRegion}`);
          await performHeadlineSync(
            env,
            logger,
            'scheduled',
            yesterdayStr,
            todayStr,
            5,
            defaultRegion
          );
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
