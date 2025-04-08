-- Migration to add serper_api_key column to settings table
ALTER TABLE settings ADD COLUMN serper_api_key TEXT;