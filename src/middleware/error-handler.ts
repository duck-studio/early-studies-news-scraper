import { Context, Next } from 'hono';
import { StatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { StandardErrorSchema } from '../schema';
import { DatabaseError } from '../db/queries';
import { Logger } from 'pino';
import { parseDdMmYyyy } from '../utils/date/parsers';

export function handleDatabaseError(
  c: Context<{ Variables: { logger: Logger; requestId: string }; Bindings: Env }>,
  error: unknown,
  defaultMessage = 'Database operation failed'
): Response {
  const logger = c.get('logger');
  let statusCode = 500;
  let errorPayload: z.infer<typeof StandardErrorSchema> = { message: defaultMessage };

  if (error instanceof Error && error.name === 'DatabaseError') {
    const dbError = error as DatabaseError;
    logger.error('Database error', { message: dbError.message, details: dbError.details });

    errorPayload = {
      message: dbError.message,
      code: 'DB_OPERATION_FAILED',
      details: dbError.details ?? undefined,
    };

    if (dbError.message.includes('already exists')) {
      statusCode = 409;
      errorPayload.code = 'DB_CONFLICT';
    } else if (dbError.message.includes('not found')) {
      statusCode = 404;
      errorPayload.code = 'DB_NOT_FOUND';
    }
  } else if (error instanceof Error) {
    logger.error('Unexpected application error', {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    errorPayload = { message: error.message || defaultMessage, code: 'UNEXPECTED_ERROR' };
  } else {
    logger.error('Unexpected non-error thrown', { error });
    errorPayload = { message: defaultMessage, code: 'UNKNOWN_ERROR' };
  }

  c.status(statusCode as StatusCode);
  return c.json({
    data: null,
    success: false,
    error: errorPayload,
  });
}

export function validateNonEmptyBody() {
  return async (
    c: Context<{ Variables: { logger: Logger; requestId: string }; Bindings: Env }>,
    next: Next
  ) => {
    const body = await c.req.json().catch(() => ({}));
    if (Object.keys(body).length === 0) {
      c.status(400);
      return c.json({
        data: null,
        success: false,
        error: { message: 'Request body cannot be empty for update', code: 'VALIDATION_ERROR' },
      });
    }

    await next();
  };
}

export function createApiResponse<T>(data: T | null, success: boolean, error: unknown = null, status = 200) {
  return {
    data,
    success,
    error,
    status
  };
}

export function validateAndParseDateRange(
  c: Context<{ Variables: { logger: Logger; requestId: string }; Bindings: Env }>,
  body: { startDate?: string; endDate?: string }
): { startDate: Date | undefined; endDate: Date | undefined } | null {
  const logger = c.get('logger');
  const startDate = parseDdMmYyyy(body.startDate);
  const endDate = parseDdMmYyyy(body.endDate);

  if (body.startDate && !startDate) {
    logger.warn('Invalid start date format provided:', { startDate: body.startDate });
    c.status(400);
    c.json({
      data: null,
      success: false,
      error: { message: 'Invalid start date format. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' },
    });
    return null;
  }
  
  if (body.endDate && !endDate) {
    logger.warn('Invalid end date format provided:', { endDate: body.endDate });
    c.status(400);
    c.json({
      data: null,
      success: false,
      error: { message: 'Invalid end date format. Use DD/MM/YYYY.', code: 'VALIDATION_ERROR' },
    });
    return null;
  }

  if (startDate && endDate && startDate > endDate) {
    logger.warn('Start date cannot be after end date', {
      startDate: body.startDate,
      endDate: body.endDate,
    });
    c.status(400);
    c.json({
      data: null,
      success: false,
      error: { message: 'Start date cannot be after end date.', code: 'VALIDATION_ERROR' },
    });
    return null;
  }

  return { startDate, endDate };
}