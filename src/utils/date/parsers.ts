import {
  isValid,
  parse,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subSeconds,
  subWeeks,
  subYears,
} from 'date-fns';

/**
 * Maps date range option to a date range with start and end dates
 */
export function getDateRange(dateRangeOption: string): { start: Date; end: Date } {
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
      startDate = subWeeks(now, 1);
      break;
    default:
      startDate = subWeeks(now, 1);
      break;
  }

  return { start: startDate, end: now };
}

/**
 * Parses a date string in DD/MM/YYYY format
 */
export function parseDdMmYyyy(dateString?: string): Date | undefined {
  if (!dateString) return undefined;

  try {
    const parsed = parse(dateString, 'dd/MM/yyyy', new Date());
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  } catch (e) {
    console.error(`Failed to parse date string: ${dateString}`, e);
    return undefined;
  }
}

/**
 * Parses a date string in MM/DD/YYYY format
 */
export function parseMmDdYyyy(dateString?: string | null): Date | undefined {
  if (!dateString) {
    return undefined;
  }

  const parts = dateString.split('/');
  if (parts.length !== 3) {
    return undefined;
  }

  const month = parseInt(parts[0], 10);
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

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

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Parses a date string from Serper API results
 */
export function parseSerperDate(dateString?: string | null): Date | null {
  if (!dateString) {
    return null;
  }

  const now = new Date();

  try {
    // Try parsing relative formats like "X units ago"
    const relativeMatch = dateString.match(
      /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i
    );

    if (relativeMatch) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();

      switch (unit) {
        case 'second':
          return subSeconds(now, value);
        case 'minute':
          return subMinutes(now, value);
        case 'hour':
          return subHours(now, value);
        case 'day':
          return subDays(now, value);
        case 'week':
          return subWeeks(now, value);
        case 'month':
          return subMonths(now, value);
        case 'year':
          return subYears(now, value);
      }
    }

    // Try parsing absolute format "DD MMM YYYY" (e.g., "25 Aug 2024")
    let parsedDate = parse(dateString, 'd MMM yyyy', now);
    if (isValid(parsedDate)) {
      return parsedDate;
    }

    // Try parsing absolute format "MMM DD, YYYY" (e.g., "Aug 25, 2024")
    parsedDate = parse(dateString, 'MMM d, yyyy', now);
    if (isValid(parsedDate)) {
      return parsedDate;
    }

    // Try native Date constructor as a fallback for ISO-like formats
    parsedDate = new Date(dateString);
    if (isValid(parsedDate)) {
      return parsedDate;
    }

    return null;
  } catch (_error) {
    return null;
  }
}
