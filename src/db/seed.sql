-- Ensure tables exist
CREATE TABLE IF NOT EXISTS regions (
  name TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))), -- Approximation of nanoid via UUID v4 logic in SQL
  name TEXT NOT NULL,
  url TEXT PRIMARY KEY NOT NULL,
  category TEXT CHECK( category IN ('broadcaster','broadsheet','tabloid','digital','financial','magazinePeriodical','newsAgency','other') ),
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
-- Trigger for updated_at (SQLite specific)
CREATE TRIGGER IF NOT EXISTS update_publications_updated_at
AFTER UPDATE ON publications
FOR EACH ROW
BEGIN
  UPDATE publications SET updated_at = strftime('%s', 'now') WHERE url = OLD.url;
END;

CREATE TABLE IF NOT EXISTS publication_regions (
  publication_url TEXT NOT NULL REFERENCES publications(url) ON DELETE CASCADE,
  region_name TEXT NOT NULL REFERENCES regions(name) ON DELETE CASCADE,
  PRIMARY KEY (publication_url, region_name)
);

CREATE TABLE IF NOT EXISTS headlines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-a' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))), -- Approximation of nanoid
  url TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  snippet TEXT,
  source TEXT NOT NULL,
  raw_date TEXT,
  normalized_date TEXT,
  category TEXT CHECK( category IN ('breakingNews', 'politics', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment', 'lifestyle', 'environment', 'crime', 'education', 'artsCulture', 'opinion', 'other') ),
  publication_id TEXT NOT NULL REFERENCES publications(url) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
-- Trigger for updated_at (SQLite specific)
CREATE TRIGGER IF NOT EXISTS update_headlines_updated_at
AFTER UPDATE ON headlines
FOR EACH ROW
BEGIN
  UPDATE headlines SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

-- Create Indexes if they don't exist
CREATE INDEX IF NOT EXISTS publications_category_idx ON publications(category);
CREATE INDEX IF NOT EXISTS pub_regions_pub_url_idx ON publication_regions(publication_url);
CREATE INDEX IF NOT EXISTS pub_regions_region_name_idx ON publication_regions(region_name);
CREATE INDEX IF NOT EXISTS headlines_publication_id_idx ON headlines(publication_id);
CREATE INDEX IF NOT EXISTS headlines_normalized_date_idx ON headlines(normalized_date);
CREATE INDEX IF NOT EXISTS headlines_headline_idx ON headlines(headline);
CREATE INDEX IF NOT EXISTS headlines_headline_date_idx ON headlines(headline, normalized_date);
CREATE INDEX IF NOT EXISTS headlines_url_idx ON headlines(url);
CREATE INDEX IF NOT EXISTS headlines_category_idx ON headlines(category);

-- Seed Regions
INSERT OR IGNORE INTO regions (name) VALUES ('UK'), ('US');

-- Seed Publications (Using INSERT OR IGNORE to avoid errors if they already exist)
INSERT OR IGNORE INTO publications (id, url, name, category)
VALUES
  ('0VrZ2G7e', 'bbc.co.uk', 'BBC UK', 'broadcaster'),
  ('rF_6V8aR', 'bbc.com', 'BBC US', 'broadcaster'),
  ('0wipPq8p', 'news.sky.com', 'Sky News', 'broadcaster'),
  ('JIAK2abB', 'itv.com/news', 'ITV News', 'broadcaster'),
  ('zuHz7K1O', 'channel4.com/news', 'Channel 4 News', 'broadcaster'),
  ('iL9fva92', 'lbc.co.uk', 'LBC', 'broadcaster'),
  ('bZf_anuD', 'talkradio.co.uk', 'TalkRadio', 'broadcaster'),
  ('Vd85yZis', 'theguardian.com', 'The Guardian', 'broadsheet'),
  ('5AAczT1c', 'telegraph.co.uk', 'The Telegraph', 'broadsheet'),
  ('Hq0DyYXk', 'thetimes.co.uk', 'The Times', 'broadsheet'),
  ('kF45uwCN', 'ft.com', 'Financial Times', 'financial'),
  ('5rVE6jXH', 'economist.com', 'The Economist', 'magazinePeriodical'),
  ('69e53qIa', 'observer.com', 'Observer (US)', 'digital'),
  ('YtA3c_oU', 'independent.co.uk', 'The Independent', 'broadsheet'),
  ('KY9ft5qa', 'thesun.co.uk', 'The Sun', 'tabloid'),
  ('QHA1Ibtk', 'mirror.co.uk', 'Daily Mirror', 'tabloid'),
  ('ngQEhco8', 'dailymail.co.uk', 'Daily Mail', 'tabloid'),
  ('go6mnnO5', 'express.co.uk', 'Daily Express', 'tabloid'),
  ('YepE_oz5', 'dailystar.co.uk', 'Daily Star', 'tabloid'),
  ('E7_Gwns3', 'metro.co.uk', 'Metro', 'tabloid'),
  ('CrE3lhyC', 'dailyrecord.co.uk', 'Daily Record', 'tabloid'),
  ('3UXyvQNz', 'morningstaronline.co.uk', 'Morning Star', 'broadsheet'),
  ('fvaMhzYH', 'inews.co.uk', 'i News', 'broadsheet'),
  ('MGgw4B9C', 'huffingtonpost.co.uk', 'Huffington Post UK', 'digital'),
  ('SN_2aNB6', 'buzzfeed.com', 'Buzzfeed', 'digital'),
  ('aV_4vVQq', 'vice.com', 'Vice', 'digital');

-- Seed Publication Regions (Link publications to regions)
INSERT OR IGNORE INTO publication_regions (publication_url, region_name)
VALUES
  ('bbc.co.uk', 'UK'),
  ('bbc.com', 'US'),
  ('news.sky.com', 'UK'),
  ('itv.com/news', 'UK'),
  ('channel4.com/news', 'UK'),
  ('lbc.co.uk', 'UK'),
  ('talkradio.co.uk', 'UK'),
  ('theguardian.com', 'UK'), -- UK based despite .com
  ('telegraph.co.uk', 'UK'),
  ('thetimes.co.uk', 'UK'),
  ('ft.com', 'UK'), -- UK based despite .com
  ('economist.com', 'UK'), -- UK based despite .com
  ('observer.com', 'US'), -- Assumed US Observer, not UK newspaper
  ('independent.co.uk', 'UK'),
  ('thesun.co.uk', 'UK'),
  ('mirror.co.uk', 'UK'),
  ('dailymail.co.uk', 'UK'),
  ('express.co.uk', 'UK'),
  ('dailystar.co.uk', 'UK'),
  ('metro.co.uk', 'UK'),
  ('dailyrecord.co.uk', 'UK'),
  ('morningstaronline.co.uk', 'UK'),
  ('inews.co.uk', 'UK'),
  ('huffingtonpost.co.uk', 'UK'),
  ('buzzfeed.com', 'US'),
  ('vice.com', 'US'); 