import type { GeoParams } from "./schema";
import { createLogger } from "./logger";
import type { Env } from "./types/cloudflare";

// Create a default logger instance
const logger = createLogger({ NODE_ENV: "development", LOG_LEVEL: "info" } as Env);

/**
 * Converts a user-friendly date range option and optional custom TBS
 * into the corresponding Serper API 'tbs' parameter string.
 */
export function getTbsString(dateRangeOption: string, customTbs?: string): string {
  switch (dateRangeOption) {
    case "Past Hour":
      return "tbs=qdr:h";
    case "Past 24 Hours":
      return "tbs=qdr:d";
    case "Past Week":
      return "tbs=qdr:w"; // Default handled by schema
    case "Past Month":
      return "tbs=qdr:m";
    case "Past Year":
      return "tbs=qdr:y";
    case "Custom":
      return customTbs!; // Schema validation ensures this exists
    default:
      // Should be unreachable due to schema validation & default
      logger.warn(
        `Unrecognized dateRangeOption '${dateRangeOption}', falling back to 'Past Week'.`
      );
      return "tbs=qdr:w";
  }
}

/**
 * Maps the application's region ('US' | 'UK') to Serper's
 * geographical parameters ('gl' and 'location').
 */
export function getGeoParams(region: string): GeoParams {
  switch (region) {
    case "US":
      return { gl: "us", location: "United States" };
    case "UK":
      return { gl: "gb", location: "United Kingdom" };
    default:
      // Should be unreachable due to schema validation
      logger.warn(`Unrecognized region '${region}', falling back to 'US'.`);
      return { gl: "us", location: "United States" };
  }
}
