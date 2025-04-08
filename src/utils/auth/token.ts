import { Logger } from "pino";

/**
 * Validates an auth token against the expected token
 */
export function validateToken(
  userToken: string | undefined | null,
  expectedToken: string,
  logger?: Logger
): {
  missing: boolean;
  valid: boolean;
} {
  if (!userToken) {
    return { missing: true, valid: false };
  }

  if (userToken !== expectedToken) {
    if (logger) {
      logger.warn("Invalid token");
    }
    return { missing: false, valid: false };
  }
  
  return { missing: false, valid: true };
}