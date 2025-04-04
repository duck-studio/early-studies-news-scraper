import { format } from 'date-fns';
import { type InferInsertModel, type InferSelectModel, and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1'; 
import {headlineCategories, publicationCategories, schema} from './schema';

// --- Inferred Types ---
export type Publication = InferSelectModel<typeof schema.publications>;
export type InsertPublication = InferInsertModel<typeof schema.publications>;
export type Region = InferSelectModel<typeof schema.regions>;
export type InsertRegion = InferInsertModel<typeof schema.regions>;
export type Headline = InferSelectModel<typeof schema.headlines>;
export type InsertHeadline = InferInsertModel<typeof schema.headlines>;
export type PublicationRegion = InferSelectModel<typeof schema.publicationRegions>;
export type InsertPublicationRegion = InferInsertModel<typeof schema.publicationRegions>;

// --- Filter Types ---
type PublicationFilters = {
  category?: (typeof publicationCategories)[number];
  regionNames?: string[];
};

type HeadlineFilters = {
  startDate?: Date;
  endDate?: Date;
  publicationFilters?: {
    category?: (typeof publicationCategories)[number];
    regionNames?: string[];
  };
  categories?: (typeof headlineCategories)[number][];
  page?: number;
  pageSize?: number;
};

// Define interface for custom errors
export interface DatabaseError extends Error {
  name: 'DatabaseError';
  details?: Record<string, unknown>;
}

// Helper function to create a standard error object with additional details
export function createDbError(message: string, details?: Record<string, unknown>): DatabaseError {
  const error = new Error(message) as DatabaseError;
  error.name = 'DatabaseError'; // Custom error name for easy identification
  if (details) {
    error.details = details;
  }
  return error;
}

// Helper to safely extract error message from unknown errors
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Helper to determine if an error is our custom DatabaseError
function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && error.name === 'DatabaseError';
}

export async function getPublications(db: D1Database, filters?: PublicationFilters) {
  const client = drizzle(db, { schema });
  
  try {
    const conditions = [];

    if (filters?.category) {
      conditions.push(eq(schema.publications.category, filters.category));
    }

    // Filter by region names by first finding their IDs
    if (filters?.regionNames && filters.regionNames.length > 0) {
      // Find the region IDs corresponding to the provided names
      const regionIdsResult = await client
        .select({ id: schema.regions.id })
        .from(schema.regions)
        .where(inArray(schema.regions.name, filters.regionNames));
      
      const regionIds = regionIdsResult.map(r => r.id);

      if (regionIds.length > 0) {
        // Find publication IDs associated with the found region IDs
        const regionPublicationsSubquery = client
          .selectDistinct({ publicationId: schema.publicationRegions.publicationId })
          .from(schema.publicationRegions)
          .where(inArray(schema.publicationRegions.regionId, regionIds)); // Use found region IDs

        // Add a condition to filter publications based on the subquery results
        conditions.push(inArray(schema.publications.id, regionPublicationsSubquery));
      } else {
        // If none of the provided region names were found, return no results based on region filter
        console.warn(`No valid regions found for names: ${filters.regionNames.join(', ')}. No publications will be returned based on this region filter.`);
        conditions.push(sql`${schema.publications.id} IS NULL`); 
      }
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await client.query.publications.findMany({
      where: whereCondition,
      with: {
        publicationRegions: true, 
      },
    });
    return results;
  } catch (error: unknown) {
    throw createDbError('Failed to get publications', { filters, errorMessage: getErrorMessage(error) });
  }
}

export async function insertPublication(db: D1Database, data: Omit<InsertPublication, 'id'>) {
  const drizzleDb = drizzle(db, { schema });

  try {
    // Check if publication URL already exists (URL should still be unique)
    const existing = await drizzleDb
      .select({ id: schema.publications.id })
      .from(schema.publications)
      .where(eq(schema.publications.url, data.url))
      .limit(1);

    if (existing.length > 0) {
      throw createDbError(`Publication with URL ${data.url} already exists (ID: ${existing[0].id}).`, { url: data.url, existingId: existing[0].id });
    }

    return await drizzleDb
      .insert(schema.publications)
      .values(data) // Drizzle handles default ID
      .returning();
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to insert publication', { data, errorMessage: getErrorMessage(error) });
  }
}

export async function updatePublication(db: D1Database, id: string, data: Partial<Omit<InsertPublication, 'id'>>) {
    const drizzleDb = drizzle(db, { schema });

    try {
      // If URL is provided in update data, check if it conflicts with another existing publication
      if (data.url) {
          const existing = await drizzleDb
              .select({ id: schema.publications.id })
              .from(schema.publications)
              .where(and(eq(schema.publications.url, data.url), sql`${schema.publications.id} != ${id}`))
              .limit(1);
          if (existing.length > 0) {
               throw createDbError(`Cannot update publication: URL ${data.url} is already used by another publication (ID: ${existing[0].id}).`,
                { url: data.url, existingId: existing[0].id, targetId: id });
          }
      }

      const updatedRows = await drizzleDb
        .update(schema.publications)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.publications.id, id)) // Use ID for where clause
        .returning();
      if (updatedRows.length === 0) {
          throw createDbError(`Publication with ID ${id} not found for update.`, { id });
      }
      return updatedRows;
    } catch (error: unknown) {
      if (isDatabaseError(error)) {
        throw error; // Re-throw our custom errors
      }
      throw createDbError('Failed to update publication', { id, data, errorMessage: getErrorMessage(error) });
    }
}

