import { subDays, subHours, subMonths, subWeeks, subYears } from "date-fns";
import { parseMmDdYyyy } from "./parsers";

/**
 * Convert TBS (time-based search) parameter to a date range
 */
export function tbsToDateRange(tbs: string): { start: Date; end: Date } {
  let endDate = new Date(); // Default end date is now
  let startDate: Date;

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
          customStart = parseMmDdYyyy(minMatch[1]) || null;
        }
        if (maxMatch?.[1]) {
          customEnd = parseMmDdYyyy(maxMatch[1]) || null;
        }

        if (customStart) {
          startDate = customStart;
          if (customEnd) {
            endDate = customEnd;
          }
        } else {
          startDate = subWeeks(endDate, 1);
        }
      }
      break;
  }

  return { start: startDate, end: endDate };
}