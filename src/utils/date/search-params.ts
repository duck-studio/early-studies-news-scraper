/**
 * Utility functions for working with date parameters in search requests
 */

/**
 * Converts DD/MM/YYYY format to MM/DD/YYYY format
 */
function convertDateFormat(ddMmYyyyDate: string): string {
  const [day, month, year] = ddMmYyyyDate.split('/');
  return `${month}/${day}/${year}`;
}

/**
 * Creates a TBS string from start and end dates in DD/MM/YYYY format
 */
export function datesToTbsString(startDate: string, endDate: string): string {
  // Convert from DD/MM/YYYY to MM/DD/YYYY format for TBS
  const startDateMmDdYyyy = convertDateFormat(startDate);
  const endDateMmDdYyyy = convertDateFormat(endDate);

  return `cdr:1,cd_min:${startDateMmDdYyyy},cd_max:${endDateMmDdYyyy}`;
}

/**
 * Gets the appropriate TBS (time-based search) string based on the date range option
 * or uses a custom TBS string if provided
 */
export function getTbsString(dateRangeOption: string, customTbs?: string): string {
  if (customTbs) {
    return customTbs;
  }

  // Convert common date range options to TBS strings
  switch (dateRangeOption) {
    case 'Past Hour':
      return 'qdr:h';
    case 'Past 24 Hours':
      return 'qdr:d';
    case 'Past Week':
      return 'qdr:w';
    case 'Past Month':
      return 'qdr:m';
    case 'Past Year':
      return 'qdr:y';
    default:
      // If it doesn't match any predefined option, default to past week
      return 'qdr:w';
  }
}

/**
 * Maps region code to geographic parameters for search
 */
export function getGeoParams(region: string): { gl: string; location: string } {
  switch (region) {
    case 'US':
      return { gl: 'us', location: 'United States' };
    case 'UK':
      return { gl: 'gb', location: 'United Kingdom' };
    default:
      return { gl: 'us', location: 'United States' };
  }
}