export async function deletePublication(db: D1Database, id: string) {
  const drizzleDb = drizzle(db, { schema });
  
  try {
    const deletedRows = await drizzleDb
      .delete(schema.publications)
      .where(eq(schema.publications.id, id))
      .returning();
    
    if (deletedRows.length === 0) {
      throw createDbError(`Publication with ID ${id} not found for deletion.`, { id });
    }
    
    return deletedRows;
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to delete publication', { id, errorMessage: getErrorMessage(error) });
  }
}

export async function insertRegion(db: D1Database, data: Omit<InsertRegion, 'id'>) {
  const drizzleDb = drizzle(db, { schema });

  try {
    // Check if region name already exists (Name should still be unique)
    const existing = await drizzleDb
      .select({ id: schema.regions.id })
      .from(schema.regions)
      .where(eq(schema.regions.name, data.name))
      .limit(1);

    if (existing.length > 0) {
      throw createDbError(`Region with name ${data.name} already exists (ID: ${existing[0].id}).`, 
        { name: data.name, existingId: existing[0].id });
    }

    return await drizzleDb
      .insert(schema.regions)
      .values(data) // Drizzle handles default ID
      .returning();
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to insert region', { data, errorMessage: getErrorMessage(error) });
  }
}

export async function updateRegion(db: D1Database, id: string, data: Partial<Omit<InsertRegion, 'id'>>) {
    const drizzleDb = drizzle(db, { schema });

    try {
      // If name is provided, check for conflicts
      if (data.name) {
          const existing = await drizzleDb
              .select({ id: schema.regions.id })
              .from(schema.regions)
              .where(and(eq(schema.regions.name, data.name), sql`${schema.regions.id} != ${id}`))
              .limit(1);
          if (existing.length > 0) {
              throw createDbError(`Cannot update region: Name ${data.name} is already used by another region (ID: ${existing[0].id}).`,
                { name: data.name, existingId: existing[0].id, targetId: id });
          }
      }

      const updatedRows = await drizzleDb
        .update(schema.regions)
        .set({ ...data })
        .where(eq(schema.regions.id, id)) // Use ID
        .returning();
      
      if (updatedRows.length === 0) {
          throw createDbError(`Region with ID ${id} not found for update.`, { id });
      }
      return updatedRows;
    } catch (error: unknown) {
      if (isDatabaseError(error)) {
        throw error; // Re-throw our custom errors
      }
      throw createDbError('Failed to update region', { id, data, errorMessage: getErrorMessage(error) });
    }
}

