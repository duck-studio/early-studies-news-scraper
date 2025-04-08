/**
 * URL utility functions for consistent URL handling across the application
 */

/**
 * Normalizes a URL string by ensuring it has or doesn't have a protocol prefix
 * @param url The URL to normalize
 * @param includeProtocol Whether to include the https:// protocol in the result
 * @returns A normalized URL string
 */
export function normalizeUrl(url: string, includeProtocol = true): string {
  // First remove any existing protocol
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  
  // Then add protocol if requested
  return includeProtocol ? `https://${withoutProtocol}` : withoutProtocol;
}

/**
 * Extracts the domain from a URL
 * @param url The URL to extract the domain from
 * @returns The domain part of the URL
 */
export function getUrlDomain(url: string): string {
  try {
    // Use URL constructor for more robust URL parsing
    return new URL(normalizeUrl(url)).hostname;
  } catch (_e) {
    // If URL parsing fails, return the input without protocol as fallback
    return normalizeUrl(url, false);
  }
}

/**
 * Creates a site query string for search engines
 * @param url The URL to create a site query for
 * @returns A site query string (e.g., "site:example.com")
 */
export function createSiteQuery(url: string): string {
  return `site:${getUrlDomain(url)}`;
}