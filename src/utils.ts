import { createLogger } from './logger';
import type { GeoParams } from './schema';
import type { Env } from './types/cloudflare';

// Create a default logger instance
const logger = createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'info' } as Env);

/**
 * Converts a user-friendly date range option and optional custom TBS
 * into the corresponding Serper API 'tbs' parameter string.
 */
export function getTbsString(dateRangeOption: string, customTbs?: string): string {
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
        logger.warn(
          `Unrecognized dateRangeOption '${dateRangeOption}', falling back to 'Past Week'.`
        );
        return 'qdr:w';
    }
  })();

  logger.info(`TIME FILTER DETAILS:
Date Range Option: "${dateRangeOption}"
Custom TBS Value: "${customTbs || 'none'}"
Final TBS Value: "${tbs}"
Example Query: site:example.com with timeframe parameter 'tbs=${tbs}'`);

  return tbs;
}

/**
 * Maps the application's region ('US' | 'UK') to Serper's
 * geographical parameters ('gl' and 'location').
 */
export function getGeoParams(region: string): GeoParams {
  switch (region) {
    case 'US':
      return { gl: 'us', location: 'United States' };
    case 'UK':
      return { gl: 'gb', location: 'United Kingdom' };
    default:
      // Should be unreachable due to schema validation
      logger.warn(`Unrecognized region '${region}', falling back to 'US'.`);
      return { gl: 'us', location: 'United States' };
  }
}
