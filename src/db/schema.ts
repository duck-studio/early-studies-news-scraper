import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

// Define allowed categories in camelCase
export const publicationCategories = [
  'broadcaster',
  'broadsheet',
  'tabloid',
  'digital',
  'financial',
  'magazinePeriodical',
  'newsAgency',
  'other',
] as const;

export const headlineCategories = [
  'breakingNews',
  'politics',
  'world',
  'business',
  'technology',
  'science',
  'health',
  'sports',
  'entertainment',
  'lifestyle',
  'environment',
  'crime',
  'education',
  'artsCulture',
  'opinion',
  'other',
] as const;

export const publications = sqliteTable(
  'publications',
  {
    id: text('id')
      .$defaultFn(() => nanoid(8)),
    name: text('name').notNull(),
    url: text('url').primaryKey(),
    category: text('category', { enum: publicationCategories }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(strftime('%s', 'now'))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(strftime('%s', 'now'))`)
      .$onUpdate(() => sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    categoryIdx: index('publications_category_idx').on(table.category),
  })
);

export const regions = sqliteTable(
  'regions',
  {
    name: text('name').primaryKey(),
  }
);

export const publicationRegions = sqliteTable(
  'publication_regions',
  {
    publicationUrl: text('publication_url')
      .notNull()
      .references(() => publications.url, { onDelete: 'cascade' }),
    regionName: text('region_name')
      .notNull()
      .references(() => regions.name, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.publicationUrl, table.regionName] }),
    publicationUrlIdx: index('pub_regions_pub_url_idx').on(table.publicationUrl),
    regionNameIdx: index('pub_regions_region_name_idx').on(table.regionName),
  })
);

export const headlines = sqliteTable(
  'headlines',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid(8)),
    url: text('url').notNull().unique(),
    headline: text('headline').notNull(),
    snippet: text('snippet'),
    source: text('source').notNull(),
    publicationDate: text('publication_date'),
    normalizedDate: text('normalized_date'),
    category: text('category', { enum: headlineCategories }),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.url, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(strftime('%s', 'now'))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(strftime('%s', 'now'))`)
      .$onUpdate(() => sql`(strftime('%s', 'now'))`),
  },
  (table) => [
    index('headlines_publication_id_idx').on(table.publicationId),
    index('headlines_normalized_date_idx').on(table.normalizedDate),
    index('headlines_headline_idx').on(table.headline),
    index('headlines_headline_date_idx').on(table.headline, table.normalizedDate),
    index('headlines_url_idx').on(table.url),
    index('headlines_category_idx').on(table.category),
  ]
);