export async function deleteRegion(db: D1Database, id: string) {
  const drizzleDb = drizzle(db, { schema });
  
  try {
    const deletedRows = await drizzleDb
      .delete(schema.regions)
      .where(eq(schema.regions.id, id))
      .returning();
    
    if (deletedRows.length === 0) {
      throw createDbError(`Region with ID ${id} not found for deletion.`, { id });
    }
    
    return deletedRows;
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to delete region', { id, errorMessage: getErrorMessage(error) });
  }
}

export async function getRegions(db: D1Database) {
  const client = drizzle(db, { schema });
  
  try {
    const results = await client.query.regions.findMany();
    return results;
  } catch (error: unknown) {
    throw createDbError('Failed to get regions', { errorMessage: getErrorMessage(error) });
  }
}

export async function getHeadlines(db: D1Database, filters?: HeadlineFilters) {
  const drizzleDb = drizzle(db, { schema });
  
  try {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 100;
    const offset = (page - 1) * pageSize;

    const conditions = [];

    // Helper to format date to YYYY-MM-DD for comparison
    const formatDateForCompare = (date: Date | undefined): string | undefined => {
        return date ? format(date, 'yyyy-MM-dd') : undefined;
    }

    // Use sql operator to convert DD/MM/YYYY to YYYY-MM-DD within the query
    const normalizedDateYYYYMMDD = sql`substr(${schema.headlines.normalizedDate}, 7, 4) || '-' || substr(${schema.headlines.normalizedDate}, 4, 2) || '-' || substr(${schema.headlines.normalizedDate}, 1, 2)`;

    if (filters?.startDate) {
        const startDateStr = formatDateForCompare(filters.startDate);
        if (startDateStr) {
          conditions.push(gte(normalizedDateYYYYMMDD, startDateStr));
          console.warn('Date filtering compares DD/MM/YYYY text as YYYY-MM-DD strings.');
        } else {
          console.warn('Could not format startDate for comparison');
        }
    }
    if (filters?.endDate) {
        const endDateStr = formatDateForCompare(filters.endDate);
         if (endDateStr) {
          conditions.push(lte(normalizedDateYYYYMMDD, endDateStr));
          console.warn('Date filtering compares DD/MM/YYYY text as YYYY-MM-DD strings.');
        } else {
          console.warn('Could not format endDate for comparison');
        }
    }
    if (filters?.publicationFilters?.category) {
      conditions.push(eq(schema.publications.category, filters.publicationFilters.category));
    }
    if (filters?.publicationFilters?.regionNames && filters.publicationFilters.regionNames.length > 0) {
      const regionIdsResult = await drizzleDb
        .select({ id: schema.regions.id })
        .from(schema.regions)
        .where(inArray(schema.regions.name, filters.publicationFilters.regionNames));
      
      const regionIds = regionIdsResult.map(r => r.id);

      if (regionIds.length > 0) {
          const regionPublicationsSubQuery = drizzleDb
            .selectDistinct({ publicationId: schema.publicationRegions.publicationId })
            .from(schema.publicationRegions)
            .where(inArray(schema.publicationRegions.regionId, regionIds));
          conditions.push(inArray(schema.headlines.publicationId, regionPublicationsSubQuery));
      } else {
        console.warn(`No valid regions found for names: ${filters.publicationFilters.regionNames.join(', ')}. No headlines will be returned based on this region filter.`);
        conditions.push(sql`${schema.headlines.id} IS NULL`);
      }
    }
    if (filters?.categories && filters.categories.length > 0) {
      conditions.push(inArray(schema.headlines.category, filters.categories));
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const dataQuery = drizzleDb
      .select({
        headlineId: schema.headlines.id,
        headlineUrl: schema.headlines.url,
        headlineText: schema.headlines.headline,
        snippet: schema.headlines.snippet,
        source: schema.headlines.source,
        rawDate: schema.headlines.rawDate,
        normalizedDate: schema.headlines.normalizedDate,
        category: schema.headlines.category,
        createdAt: schema.headlines.createdAt,
        publicationName: schema.publications.name,
        publicationCategory: schema.publications.category,
        publicationUrl: schema.publications.url,
        publicationId: schema.publications.id,
      })
      .from(schema.headlines)
      .innerJoin(schema.publications, eq(schema.headlines.publicationId, schema.publications.id))
      .where(whereCondition)
      .orderBy(desc(normalizedDateYYYYMMDD))
      .limit(pageSize)
      .offset(offset);

    const countQuery = drizzleDb
      .select({ total: count() })
      .from(schema.headlines)
      .innerJoin(schema.publications, eq(schema.headlines.publicationId, schema.publications.id))
      .where(whereCondition);

    const [results, totalResult] = await Promise.all([
      dataQuery,
      countQuery,
    ]);

    const total = Number(totalResult[0]?.total ?? 0);

    return {
      data: results,
      total: total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error: unknown) {
    throw createDbError('Failed to get headlines', { filters, errorMessage: getErrorMessage(error) });
  }
}

export async function insertHeadline(db: D1Database, data: Omit<InsertHeadline, 'id'>) {
  const drizzleDb = drizzle(db, { schema });

  try {
    if (!data.publicationId) {
      throw createDbError('Cannot insert headline without a publicationId', { data });
    }

    // 1. Check if publication exists using publicationId
    const publicationExists = await drizzleDb
      .select({ id: schema.publications.id })
      .from(schema.publications)
      .where(eq(schema.publications.id, data.publicationId));

    if (publicationExists.length === 0) {
      throw createDbError(`Publication with ID ${data.publicationId} does not exist.`, 
        { publicationId: data.publicationId });
    }

    // 2. Check if headline URL already exists (URL is still unique)
    const existingHeadline = await drizzleDb
      .select({ id: schema.headlines.id })
      .from(schema.headlines)
      .where(eq(schema.headlines.url, data.url))
      .limit(1);

    if (existingHeadline.length > 0) {
      throw createDbError(`Headline with URL ${data.url} already exists (ID: ${existingHeadline[0].id}).`, 
        { url: data.url, existingId: existingHeadline[0].id });
    }

    // 3. INSERT if not exists
    console.log(`Headline with URL ${data.url} does not exist. Inserting.`);
    return await drizzleDb
      .insert(schema.headlines)
      .values(data) // Drizzle handles default ID
      .returning();
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to insert headline', { data, errorMessage: getErrorMessage(error) });
  }
}

export async function updateHeadlineById(db: D1Database, id: string, data: Partial<Omit<InsertHeadline, 'id'>>) {
  const drizzleDb = drizzle(db, { schema });

  try {
    // Optional: Check if the referenced publicationId still exists if it's part of the update data
    if (data.publicationId) {
      const publicationExists = await drizzleDb
        .select({ id: schema.publications.id })
        .from(schema.publications)
        .where(eq(schema.publications.id, data.publicationId));
      if (publicationExists.length === 0) {
        throw createDbError(`Cannot update headline: Publication with ID ${data.publicationId} does not exist.`, 
          { publicationId: data.publicationId });
      }
    }

    // If URL is provided in data, check for conflicts (URL should remain unique)
    if (data.url) {
      const existing = await drizzleDb
        .select({ id: schema.headlines.id })
        .from(schema.headlines)
        .where(and(eq(schema.headlines.url, data.url), sql`${schema.headlines.id} != ${id}`))
        .limit(1);
      if (existing.length > 0) {
        throw createDbError(`Cannot update headline: URL ${data.url} is already used by another headline (ID: ${existing[0].id}).`, 
          { url: data.url, existingId: existing[0].id, targetId: id });
      }
    }

    const updatedRows = await drizzleDb
      .update(schema.headlines)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.headlines.id, id))
      .returning();

    if (updatedRows.length === 0) {
      throw createDbError(`Headline with ID ${id} not found for update.`, { id });
    }
    return updatedRows;
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to update headline', { id, data, errorMessage: getErrorMessage(error) });
  }
}

