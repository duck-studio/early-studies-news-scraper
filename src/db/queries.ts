import { type InferInsertModel, type InferSelectModel, and, count, desc,  eq, inArray, sql } from 'drizzle-orm';
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
  // const drizzleDb = drizzle(db, { schema });
  // return await drizzleDb
  //   .insert(publications)
  //   .values(data)
  //   .onConflictDoUpdate({ target: publications.url, set: data })
  //   .returning();
}

export async function deletePublication(db: D1Database, url: string) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb.delete(schema.publications).where(eq(schema.publications.url, url)).returning();
}

export async function upsertRegion(db: D1Database, data: InsertRegion) {
  // const drizzleDb = drizzle(db, { schema });
  // return await drizzleDb
  //   .insert(regions)
  //   .values(data)
  //   .onConflictDoUpdate({ target: regions.name, set: data })
  //   .returning();
}

export async function deleteRegion(db: D1Database, name: string) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb.delete(schema.regions).where(eq(schema.regions.name, name)).returning();
}

export async function getHeadlines(db: D1Database, filters?: HeadlineFilters) {
  // const drizzleDb = drizzle(db, { schema });
  // const page = filters?.page ?? 1;
  // const pageSize = filters?.pageSize ?? 10;
  // const offset = (page - 1) * pageSize;

  // const conditions = [];
  // if (filters?.startDate) {
  //   console.warn('Date filtering assumes normalizedDate is directly comparable.');
  // }
  // if (filters?.endDate) {
  //   console.warn('Date filtering assumes normalizedDate is directly comparable.');
  // }
  // if (filters?.publicationFilters?.category) {
  //   conditions.push(eq(publications.category, filters.publicationFilters.category));
  // }
  // if (filters?.publicationFilters?.regions && filters.publicationFilters.regions.length > 0) {
  //   const regionPublications = await drizzleDb
  //     .selectDistinct({ publicationUrl: publicationRegions.publicationUrl })
  //     .from(publicationRegions)
  //     .where(inArray(publicationRegions.regionName, filters.publicationFilters.regions));
  //   const allowedUrls = regionPublications.map(p => p.publicationUrl) as string[];
  //   if (allowedUrls.length > 0) {
  //        conditions.push(inArray(headlines.publicationId, allowedUrls));
  //   } else {
  //        conditions.push(inArray(headlines.id, []));
  //   }
  // }
  // if (filters?.categories && filters.categories.length > 0) {
  //   conditions.push(inArray(headlines.category, filters.categories));
  // }

  // const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  // const dataQuery = drizzleDb
  //   .select({
  //     headlineId: headlines.id,
  //     headlineUrl: headlines.url,
  //     headlineText: headlines.headline,
  //     snippet: headlines.snippet,
  //     source: headlines.source,
  //     rawDate: headlines.rawDate,
  //     normalizedDate: headlines.normalizedDate,
  //     category: headlines.category,
  //     createdAt: headlines.createdAt,
  //     publicationName: publications.name,
  //     publicationCategory: publications.category,
  //   })
  //   .from(headlines)
  //   .innerJoin(publications, eq(headlines.publicationId, publications.url))
  //   .where(whereCondition)
  //   .orderBy(desc(headlines.normalizedDate))
  //   .limit(pageSize)
  //   .offset(offset);

  // const countQuery = drizzleDb
  //   .select({ total: count() })
  //   .from(headlines)
  //   .innerJoin(publications, eq(headlines.publicationId, publications.url))
  //   .where(whereCondition);

  // const [results, totalResult] = await Promise.all([
  //   dataQuery,
  //   countQuery,
  // ]);

  // const total = Number(totalResult[0]?.total ?? 0);

  // return {
  //   data: results,
  //   total: total,
  //   page,
  //   pageSize,
  //   totalPages: Math.ceil(total / pageSize),
  // };
}

export async function upsertHeadline(db: D1Database, data: InsertHeadline) {
  // const drizzleDb = drizzle(db, { schema });
  // const publicationExists = await drizzleDb
  //   .select({ url: publications.url })
  //   .from(publications)
  //   .where(eq(publications.url, data.publicationId));

  // if (publicationExists.length === 0) {
  //   throw new Error(`Publication with URL ${data.publicationId} does not exist.`);
  // }

  // return await drizzleDb
  //   .insert(headlines)
  //   .values(data)
  //   .onConflictDoUpdate({ target: headlines.url, set: data })
  //   .returning();
}

export async function deleteHeadline(db: D1Database, id: string) {
  const drizzleDb = drizzle(db, { schema });
  return await drizzleDb.delete(schema.headlines).where(eq(schema.headlines.id, id)).returning();
}
