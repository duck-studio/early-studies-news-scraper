-- Ensure tables exist
CREATE TABLE IF NOT EXISTS regions (
  name TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
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
CREATE INDEX IF NOT EXISTS headlines_normalized_date_idx ON headlines(normalized_date);
CREATE INDEX IF NOT EXISTS headlines_headline_idx ON headlines(headline);
CREATE INDEX IF NOT EXISTS headlines_headline_date_idx ON headlines(headline, normalized_date);
CREATE INDEX IF NOT EXISTS headlines_url_idx ON headlines(url);
CREATE INDEX IF NOT EXISTS headlines_category_idx ON headlines(category);

-- Seed Regions
INSERT OR IGNORE INTO regions (name) VALUES ('UK'), ('US');

-- Seed Publications (Using INSERT OR IGNORE to avoid errors if they already exist)
INSERT OR IGNORE INTO publications (url, name, category)
VALUES
  ('bbc.co.uk', 'BBC UK', 'broadcaster'),
  ('bbc.com', 'BBC US', 'broadcaster'),
  ('news.sky.com', 'Sky News', 'broadcaster'),
  ('itv.com/news', 'ITV News', 'broadcaster'),
  ('channel4.com/news', 'Channel 4 News', 'broadcaster'),
  ('lbc.co.uk', 'LBC', 'broadcaster'),
  ('talkradio.co.uk', 'TalkRadio', 'broadcaster'),
  ('theguardian.com', 'The Guardian', 'broadsheet'),
  ('telegraph.co.uk', 'The Telegraph', 'broadsheet'),
  ('thetimes.co.uk', 'The Times', 'broadsheet'),
  ('ft.com', 'Financial Times', 'financial'),
  ('economist.com', 'The Economist', 'magazinePeriodical'),
  ('observer.com', 'Observer (US)', 'digital'),
  ('independent.co.uk', 'The Independent', 'broadsheet'),
  ('thesun.co.uk', 'The Sun', 'tabloid'),
  ('mirror.co.uk', 'Daily Mirror', 'tabloid'),
  ('dailymail.co.uk', 'Daily Mail', 'tabloid'),
  ('express.co.uk', 'Daily Express', 'tabloid'),
  ('dailystar.co.uk', 'Daily Star', 'tabloid'),
  ('metro.co.uk', 'Metro', 'tabloid'),
  ('dailyrecord.co.uk', 'Daily Record', 'tabloid'),
  ('morningstaronline.co.uk', 'Morning Star', 'broadsheet'),
  ('inews.co.uk', 'i News', 'broadsheet'),
  ('huffingtonpost.co.uk', 'Huffington Post UK', 'digital'),
  ('buzzfeed.com', 'Buzzfeed', 'digital'),
  ('vice.com', 'Vice', 'digital');

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