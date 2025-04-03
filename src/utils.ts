import {
  isValid,
  lightFormat,
  parse,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subSeconds,
  subWeeks,
  subYears
} from 'date-fns';
import { Logger } from 'pino';
import type { GeoParams } from './schema';

export function validateToken(userToken: string | undefined | null, expectedToken: string, logger?: Logger): {
  missing: boolean;
  valid: boolean;
} {
  if (!userToken) {
    return { missing: true, valid: false };
  }
  if (userToken !== expectedToken) {
    if (logger) {
      logger.warn('Invalid token');
    }
    return { missing: false, valid: false };
  }
  return { missing: false, valid: true };
}

/**
 * Converts a user-friendly date range option and optional custom TBS
 * into the corresponding Serper API 'tbs' parameter string.
 */
export function getTbsString(dateRangeOption: string, customTbs?: string, logger?: Logger): string {
  const tbs = (() => {
    switch (dateRangeOption) {
      case 'Past Hour':
        return 'qdr:h';
      case 'Past 24 Hours':
        return 'qdr:d';
      case 'Past Week':
        return 'qdr:w'; // Default handled by schema
      case 'Past Month':
        return 'qdr:m';
      case 'Past Year':
        return 'qdr:y';
      case 'Custom': {
        // Remove tbs= prefix if present in customTbs
        const cleanCustomTbs = customTbs ? 
          (customTbs.startsWith('tbs=') ? customTbs.substring(4) : customTbs) : 
          'qdr:w';
        return cleanCustomTbs;
      }
      default:
        // Should be unreachable due to schema validation & default
        if (logger) {
          logger.warn(
            `Unrecognized dateRangeOption '${dateRangeOption}', falling back to 'Past Week'.`
          );
        }
        return 'qdr:w';
    }
  })();

  if (logger) {
    logger.info(`TIME FILTER DETAILS:
Date Range Option: "${dateRangeOption}"
Custom TBS Value: "${customTbs || 'none'}"
Final TBS Value: "${tbs}"
Example Query: site:example.com with timeframe parameter 'tbs=${tbs}'`);
  }

  return tbs;
}

/**
 * Maps the application's region ('US' | 'UK') to Serper's
 * geographical parameters ('gl' and 'location').
 */
export function getGeoParams(region: string, logger?: Logger): GeoParams {
  switch (region) {
    case 'US':
      return { gl: 'us', location: 'United States' };
    case 'UK':
      return { gl: 'gb', location: 'United Kingdom' };
    default:
      // Should be unreachable due to schema validation
      if (logger) {
        logger.warn(`Unrecognized region '${region}', falling back to 'US'.`);
      }
      return { gl: 'us', location: 'United States' };
  }
}

// --- Date Utilities ---

/** Defines the start and end dates for filtering */
type DateRange = {
  start: Date;
  end: Date;
};

/**
 * Calculates the start and end Date objects based on the date range option.
 * Note: Does not currently support parsing start/end dates from custom TBS strings.
 * @param dateRangeOption - The selected date range option (e.g., 'Past Week').
 * @returns A DateRange object with start and end dates.
 */
export function getDateRange(dateRangeOption: string, logger?: Logger): DateRange {
  const now = new Date();
  let startDate: Date;

  switch (dateRangeOption) {
    case 'Past Hour':
      startDate = subHours(now, 1);
      break;
    case 'Past 24 Hours':
      startDate = subDays(now, 1);
      break;
    case 'Past Month':
      startDate = subMonths(now, 1);
      break;
    case 'Past Year':
      startDate = subYears(now, 1);
      break;
    case 'Custom':
      // TODO: Potentially parse customTbs (e.g., cd_min, cd_max) if needed.
      // For now, fall back to a wide range or a default like 'Past Week'?
      // Falling back to Past Week for now as tbs parsing is complex.
      if (logger) {
        logger.warn('Custom TBS range filtering not implemented, falling back to Past Week.');
      }
      startDate = subWeeks(now, 1);
      break;
    default:
      startDate = subWeeks(now, 1);
      break;
  }

  // Log the calculated range for debugging
  if (logger) {
    logger.info(`Calculated Date Range for Filtering:
  Start: ${lightFormat(startDate, 'yyyy-MM-dd HH:mm:ss')}
  End:   ${lightFormat(now, 'yyyy-MM-dd HH:mm:ss')}`);
  }

  return { start: startDate, end: now };
}

/**
 * Attempts to parse various date string formats returned by Serper API into Date objects.
 * Handles formats like "1 day ago", "2 hours ago", "25 Aug 2024".
 * @param dateString - The date string from Serper.
 * @returns A Date object if parsing is successful, otherwise null.
 */
export function parseSerperDate(dateString: string, logger?: Logger): Date | null {
  if (!dateString) {
    return null;
  }

  const now = new Date();

  try {
    // Try parsing relative formats like "X units ago"
    // date-fns doesn't have a direct parser for this, so we do a simple check
    const relativeMatch = dateString.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      switch (unit) {
        case 'second': return subSeconds(now, value);
        case 'minute': return subMinutes(now, value);
        case 'hour':   return subHours(now, value);
        case 'day':    return subDays(now, value);
        case 'week':   return subWeeks(now, value);
        case 'month':  return subMonths(now, value);
        case 'year':   return subYears(now, value);
      }
    }

    // Try parsing absolute format "DD MMM YYYY" (e.g., "25 Aug 2024")
    // Requires locale if month names aren't English, assuming English for now.
    let parsedDate = parse(dateString, 'd MMM yyyy', now);
    if (isValid(parsedDate)) {
      return parsedDate;
    }
    
    // Try parsing absolute format "MMM DD, YYYY" (e.g., "Aug 25, 2024")
    parsedDate = parse(dateString, 'MMM d, yyyy', now);
    if (isValid(parsedDate)) {
      return parsedDate;
    }
    
    // Add more parsing attempts if other formats are observed
    // Example: ISO format
    parsedDate = new Date(dateString); // Try native Date constructor as a fallback for ISO-like formats
    if (isValid(parsedDate)) {
       return parsedDate;
    }

    if (logger) {
      logger.warn({ dateString }, 'Failed to parse Serper date string after trying multiple formats.');
    }
    return null;
  } catch (error) {
    if (logger) {
      logger.error({ dateString, err: error }, 'Error parsing Serper date string.');
    }
    return null;
  }
}
