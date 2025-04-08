import retry from 'async-retry';
import type { Logger } from 'pino';
import type { GeoParams, SerperNewsResult } from '../../schema';
import { config } from './config';

/**
 * Fetches a single page of news results from the Serper API for a given site query
 */
export async function fetchSerperPage(
  siteQuery: string,
  tbs: string,
  geoParams: GeoParams,
  apiKey: string,
  page: number,
  logger: Logger
): Promise<SerperNewsResult> {
  const headers = new Headers({
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
  });

  const requestPayload = {
    q: siteQuery,
    tbs: tbs,
    gl: geoParams.gl,
    location: geoParams.location,
    num: config.resultsPerPage,
    page: page,
  };

  const requestBody = JSON.stringify(requestPayload);

  logger.debug(
    {
      url: config.serperApiUrl,
      payload: requestPayload,
    },
    'Serper API request'
  );

  const requestOptions: RequestInit = {
    method: 'POST',
    headers: headers,
    body: requestBody,
    redirect: 'follow',
  };

  return await retry(
    async (bail, attempt) => {
      const attemptLogger = logger.child({ attempt, siteQuery, page });
      try {
        const response = await fetch(config.serperApiUrl, requestOptions);

        if (!response.ok) {
          let errorBody = `Status code ${response.status}`;
          try {
            errorBody = await response.text();
          } catch {
            /* Ignore body read error */
          }
          const error = new Error(`Serper API Error: ${response.status}`);
          attemptLogger.warn(
            { status: response.status, body: errorBody },
            'Serper API request failed'
          );

          // Stop retrying for 4xx errors (except 429 Too Many Requests)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            bail(error);
            throw error;
          }
          throw error;
        }

        const result = (await response.json()) as SerperNewsResult;

        attemptLogger.debug(
          {
            resultCount: result.news?.length ?? 0,
            credits: result.credits,
            parameters: result.searchParameters,
          },
          'Serper API response received'
        );

        return result;
      } catch (error: unknown) {
        attemptLogger.warn(
          { err: error },
          'Serper API fetch attempt failed, retrying if possible...'
        );
        throw error;
      }
    },
    {
      ...config.retryOptions,
      onRetry: (error, attempt) => {
        logger.warn({ err: error, attempt, siteQuery, page }, 'Retrying Serper fetch');
      },
    }
  );
}