export async function deleteHeadline(db: D1Database, id: string) {
  const drizzleDb = drizzle(db, { schema });
  
  try {
    const deletedRows = await drizzleDb
      .delete(schema.headlines)
      .where(eq(schema.headlines.id, id))
      .returning();
    
    if (deletedRows.length === 0) {
      throw createDbError(`Headline with ID ${id} not found for deletion.`, { id });
    }
    
    return deletedRows;
  } catch (error: unknown) {
    if (isDatabaseError(error)) {
      throw error; // Re-throw our custom errors
    }
    throw createDbError('Failed to delete headline', { id, errorMessage: getErrorMessage(error) });
  }
}

// --- Statistics --- 

// Type for the raw stats data returned from the DB query
type RawHeadlineStats = {
  totalCount: number;
  categoryCounts: { category: string | null; count: number }[];
  publicationCounts: { 
    count: number; 
    publicationId: string; 
    publicationName: string;
    publicationUrl: string;
    publicationCategory: (typeof publicationCategories)[number] | null;
  }[];
  dailyCounts: { normalizedDate: string | null; count: number }[];
};

export async function getHeadlineStats(db: D1Database, startDate: Date, endDate: Date): Promise<RawHeadlineStats> {
  const drizzleDb = drizzle(db, { schema });

  // Helper to format date to YYYY-MM-DD for comparison
  const formatDateForCompare = (date: Date): string => {
      return format(date, 'yyyy-MM-dd');
  }

  // Convert DD/MM/YYYY stored in normalizedDate to YYYY-MM-DD for comparison
  const normalizedDateYYYYMMDD = sql<string>`substr(${schema.headlines.normalizedDate}, 7, 4) || '-' || substr(${schema.headlines.normalizedDate}, 4, 2) || '-' || substr(${schema.headlines.normalizedDate}, 1, 2)`;

  const startDateStr = formatDateForCompare(startDate);
  const endDateStr = formatDateForCompare(endDate);

  // Base condition for date range filtering
  const dateCondition = and(
    gte(normalizedDateYYYYMMDD, startDateStr),
    lte(normalizedDateYYYYMMDD, endDateStr)
  );

  try {
    // Use Promise.all to run aggregations concurrently
    const [totalResult, categoryCountsResult, publicationCountsResult, dailyCountsResult] = await Promise.all([
      // 1. Get total count in range
      drizzleDb.select({ total: count() })
        .from(schema.headlines)
        .where(dateCondition),

      // 2. Get counts per category
      drizzleDb.select({ 
          category: schema.headlines.category, 
          count: count() 
        })
        .from(schema.headlines)
        .where(dateCondition)
        .groupBy(schema.headlines.category),

      // 3. Get counts per publication (joining to get details)
      drizzleDb.select({ 
          count: count(), 
          publicationId: schema.publications.id,
          publicationName: schema.publications.name,
          publicationUrl: schema.publications.url,
          publicationCategory: schema.publications.category,
        })
        .from(schema.headlines)
        .innerJoin(schema.publications, eq(schema.headlines.publicationId, schema.publications.id))
        .where(dateCondition)
        .groupBy(schema.publications.id, schema.publications.name, schema.publications.url, schema.publications.category)
        .orderBy(desc(count())),

      // 4. Get counts per day (using the original DD/MM/YYYY date for grouping)
      drizzleDb.select({ 
          normalizedDate: schema.headlines.normalizedDate, 
          count: count() 
        })
        .from(schema.headlines)
        .where(dateCondition)
        .groupBy(schema.headlines.normalizedDate)
        .orderBy(schema.headlines.normalizedDate), // Order by DD/MM/YYYY string
    ]);

    const totalCount = Number(totalResult[0]?.total ?? 0);

    return {
      totalCount,
      categoryCounts: categoryCountsResult,
      publicationCounts: publicationCountsResult,
      dailyCounts: dailyCountsResult,
    };

  } catch (error: unknown) {
    // Use the standard error creation helper
    throw createDbError('Failed to get headline statistics', { 
        startDate: startDateStr, 
        endDate: endDateStr, 
        errorMessage: getErrorMessage(error) 
    });
  }
}
