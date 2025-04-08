-- Migration script to add the 'settings' table for application configuration

-- Create the settings table (singleton)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  sync_frequency TEXT NOT NULL DEFAULT 'daily',
  default_region TEXT NOT NULL DEFAULT 'UK',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Insert the default settings record (only one record will ever exist)
INSERT OR IGNORE INTO settings (id, sync_enabled, sync_frequency, default_region)
VALUES (1, 1, 'daily', 'UK');