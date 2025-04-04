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
  regions?: string[];
};

type HeadlineFilters = {
  startDate?: Date;
  endDate?: Date;
  publicationFilters?: PublicationFilters;
  categories?: (typeof headlineCategories)[number][];
  page?: number;
  pageSize?: number;
};


export async function getPublications(db: D1Database, filters?: PublicationFilters) {
  const client = drizzle(db, { schema });
  const conditions = [];

  if (filters?.category) {
    conditions.push(eq(schema.publications.category, filters.category));
  }

  if (filters?.regions && filters.regions.length > 0) {
    // Find publication URLs that are associated with the specified regions
    const regionPublicationsSubquery = client
      .selectDistinct({ publicationUrl: schema.publicationRegions.publicationUrl })
      .from(schema.publicationRegions)
      .where(inArray(schema.publicationRegions.regionName, filters.regions));

    // Add a condition to filter publications based on the subquery results
    conditions.push(inArray(schema.publications.url, regionPublicationsSubquery));
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await client.query.publications.findMany({
    where: whereCondition,
    with: {
      publicationRegions: true, 
    },
  });
  return results;

}

export async function upsertPublication(db: D1Database, data: InsertPublication) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb
    .insert(schema.publications)
    .values(data)
    .onConflictDoUpdate({ target: schema.publications.url, set: data })
    .returning();
}

export async function deletePublication(db: D1Database, url: string) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb.delete(schema.publications).where(eq(schema.publications.url, url)).returning();
}

export async function upsertRegion(db: D1Database, data: InsertRegion) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb
    .insert(schema.regions)
    .values(data)
    .onConflictDoUpdate({ target: schema.regions.name, set: data })
    .returning();
}

export async function deleteRegion(db: D1Database, name: string) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb.delete(schema.regions).where(eq(schema.regions.name, name)).returning();
}

export async function getRegions(db: D1Database) {
  const client = drizzle(db, { schema });
  const results = await client.query.regions.findMany();
  return results;
}

export async function getHeadlines(db: D1Database, filters?: HeadlineFilters) {
  const drizzleDb = drizzle(db, { schema });
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
  if (filters?.publicationFilters?.regions && filters.publicationFilters.regions.length > 0) {
    const regionPublicationsSubQuery = drizzleDb
      .selectDistinct({ publicationUrl: schema.publicationRegions.publicationUrl })
      .from(schema.publicationRegions)
      .where(inArray(schema.publicationRegions.regionName, filters.publicationFilters.regions));
    conditions.push(inArray(schema.headlines.publicationUrl, regionPublicationsSubQuery)); 
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
    })
    .from(schema.headlines)
    .innerJoin(schema.publications, eq(schema.headlines.publicationUrl, schema.publications.url))
    .where(whereCondition)
    .orderBy(desc(normalizedDateYYYYMMDD))
    .limit(pageSize)
    .offset(offset);

  const countQuery = drizzleDb
    .select({ total: count() })
    .from(schema.headlines)
    .innerJoin(schema.publications, eq(schema.headlines.publicationUrl, schema.publications.url))
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
}

export async function upsertHeadline(db: D1Database, data: InsertHeadline) {
  const drizzleDb = drizzle(db, { schema });

  if (!data.publicationUrl) { 
    throw new Error('Cannot upsert headline without a publicationUrl');
  }  

  // 1. Check if publication exists (as before)
  const publicationExists = await drizzleDb
    .select({ url: schema.publications.url })
    .from(schema.publications)
    .where(eq(schema.publications.url, data.publicationUrl)); 

  if (publicationExists.length === 0) {
    throw new Error(`Publication with URL ${data.publicationUrl} does not exist.`); 
  }

  // 2. Check if headline URL already exists
  const existingHeadline = await drizzleDb
    .select({ id: schema.headlines.id })
    .from(schema.headlines)
    .where(eq(schema.headlines.url, data.url))
    .limit(1);

  if (existingHeadline.length > 0) {
    // 3a. UPDATE if exists
    console.log(`Headline with URL ${data.url} exists. Updating.`);
    const updatedRows = await drizzleDb
      .update(schema.headlines)
      .set({
        headline: data.headline,
        snippet: data.snippet,
        source: data.source,
        rawDate: data.rawDate,
        normalizedDate: data.normalizedDate, 
        category: data.category,
        publicationUrl: data.publicationUrl,
        // Let DB handle updatedAt
      })
      .where(eq(schema.headlines.url, data.url))
      .returning();
      if(updatedRows.length === 0) {
          throw new Error(`Failed to update headline with URL ${data.url} despite existing check.`);
      }
      return updatedRows;
  }

  // 3b. INSERT if not exists (will execute only if the IF condition was false)
  console.log(`Headline with URL ${data.url} does not exist. Inserting.`);
  return await drizzleDb
    .insert(schema.headlines)
    .values(data)
    .returning();
}

export async function deleteHeadline(db: D1Database, id: string) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb.delete(schema.headlines).where(eq(schema.headlines.id, id)).returning();
}
