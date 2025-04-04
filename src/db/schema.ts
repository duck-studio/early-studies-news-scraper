import { relations, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

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
      .primaryKey()
      .$defaultFn(() => nanoid(8)),
    name: text('name').notNull(),
    url: text('url').notNull(),
    category: text('category', { enum: publicationCategories }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(strftime('%s', 'now'))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(strftime('%s', 'now'))`)
      .$onUpdate(() => sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    urlIdx: uniqueIndex('publications_url_idx').on(table.url),
    categoryIdx: index('publications_category_idx').on(table.category),
  })
);

export const regions = sqliteTable(
  'regions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => nanoid(8)),
    name: text('name').notNull(),
  },
  (table) => ({
    nameIdx: uniqueIndex('regions_name_idx').on(table.name),
  })
);

export const publicationRegions = sqliteTable(
  'publication_regions',
  {
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
    regionId: text('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.publicationId, table.regionId] }),
    publicationIdIdx: index('pub_regions_pub_id_idx').on(table.publicationId),
    regionIdIdx: index('pub_regions_region_id_idx').on(table.regionId),
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
    rawDate: text('raw_date'),
    normalizedDate: text('normalized_date'),
    category: text('category', { enum: headlineCategories }),
    publicationId: text('publication_id')
      .notNull()
      .references(() => publications.id, { onDelete: 'cascade' }),
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

// --- RELATIONS --- 

export const publicationRelations = relations(publications, ({ many }) => ({
  publicationRegions: many(publicationRegions),
  headlines: many(headlines),
}));

export const regionRelations = relations(regions, ({ many }) => ({
  publicationRegions: many(publicationRegions),
}));

export const publicationRegionRelations = relations(publicationRegions, ({ one }) => ({
  publication: one(publications, {
    fields: [publicationRegions.publicationId],
    references: [publications.id],
  }),
  region: one(regions, {
    fields: [publicationRegions.regionId],
    references: [regions.id],
  }),
}));

export const headlineRelations = relations(headlines, ({ one }) => ({
  publication: one(publications, {
    fields: [headlines.publicationId],
    references: [publications.id],
  }),
}));

export const schema = {
  publications,
  regions,
  publicationRegions,
  headlines,
  publicationRelations,
  regionRelations,
  publicationRegionRelations,
  headlineRelations,
};
