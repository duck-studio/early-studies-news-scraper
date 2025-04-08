import pLimit from "p-limit";
import type { Logger } from "pino";

/**
 * Options for queue batch processing
 */
export interface QueueBatchOptions {
  /** Maximum number of concurrent queue operations */
  concurrency?: number;
  /** Number of messages after which to increment delay */
  delayIncrementBatch?: number;
  /** Number of seconds to increment delay by */
  delayIncrementSeconds?: number;
  /** Initial delay in seconds */
  initialDelaySeconds?: number;
}

/**
 * Result of a batch queue operation
 */
export interface QueueBatchResult {
  /** Number of messages successfully sent */
  messagesSent: number;
  /** Number of message send errors */
  messageSendErrors: number;
}

/**
 * Sends a batch of messages to a queue with staggered delays
 * to prevent overwhelming downstream processors.
 * 
 * @param queue The Cloudflare Queue object to send messages to
 * @param payloads Array of message payloads to queue
 * @param logger Optional logger instance for detailed logging
 * @param options Queue batch processing options
 * @returns A promise resolving to the queue operation results
 */
export async function queueBatchMessages<T>(
  queue: Queue,
  payloads: T[],
  logger?: Logger,
  options: QueueBatchOptions = {}
): Promise<QueueBatchResult> {
  const {
    concurrency = 50,
    delayIncrementBatch = 10,
    delayIncrementSeconds = 1,
    initialDelaySeconds = 0,
  } = options;

  if (payloads.length === 0) {
    logger?.info("No messages to queue");
    return { messagesSent: 0, messageSendErrors: 0 };
  }

  logger?.info(`Attempting to queue ${payloads.length} messages with concurrency ${concurrency}`);

  const queueSendLimit = pLimit(concurrency);
  const queueSendPromises: Promise<unknown>[] = [];
  let messageDelaySeconds = initialDelaySeconds;
  let messagesSent = 0;
  let messageSendErrors = 0;

  for (const payload of payloads) {
    // Increment delay every delayIncrementBatch messages to stagger queue sends
    if (messagesSent > 0 && messagesSent % delayIncrementBatch === 0) {
      messageDelaySeconds += delayIncrementSeconds;
      logger?.debug(`Increased message delay to ${messageDelaySeconds} seconds`);
    }

    queueSendPromises.push(
      queueSendLimit(async () => {
        try {
          // Send to the queue
          await queue.send(payload, { delaySeconds: messageDelaySeconds });
          logger?.debug(`Sent message to queue with delay ${messageDelaySeconds}s`);
          messagesSent++;
        } catch (queueError) {
          logger?.error("Failed to send message to queue", { error: queueError });
          messageSendErrors++;
        }
      })
    );
  }

  // Wait for all queue send operations to settle
  await Promise.allSettled(queueSendPromises);
  
  logger?.info(`Queue operation complete. Sent: ${messagesSent}, Failed: ${messageSendErrors}`);
  
  return { messagesSent, messageSendErrors };
}