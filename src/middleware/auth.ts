import { Context, Next } from 'hono';
import { Logger } from 'pino';
import { validateToken } from '../utils';

/**
 * Creates an authentication middleware that validates bearer tokens
 * @returns Hono middleware function
 */
export function createAuthMiddleware() {
  return async (c: Context<{ Variables: { logger: Logger; requestId: string }; Bindings: Env }>, next: Next) => {
    const logger = c.get('logger');
    const { missing, valid } = validateToken(
      c.req.header('Authorization'),
      `Bearer ${c.env.BEARER_TOKEN}`,
      logger
    );
    
    if (missing || !valid) {
      const status = missing ? 401 : 403;
      const code = missing ? 'AUTH_MISSING_TOKEN' : 'AUTH_INVALID_TOKEN';
      const message = missing ? 'Authorization token is missing' : 'Authorization token is invalid';
      
      logger.warn('Authentication failed', { message, status });
      
      return c.json(
        {
          data: null,
          success: false,
          error: { message: message, code: code },
        },
        status
      );
    }
    
    await next();
  };
}

// Export a singleton instance for convenience
export const authMiddleware = createAuthMiddleware();