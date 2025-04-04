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

-- Create Indexes if they don't exist
CREATE UNIQUE INDEX IF NOT EXISTS publications_url_idx ON publications(url);
CREATE INDEX IF NOT EXISTS publications_category_idx ON publications(category);
CREATE UNIQUE INDEX IF NOT EXISTS regions_name_idx ON regions(name);
CREATE INDEX IF NOT EXISTS pub_regions_pub_id_idx ON publication_regions(publication_id);
CREATE INDEX IF NOT EXISTS pub_regions_region_id_idx ON publication_regions(region_id);
CREATE INDEX IF NOT EXISTS headlines_publication_id_idx ON headlines(publication_id);
CREATE INDEX IF NOT EXISTS headlines_normalized_date_idx ON headlines(normalized_date); -- Useful for date range filtering
CREATE INDEX IF NOT EXISTS headlines_headline_idx ON headlines(headline);
-- Removed redundant headline_date index
CREATE UNIQUE INDEX IF NOT EXISTS headlines_url_idx ON headlines(url); -- Changed to UNIQUE
CREATE INDEX IF NOT EXISTS headlines_category_idx ON headlines(category);

-- Seed Regions with explicit IDs
INSERT OR IGNORE INTO regions (id, name) VALUES
  ('smowo9pe', 'UK'),
  ('9AS6YO5R', 'US');

-- Seed Publications with explicit IDs
INSERT OR IGNORE INTO publications (id, url, name, category) VALUES
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
  ('69e53qIa', 'observer.com', 'Observer (US)', 'digital'), -- Changed from broadsheet to digital
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

-- Seed Publication Regions using explicit IDs
INSERT OR IGNORE INTO publication_regions (publication_id, region_id) VALUES
  ('0VrZ2G7e', 'smowo9pe'), -- BBC UK -> UK
  ('rF_6V8aR', '9AS6YO5R'), -- BBC US -> US
  ('0wipPq8p', 'smowo9pe'), -- Sky News -> UK
  ('JIAK2abB', 'smowo9pe'), -- ITV News -> UK
  ('zuHz7K1O', 'smowo9pe'), -- Channel 4 News -> UK
  ('iL9fva92', 'smowo9pe'), -- LBC -> UK
  ('bZf_anuD', 'smowo9pe'), -- TalkRadio -> UK
  ('Vd85yZis', 'smowo9pe'), -- The Guardian -> UK
  ('5AAczT1c', 'smowo9pe'), -- The Telegraph -> UK
  ('Hq0DyYXk', 'smowo9pe'), -- The Times -> UK
  ('kF45uwCN', 'smowo9pe'), -- Financial Times -> UK
  ('5rVE6jXH', 'smowo9pe'), -- The Economist -> UK
  ('69e53qIa', '9AS6YO5R'), -- Observer (US) -> US
  ('YtA3c_oU', 'smowo9pe'), -- The Independent -> UK
  ('KY9ft5qa', 'smowo9pe'), -- The Sun -> UK
  ('QHA1Ibtk', 'smowo9pe'), -- Daily Mirror -> UK
  ('ngQEhco8', 'smowo9pe'), -- Daily Mail -> UK
  ('go6mnnO5', 'smowo9pe'), -- Daily Express -> UK
  ('YepE_oz5', 'smowo9pe'), -- Daily Star -> UK
  ('E7_Gwns3', 'smowo9pe'), -- Metro -> UK
  ('CrE3lhyC', 'smowo9pe'), -- Daily Record -> UK
  ('3UXyvQNz', 'smowo9pe'), -- Morning Star -> UK
  ('fvaMhzYH', 'smowo9pe'), -- i News -> UK
  ('MGgw4B9C', 'smowo9pe'), -- Huffington Post UK -> UK
  ('SN_2aNB6', '9AS6YO5R'), -- Buzzfeed -> US
  ('aV_4vVQq', '9AS6YO5R'); -- Vice -> US

-- Seed Headlines with explicit IDs
INSERT OR IGNORE INTO headlines (id, url, headline, snippet, source, raw_date, normalized_date, category, publication_id) VALUES
  ('2VnHSYSU', 'https://www.bbc.co.uk/news/uk-politics-12345678', 'UK Government Announces New Budget Measures', 'Chancellor details spending plans for the upcoming fiscal year.', 'BBC News', '3 days ago', '18/05/2024', 'politics', '0VrZ2G7e'),
  ('NBC3s8s5', 'https://www.theguardian.com/world/2024/may/21/global-climate-summit-concludes', 'Climate Summit Ends with Mixed Results', 'Nations agree on some targets but major hurdles remain.', 'The Guardian', 'May 21, 2024', '21/05/2024', 'world', 'Vd85yZis'),
  ('A7hqWsia', 'https://www.bbc.com/news/technology-87654321', 'Tech Giant Unveils Revolutionary AI Chip', 'New processor promises unprecedented speed and efficiency.', 'BBC News', '1 day ago', '20/05/2024', 'technology', 'rF_6V8aR'),
  ('f-THkZ6W', 'https://www.ft.com/content/abcde12345', 'Markets React to Interest Rate Hike Speculation', 'Financial sector experiences volatility amid central bank signals.', 'Financial Times', 'May 20, 2024', '20/05/2024', 'business', 'kF45uwCN'),
  ('gpMvEoUG', 'https://www.thesun.co.uk/sport/football/98765432', 'Shock Transfer Rocks Premier League', 'Star player makes unexpected move to rival club.', 'The Sun', '2 hours ago', '21/05/2024', 'sports', 'KY9ft5qa'),
  ('m2VknNsW', 'https://observer.com/2024/05/19/new-art-exhibition-opens-downtown/', 'Major Art Exhibition Opens Downtown', 'Featuring works from renowned international artists.', 'Observer', 'May 19, 2024', '19/05/2024', 'artsCulture', '69e53qIa'),
  ('eXIJBGp5', 'https://www.dailymail.co.uk/tvshowbiz/article-11223344', 'Celebrity Couple Announce Surprise Engagement', 'Hollywood stars share romantic news on social media.', 'Daily Mail', 'Yesterday', '20/05/2024', 'entertainment', 'ngQEhco8');
-- Add more headline seeds as needed using the remaining IDs

-- Clean up remaining unused IDs (optional, good practice)
-- IDs used:
-- Regions: smowo9pe, 9AS6YO5R
-- Publications: 0VrZ2G7e, rF_6V8aR, 0wipPq8p, JIAK2abB, zuHz7K1O, iL9fva92, bZf_anuD, Vd85yZis, 5AAczT1c, Hq0DyYXk, kF45uwCN, 5rVE6jXH, 69e53qIa, YtA3c_oU, KY9ft5qa, QHA1Ibtk, ngQEhco8, go6mnnO5, YepE_oz5, E7_Gwns3, CrE3lhyC, 3UXyvQNz, fvaMhzYH, MGgw4B9C, SN_2aNB6, aV_4vVQq
-- Headlines: 2VnHSYSU, NBC3s8s5, A7hqWsia, f-THkZ6W, gpMvEoUG, m2VknNsW, eXIJBGp5
-- Remaining: BMKyNZZd, 9MensF5J, fBOHYNTD, Sn_5NzNx, M8zT_4yW, nMyS-Hsb, uESi0-tJ, sPAVYnu8, YrDGwULm, ovq4QDZT, -91JySq1, sF19CVDJ, g0E-m37D, NV_UFC2J, b1kHE_7b
 