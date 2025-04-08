import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import pLimit from "p-limit";
import { z } from "zod";

import {
  HeadlinesFetchRequestSchema,
  HeadlinesFetchStdResponseSchema,
  HeadlinesFetchSummary,
  TransformedNewsItem,
  createStandardResponseSchema,
} from "../schema";

import { getPublications, insertPublication } from "../db/queries";

import { authMiddleware } from "../middleware";

import { fetchAllPagesForUrl, publicationLimit } from "../services/serper";

import { getDateRange, getGeoParams, getTbsString, parseSerperDate } from "../utils";

// Type for workflow item params
type ProcessNewsItemParams = {
  headlineUrl: string;
  publicationId: string;
  headlineText: string;
  snippet: string | null;
  source: string;
  rawDate: string | null;
  normalizedDate: string | null;
};

// Create a router for the fetching functionality
const fetchRouter = new Hono<{ Variables: Variables; Bindings: Env }>();

// Fetch headlines endpoint
fetchRouter.post(
  "/headlines/fetch",
  authMiddleware,
  describeRoute({
    description: "Fetch news headlines from one or more publications via Serper API",
    tags: ["Headlines Fetcher"],
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: HeadlinesFetchRequestSchema,
        },
      },
    },
    responses: {
      200: {
        description: "Successful fetch operation",
        content: {
          "application/json": {
            schema: HeadlinesFetchStdResponseSchema,
          },
        },
      },
      400: {
        description: "Bad Request",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse400_HdlFetch"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse401_HdlFetch"),
          },
        },
      },
      403: {
        description: "Forbidden",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse403_HdlFetch"),
          },
        },
      },
      500: {
        description: "Internal Server Error / Fetch Error",
        content: {
          "application/json": {
            schema: createStandardResponseSchema(z.null(), "ErrorResponse500_HdlFetch"),
          },
        },
      },
    },
  }),
  zValidator("json", HeadlinesFetchRequestSchema),
  async (c) => {
    const {
      dateRangeOption,
      customTbs,
      region,
      publicationUrls: requestedPublicationUrls,
      maxQueriesPerPublication,
      flattenResults,
      triggerWorkflow,
    } = c.req.valid("json");
    const logger = c.get("logger");

    // --- Environment Checks ---
    if (!c.env.SERPER_API_KEY) {
      const error = new Error("SERPER_API_KEY environment variable is not set");
      logger.error("Environment configuration error", { error });
      return c.json(
        {
          data: null,
          success: false,
          error: { message: "Server configuration error: API key missing.", code: "CONFIG_ERROR" },
        },
        500
      );
    }

    // Check queue binding only if workflow trigger is requested
    if (triggerWorkflow && !c.env.NEWS_ITEM_QUEUE) {
      logger.error(
        "Environment configuration error: NEWS_ITEM_QUEUE binding missing for workflow trigger."
      );
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: "Server configuration error: Queue binding missing.",
            code: "CONFIG_ERROR",
          },
        },
        500
      );
    }

    // --- Log triggerWorkflow status ---
    logger.debug("Workflow trigger status", { triggerWorkflow });

    // --- Date Range Determination ---
    let _filterDateRange: { start: Date; end: Date };
    try {
      // Get date range - simplified to use the standard date range method
      _filterDateRange = getDateRange(dateRangeOption);
    } catch (e) {
      logger.error("Error determining filter date range", { error: e });
      c.status(500);
      return c.json({
        data: null,
        success: false,
        error: {
          message: "Internal server error determining date range.",
          code: "DATE_RANGE_ERROR",
        },
      });
    }

    // Get the tbs string for Serper
    const serperTbs = getTbsString(dateRangeOption, customTbs);

    // --- Fetch Publication IDs if triggering workflow ---
    const publicationUrlToIdMap = new Map<string, string>();
    if (triggerWorkflow) {
      try {
        logger.debug("TriggerWorkflow is true, fetching publications for ID mapping.");
        const publications = await getPublications(c.env.DB); // Fetch all publications
        if (publications && publications.length > 0) {
          for (const pub of publications) {
            // Map the *clean* URL (without https://) to its ID for consistency
            if (pub.id && pub.url) {
              const cleanUrl = pub.url.replace(/^https?:\/\//, "");
              publicationUrlToIdMap.set(cleanUrl, pub.id);
            }
          }
          logger.info(`Mapped ${publicationUrlToIdMap.size} publications for workflow trigger.`);
        } else {
          logger.warn("No publications found in DB for ID mapping. Workflows cannot be triggered.");
        }
      } catch (dbError) {
        logger.error(
          "Failed to fetch publications for ID mapping. Workflows cannot be triggered.",
          { dbError }
        );
      }
    }

    // --- Fetch Headlines ---
    try {
      const fetchPublicationWithLimit = (url: string) =>
        fetchAllPagesForUrl(
          url, // Expects URL with https://
          serperTbs,
          getGeoParams(region),
          c.env.SERPER_API_KEY,
          maxQueriesPerPublication,
          logger
        );

      // Ensure requested URLs have https:// before fetching
      const publicationUrlsWithHttps = requestedPublicationUrls.map((url) =>
        url.startsWith("https://") ? url : `https://${url}`
      );

      const publicationPromises = publicationUrlsWithHttps.map((url) =>
        publicationLimit(() => fetchPublicationWithLimit(url))
      );

      const results = await Promise.all(
        publicationPromises.map(async (resultPromise) => {
          const result = await resultPromise;

          if (result.error) {
            return {
              status: "rejected",
              url: result.url, // The URL that failed (with https://)
              queriesMade: result.queriesMade,
              creditsConsumed: result.credits,
              results: [],
              reason: result.error.message,
            };
          }

          // Transform results immediately after fetch
          return {
            status: "fulfilled",
            url: result.url, // Keep the URL used for fetching (with https://)
            queriesMade: result.queriesMade,
            creditsConsumed: result.credits,
            results: result.results.map((item): TransformedNewsItem => {
              const parsedDate = parseSerperDate(item.date);
              return {
                headline: item.title,
                publicationUrl: result.url, // Store the fetched URL (with https://)
                url: item.link,
                snippet: item.snippet ?? null, // Ensure null if undefined
                source: item.source,
                rawDate: item.date ?? null, // Ensure null if undefined
                normalizedDate: parsedDate ? parsedDate.toLocaleDateString("en-GB") : undefined,
              };
            }),
          };
        })
      );

      // --- Process Results and Prepare for Queue (if applicable) ---
      // Variables for tracking processing
      const itemsToQueue: ProcessNewsItemParams[] = [];

      for (const result of results) {
        if (result.status === "fulfilled") {
          // Process the results from this publication URL

          // Date filtering is simplified here as we don't do advanced filtering
          const dateFilteredResults = result.results;

          // Replace original results with filtered ones for the response
          result.results = dateFilteredResults;

          // If triggering workflow, prepare items for queuing
          if (triggerWorkflow) {
            // Get the publication URL *without* https:// to match the map key
            const keyUrl = result.url.replace(/^https?:\/\//, "");
            let publicationId = publicationUrlToIdMap.get(keyUrl);

            // If publication ID not found, try to create it
            if (!publicationId) {
              logger.info(`Publication not found for keyUrl: ${keyUrl}. Attempting to create.`);
              try {
                // Use original result.url (with https://) for the DB record
                const [newPublication] = await insertPublication(c.env.DB, {
                  name: keyUrl, // Use keyUrl (e.g., bbc.co.uk) as the default name
                  url: result.url, // Store the full URL from the fetch result
                });

                if (newPublication?.id) {
                  publicationId = newPublication.id;
                  publicationUrlToIdMap.set(keyUrl, publicationId);
                  logger.info("Successfully created new publication", {
                    keyUrl,
                    newId: publicationId,
                  });
                } else {
                  logger.error("Failed to create publication or retrieve ID after insert", {
                    keyUrl,
                  });
                  publicationId = undefined;
                }
              } catch (dbError) {
                logger.error(
                  `Failed to insert new publication for keyUrl: ${keyUrl}. Queuing will be skipped for this result.`,
                  { dbError }
                );
                publicationId = undefined;
              }
            }

            if (publicationId) {
              // Iterate through the results for this publication
              for (const item of dateFilteredResults) {
                itemsToQueue.push({
                  headlineUrl: item.url,
                  publicationId: publicationId,
                  headlineText: item.headline,
                  snippet: item.snippet,
                  source: item.source,
                  rawDate: item.rawDate,
                  normalizedDate: item.normalizedDate ? item.normalizedDate : null,
                });
              }
            } else {
              logger.warn(
                `Could not find publication ID for fetched key URL: ${keyUrl} (from ${result.url}). Skipping workflow trigger for its headlines.`
              );
            }
          }
        }
      }

      // --- Send Messages to Queue if requested ---
      let messagesSent = 0;
      let messageSendErrors = 0;
      if (triggerWorkflow && itemsToQueue.length > 0) {
        logger.info(
          `Attempting to queue ${itemsToQueue.length} headlines for workflow processing.`
        );
        const queueSendLimit = pLimit(50);
        const queueSendPromises: Promise<unknown>[] = [];
        let messageDelaySeconds = 0;

        for (const payload of itemsToQueue) {
          // Increment delay every 10 messages to stagger queue sends
          if (messagesSent > 0 && messagesSent % 10 === 0) {
            messageDelaySeconds++;
          }

          queueSendPromises.push(
            queueSendLimit(async () => {
              try {
                // Send to the queue
                await c.env.NEWS_ITEM_QUEUE.send(payload, { delaySeconds: messageDelaySeconds });
                logger.debug(
                  `Sent message to queue for headline: ${payload.headlineUrl} with delay ${messageDelaySeconds}s`
                );
                messagesSent++;
              } catch (queueError) {
                logger.error(
                  `Failed to send message to queue for headline: ${payload.headlineUrl}`,
                  { error: queueError }
                );
                messageSendErrors++;
              }
            })
          );
        }

        // Wait for all queue send operations to settle
        await Promise.allSettled(queueSendPromises);
        logger.info(`Successfully sent ${messagesSent} messages to the queue.`);
        if (messageSendErrors > 0) {
          logger.warn(`Failed to send ${messageSendErrors} messages to the queue.`);
        }
      } else if (triggerWorkflow) {
        logger.info(
          "TriggerWorkflow was true, but no eligible headlines found/mapped to queue after filtering."
        );
      }

      // --- Prepare Summary and Final Results ---
      const totalResultsAfterFiltering = results.reduce(
        (acc, curr) => acc + (curr.status === "fulfilled" ? curr.results.length : 0),
        0
      );
      const totalCreditsConsumed = results.reduce((acc, curr) => acc + curr.creditsConsumed, 0);
      const totalQueriesMade = results.reduce((acc, curr) => acc + curr.queriesMade, 0);
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      const failureCount = results.filter((r) => r.status === "rejected").length;

      // Build the summary object
      const summary: HeadlinesFetchSummary = {
        totalResults: totalResultsAfterFiltering,
        totalCreditsConsumed,
        totalQueriesMade,
        successCount,
        failureCount,
        // Conditionally add messagesSent as workflowsQueued to the summary
        ...(triggerWorkflow && { workflowsQueued: messagesSent }),
      };

      logger.info("Search /headlines/fetch completed", {
        ...summary,
      });

      // Handle flattenResults - needs to operate on the filtered results
      const finalResults = flattenResults
        ? results.flatMap((r) => (r.status === "fulfilled" ? r.results : [])) // Flatten only successful
        : results; // Return grouped results (including failures)

      // Return the final response
      return c.json(
        {
          data: {
            results: finalResults,
            summary: summary,
          },
          success: true,
          error: null,
        },
        200
      );
    } catch (error) {
      // Handle generic fetch/processing errors
      logger.error("Search failed in /headlines/fetch", { error });
      return c.json(
        {
          data: null,
          success: false,
          error: {
            message: "Failed to fetch news articles",
            code: "FETCH_FAILED",
            details: error instanceof Error ? error.message : String(error),
          },
        },
        500
      );
    }
  }
);

export default fetchRouter;
