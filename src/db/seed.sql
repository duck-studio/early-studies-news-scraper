-- Ensure tables exist
CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))), -- Let drizzle handle proper nanoid, TEXT default is placeholder
  name TEXT NOT NULL,
  UNIQUE(name) -- Add unique constraint
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))), -- Let drizzle handle proper nanoid, TEXT default is placeholder
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT CHECK( category IN ('broadcaster','broadsheet','tabloid','digital','financial','magazinePeriodical','newsAgency','other') ),
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  UNIQUE(url) -- Add unique constraint
);
-- Trigger for updated_at (SQLite specific) - Now using ID
CREATE TRIGGER IF NOT EXISTS update_publications_updated_at
AFTER UPDATE ON publications
FOR EACH ROW
BEGIN
  UPDATE publications SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS publication_regions (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE, -- Use publication_id
  region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE, -- Use region_id
  PRIMARY KEY (publication_id, region_id)
);

CREATE TABLE IF NOT EXISTS headlines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))), -- Let drizzle handle nanoid
  url TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  snippet TEXT,
  source TEXT NOT NULL,
  raw_date TEXT,
  normalized_date TEXT,
  category TEXT CHECK( category IN ('breakingNews', 'politics', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment', 'lifestyle', 'environment', 'crime', 'education', 'artsCulture', 'opinion', 'other') ),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE, -- Use publication_id
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);
-- Trigger for updated_at (SQLite specific) - Already uses ID
CREATE TRIGGER IF NOT EXISTS update_headlines_updated_at
AFTER UPDATE ON headlines
FOR EACH ROW
BEGIN
  UPDATE headlines SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

-- Create Indexes if they don't exist
CREATE UNIQUE INDEX IF NOT EXISTS publications_url_idx ON publications(url);
CREATE INDEX IF NOT EXISTS publications_category_idx ON publications(category);
CREATE UNIQUE INDEX IF NOT EXISTS regions_name_idx ON regions(name);
CREATE INDEX IF NOT EXISTS pub_regions_pub_id_idx ON publication_regions(publication_id); -- Updated index
CREATE INDEX IF NOT EXISTS pub_regions_region_id_idx ON publication_regions(region_id); -- Updated index
CREATE INDEX IF NOT EXISTS headlines_publication_id_idx ON headlines(publication_id); -- Updated index
CREATE INDEX IF NOT EXISTS headlines_normalized_date_idx ON headlines(normalized_date);
CREATE INDEX IF NOT EXISTS headlines_headline_idx ON headlines(headline);
CREATE INDEX IF NOT EXISTS headlines_headline_date_idx ON headlines(headline, normalized_date);
CREATE INDEX IF NOT EXISTS headlines_url_idx ON headlines(url);
CREATE INDEX IF NOT EXISTS headlines_category_idx ON headlines(category);

-- Seed Regions
INSERT OR IGNORE INTO regions (name) VALUES ('UK'), ('US');

-- Seed Publications (Using INSERT OR IGNORE to avoid errors if they already exist)
-- Adding specific IDs
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
  -- NOTE: There are more IDs provided than publications listed. The extra IDs are ignored.
  -- smowo9pe, 9AS6YO5R, 2VnHSYSU, NBC3s8s5, A7hqWsia, f-THkZ6W, gpMvEoUG, m2VknNsW, eXIJBGp5, BMKyNZZd, 9MensF5J, fBOHYNTD, Sn_5NzNx, M8zT_4yW, nMyS-Hsb, uESi0-tJ, sPAVYnu8, YrDGwULm, ovq4QDZT, -91JySq1, sF19CVDJ, g0E-m37D, NV_UFC2J, b1kHE_7b

-- Seed Publication Regions (Link publications to regions using IDs)
-- Use subqueries to get IDs based on unique URL/Name
INSERT OR IGNORE INTO publication_regions (publication_id, region_id)
SELECT p.id, r.id
FROM publications p, regions r
WHERE (p.url = 'bbc.co.uk' AND r.name = 'UK')
   OR (p.url = 'bbc.com' AND r.name = 'US')
   OR (p.url = 'news.sky.com' AND r.name = 'UK')
   OR (p.url = 'itv.com/news' AND r.name = 'UK')
   OR (p.url = 'channel4.com/news' AND r.name = 'UK')
   OR (p.url = 'lbc.co.uk' AND r.name = 'UK')
   OR (p.url = 'talkradio.co.uk' AND r.name = 'UK')
   OR (p.url = 'theguardian.com' AND r.name = 'UK')
   OR (p.url = 'telegraph.co.uk' AND r.name = 'UK')
   OR (p.url = 'thetimes.co.uk' AND r.name = 'UK')
   OR (p.url = 'ft.com' AND r.name = 'UK')
   OR (p.url = 'economist.com' AND r.name = 'UK')
   OR (p.url = 'observer.com' AND r.name = 'US')
   OR (p.url = 'independent.co.uk' AND r.name = 'UK')
   OR (p.url = 'thesun.co.uk' AND r.name = 'UK')
   OR (p.url = 'mirror.co.uk' AND r.name = 'UK')
   OR (p.url = 'dailymail.co.uk' AND r.name = 'UK')
   OR (p.url = 'express.co.uk' AND r.name = 'UK')
   OR (p.url = 'dailystar.co.uk' AND r.name = 'UK')
   OR (p.url = 'metro.co.uk' AND r.name = 'UK')
   OR (p.url = 'dailyrecord.co.uk' AND r.name = 'UK')
   OR (p.url = 'morningstaronline.co.uk' AND r.name = 'UK')
   OR (p.url = 'inews.co.uk' AND r.name = 'UK')
   OR (p.url = 'huffingtonpost.co.uk' AND r.name = 'UK')
   OR (p.url = 'buzzfeed.com' AND r.name = 'US')
   OR (p.url = 'vice.com' AND r.name = 'US'); 