import { nanoid } from 'nanoid';
import pino from 'pino';
import type { Logger } from 'pino';
import type { Env } from './types/cloudflare';

/** Determines the log level based on environment bindings. */
const getLogLevel = (env: Env) =>
  env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug');

/** Pino logger options optimized for Cloudflare Workers. */
const getLoggerOptions = (env: Env): pino.LoggerOptions => ({
  level: getLogLevel(env),
  browser: {
    asObject: true,
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
    write: (o) => console.log(JSON.stringify(o)),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  enabled: true,
});

/** Creates a new logger instance with environment bindings. */
export function createLogger(env: Env): Logger {
  const logger = pino(getLoggerOptions(env));
  logger.info(
    `Logger initialized (level: ${getLogLevel(env)}, env: ${env.NODE_ENV || 'development'})`
  );
  return logger;
}

/**
 * Creates a child logger with request context.
 * @param logger - Parent logger instance
 * @param requestId - Optional request ID. If not provided, a new one will be generated.
 * @returns A child logger with request context
 */
export function createRequestLogger(logger: Logger, requestId?: string): Logger {
  const id = requestId || nanoid();
  return logger.child({ requestId: id });
}
