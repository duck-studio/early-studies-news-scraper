/**
 * Utility functions for working with date parameters in search requests
 */


/**
 * Converts a user-friendly date range option to a Serper API 'tbs' parameter
 */
export function getTbsString(dateRangeOption: string, customTbs?: string): string {
  switch (dateRangeOption) {
    case "Past Hour":
      return "qdr:h";
    case "Past 24 Hours":
      return "qdr:d";
    case "Past Week":
      return "qdr:w";
    case "Past Month":
      return "qdr:m";
    case "Past Year":
      return "qdr:y";
    case "Custom": {
      // Remove tbs= prefix if present in customTbs
      if (!customTbs) return "qdr:w";
      return customTbs.startsWith("tbs=") ? customTbs.substring(4) : customTbs;
    }
    default:
      return "qdr:w";
  }
}

/**
 * Maps region code to geographic parameters for search
 */
export function getGeoParams(region: string): { gl: string; location: string } {
  switch (region) {
    case "US":
      return { gl: "us", location: "United States" };
    case "UK":
      return { gl: "gb", location: "United Kingdom" };
    default:
      return { gl: "us", location: "United States" };
  }
}