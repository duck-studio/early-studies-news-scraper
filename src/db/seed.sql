-- Ensure tables exist
CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
  name TEXT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4)))),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT CHECK( category IN ('broadcaster','broadsheet','tabloid','digital','financial','magazinePeriodical','newsAgency','other') ),
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  UNIQUE(url)
);

-- Trigger for updated_at (SQLite specific) - Now using ID
CREATE TRIGGER IF NOT EXISTS update_publications_updated_at
AFTER UPDATE ON publications
FOR EACH ROW
BEGIN
  UPDATE publications SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS publication_regions (
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  PRIMARY KEY (publication_id, region_id)
);

CREATE TABLE IF NOT EXISTS headlines (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
  url TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  snippet TEXT,
  source TEXT NOT NULL,
  raw_date TEXT,
  normalized_date TEXT, -- Storing as YYYY-MM-DD recommended for sorting
  category TEXT CHECK( category IN ('breakingNews', 'politics', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment', 'lifestyle', 'environment', 'crime', 'education', 'artsCulture', 'opinion', 'other') ),
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
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

-- Create settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  sync_enabled INTEGER DEFAULT 0 NOT NULL, -- false by default
  sync_frequency TEXT DEFAULT 'daily' NOT NULL,
  default_region TEXT DEFAULT 'UK' NOT NULL,
  serper_api_key TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL
);

-- Trigger for settings updated_at
CREATE TRIGGER IF NOT EXISTS update_settings_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
  UPDATE settings SET updated_at = strftime('%s', 'now') WHERE id = OLD.id;
END;

-- Create Indexes if they don't exist
CREATE UNIQUE INDEX IF NOT EXISTS publications_url_idx ON publications(url);
CREATE INDEX IF NOT EXISTS publications_category_idx ON publications(category);
CREATE UNIQUE INDEX IF NOT EXISTS regions_name_idx ON regions(name);
CREATE INDEX IF NOT EXISTS pub_regions_pub_id_idx ON publication_regions(publication_id);
CREATE INDEX IF NOT EXISTS pub_regions_region_id_idx ON publication_regions(region_id);
CREATE INDEX IF NOT EXISTS headlines_publication_id_idx ON headlines(publication_id);
CREATE INDEX IF NOT EXISTS headlines_normalized_date_idx ON headlines(normalized_date); -- Useful for date range filtering
CREATE INDEX IF NOT EXISTS headlines_headline_idx ON headlines(headline);
CREATE UNIQUE INDEX IF NOT EXISTS headlines_url_idx ON headlines(url); -- Changed to UNIQUE
CREATE INDEX IF NOT EXISTS headlines_category_idx ON headlines(category);

-- Seed Regions with explicit IDs
INSERT OR IGNORE INTO regions (id, name) VALUES
  ('smowo9pe', 'UK');

-- Seed Publications with explicit IDs
INSERT OR IGNORE INTO publications (id, url, name, category) VALUES
  ('0VrZ2G7e', 'bbc.co.uk', 'BBC', 'broadcaster'),
  ('Vd85yZis', 'theguardian.com', 'The Guardian', 'broadsheet'),
  ('5AAczT1c', 'telegraph.co.uk', 'The Telegraph', 'broadsheet'),
  ('Hq0DyYXk', 'thetimes.co.uk', 'The Times', 'broadsheet'),
  ('kF45uwCN', 'ft.com', 'Financial Times', 'financial'),
  ('5rVE6jXH', 'economist.com', 'The Economist', 'magazinePeriodical'),
  ('YtA3c_oU', 'independent.co.uk', 'The Independent', 'broadsheet'),
  ('KY9ft5qa', 'thesun.co.uk', 'The Sun', 'tabloid'),
  ('ngQEhco8', 'dailymail.co.uk', 'Daily Mail', 'tabloid'),
  ('QHA1Ibtk', 'mirror.co.uk', 'Daily Mirror', 'tabloid'),
  ('go6mnnO5', 'express.co.uk', 'Daily Express', 'tabloid'),
  ('E7_Gwns3', 'standard.co.uk', 'Evening Standard', 'tabloid'),
  ('3UXyvQNz', 'spectator.co.uk', 'The Spectator', 'magazinePeriodical'),
  ('fvaMhzYH', 'newstatesman.com', 'New Statesman', 'magazinePeriodical');

-- Seed Publication Regions - all UK
INSERT OR IGNORE INTO publication_regions (publication_id, region_id) VALUES
  ('0VrZ2G7e', 'smowo9pe'), -- BBC -> UK
  ('Vd85yZis', 'smowo9pe'), -- The Guardian -> UK
  ('5AAczT1c', 'smowo9pe'), -- The Telegraph -> UK
  ('Hq0DyYXk', 'smowo9pe'), -- The Times -> UK
  ('kF45uwCN', 'smowo9pe'), -- Financial Times -> UK
  ('5rVE6jXH', 'smowo9pe'), -- The Economist -> UK
  ('YtA3c_oU', 'smowo9pe'), -- The Independent -> UK
  ('KY9ft5qa', 'smowo9pe'), -- The Sun -> UK
  ('ngQEhco8', 'smowo9pe'), -- Daily Mail -> UK
  ('QHA1Ibtk', 'smowo9pe'), -- Daily Mirror -> UK
  ('go6mnnO5', 'smowo9pe'), -- Daily Express -> UK
  ('E7_Gwns3', 'smowo9pe'), -- Evening Standard -> UK
  ('3UXyvQNz', 'smowo9pe'), -- The Spectator -> UK
  ('fvaMhzYH', 'smowo9pe'); -- New Statesman -> UK

-- Initialize settings with singleton row
INSERT OR IGNORE INTO settings (id, sync_enabled, sync_frequency, default_region) VALUES
  (1, 0, 'daily', 'UK');