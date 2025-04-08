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
  subYears,
} from "date-fns";
import { Logger } from "pino";
import type { GeoParams } from "./schema";

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

/**
 * Converts a user-friendly date range option and optional custom TBS
 * into the corresponding Serper API 'tbs' parameter string.
 */
export function getTbsString(dateRangeOption: string, customTbs?: string, logger?: Logger): string {
  const tbs = (() => {
    switch (dateRangeOption) {
      case "Past Hour":
        return "qdr:h";
      case "Past 24 Hours":
        return "qdr:d";
      case "Past Week":
        return "qdr:w"; // Default handled by schema
      case "Past Month":
        return "qdr:m";
      case "Past Year":
        return "qdr:y";
      case "Custom": {
        // Remove tbs= prefix if present in customTbs
        const cleanCustomTbs = customTbs
          ? customTbs.startsWith("tbs=")
            ? customTbs.substring(4)
            : customTbs
          : "qdr:w";
        return cleanCustomTbs;
      }
      default:
        // Should be unreachable due to schema validation & default
        if (logger) {
          logger.warn(
            `Unrecognized dateRangeOption '${dateRangeOption}', falling back to 'Past Week'.`
          );
        }
        return "qdr:w";
    }
  })();

  if (logger) {
    logger.info(`TIME FILTER DETAILS:
Date Range Option: "${dateRangeOption}"
Custom TBS Value: "${customTbs || "none"}"
Final TBS Value: "${tbs}"
Example Query: site:example.com with timeframe parameter 'tbs=${tbs}'`);
  }

  return tbs;
}

export function tbsToDateRange(tbs: string): DateRange {
  let endDate = new Date(); // Default end date is now
  let startDate: Date;

  // Helper to parse M/D/YYYY format
  const parseCustomDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    // Try parsing M/d/yyyy (e.g., 8/1/2024)
    const parsed = parse(dateStr, "M/d/yyyy", new Date());
    return isValid(parsed) ? parsed : null;
  };

  // Handle known 'qdr:' values first
  switch (tbs) {
    case "qdr:h": // Past Hour
      startDate = subHours(endDate, 1);
      break;
    case "qdr:d": // Past 24 Hours (Day)
      startDate = subDays(endDate, 1);
      break;
    case "qdr:w": // Past Week
      startDate = subWeeks(endDate, 1);
      break;
    case "qdr:m": // Past Month
      startDate = subMonths(endDate, 1);
      break;
    case "qdr:y": // Past Year
      startDate = subYears(endDate, 1);
      break;
    default:
      // Attempt to parse custom 'cd_min' and 'cd_max'
      {
        const minMatch = tbs.match(/cd_min:([^,]+)/);
        const maxMatch = tbs.match(/cd_max:([^,]+)/);

        let customStart: Date | null = null;
        let customEnd: Date | null = null;

        if (minMatch?.[1]) {
          customStart = parseCustomDate(minMatch[1]);
        }
        if (maxMatch?.[1]) {
          // Google often sets the end date to the *start* of the day.
          // To make it inclusive, we might want to set it to the end of that day.
          // However, for simplicity and direct mapping, we'll parse it directly first.
          // Consider adjusting if precise end-of-day is needed.
          customEnd = parseCustomDate(maxMatch[1]);
        }

        if (customStart) {
          startDate = customStart;
          // If a custom start is parsed, use custom end if available, otherwise default end (now)
          if (customEnd) {
            endDate = customEnd; // Use the parsed custom end date
          }
          // console.log(`Parsed custom date range: ${startDate} - ${endDate}`); // Optional logging
        } else {
          // Fall back to Past Week if custom parsing fails or tbs is unrecognized
          // console.warn(`Unsupported or invalid custom TBS '${tbs}', falling back to Past Week.`);
          startDate = subWeeks(endDate, 1);
        }
      }
      break;
  }

  return { start: startDate, end: endDate };
}

/**
 * Maps the application's region ('US' | 'UK') to Serper's
 * geographical parameters ('gl' and 'location').
 */
export function getGeoParams(region: string, logger?: Logger): GeoParams {
  switch (region) {
    case "US":
      return { gl: "us", location: "United States" };
    case "UK":
      return { gl: "gb", location: "United Kingdom" };
    default:
      // Should be unreachable due to schema validation
      if (logger) {
        logger.warn(`Unrecognized region '${region}', falling back to 'US'.`);
      }
      return { gl: "us", location: "United States" };
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
    case "Past Hour":
      startDate = subHours(now, 1);
      break;
    case "Past 24 Hours":
      startDate = subDays(now, 1);
      break;
    case "Past Month":
      startDate = subMonths(now, 1);
      break;
    case "Past Year":
      startDate = subYears(now, 1);
      break;
    case "Custom":
      // TODO: Potentially parse customTbs (e.g., cd_min, cd_max) if needed.
      // For now, fall back to a wide range or a default like 'Past Week'?
      // Falling back to Past Week for now as tbs parsing is complex.
      if (logger) {
        logger.warn("Custom TBS range filtering not implemented, falling back to Past Week.");
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
  Start: ${lightFormat(startDate, "yyyy-MM-dd HH:mm:ss")}
  End:   ${lightFormat(now, "yyyy-MM-dd HH:mm:ss")}`);
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
    const relativeMatch = dateString.match(
      /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i
    );
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      switch (unit) {
        case "second":
          return subSeconds(now, value);
        case "minute":
          return subMinutes(now, value);
        case "hour":
          return subHours(now, value);
        case "day":
          return subDays(now, value);
        case "week":
          return subWeeks(now, value);
        case "month":
          return subMonths(now, value);
        case "year":
          return subYears(now, value);
      }
    }

    // Try parsing absolute format "DD MMM YYYY" (e.g., "25 Aug 2024")
    // Requires locale if month names aren't English, assuming English for now.
    let parsedDate = parse(dateString, "d MMM yyyy", now);
    if (isValid(parsedDate)) {
      return parsedDate;
    }

    // Try parsing absolute format "MMM DD, YYYY" (e.g., "Aug 25, 2024")
    parsedDate = parse(dateString, "MMM d, yyyy", now);
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
      logger.warn(
        { dateString },
        "Failed to parse Serper date string after trying multiple formats."
      );
    }
    return null;
  } catch (error) {
    if (logger) {
      logger.error({ dateString, err: error }, "Error parsing Serper date string.");
    }
    return null;
  }
}

// Helper function to parse DD/MM/YYYY string to Date object
export function parseDdMmYyyy(dateString: string | undefined): Date | undefined {
  if (!dateString) return undefined;
  try {
    // Use date-fns parse for reliable parsing
    const parsed = parse(dateString, "dd/MM/yyyy", new Date()); // Use parse from date-fns
    // Optional: Add validation if parse doesn't throw for invalid dates in the format
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  } catch (e) {
    // Log parsing error if needed
    console.error(`Failed to parse date string: ${dateString}`, e);
    return undefined;
  }
}

/**
 * Parses a date string in MM/DD/YYYY format.
 * @param dateString The date string to parse.
 * @returns A Date object if parsing is successful, otherwise undefined.
 */
export function parseMmDdYyyy(dateString: string | undefined | null): Date | undefined {
  if (!dateString) {
    return undefined;
  }
  const parts = dateString.split("/");
  if (parts.length !== 3) {
    return undefined;
  }
  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  // Basic validation (adjust month index for Date constructor)
  if (
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }

  const date = new Date(year, month - 1, day);

  // Check if the constructed date matches the input parts (handles invalid dates like 31/02)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }

  // Set time to the start of the day for consistent comparisons
  date.setHours(0, 0, 0, 0);

  return date;
}
