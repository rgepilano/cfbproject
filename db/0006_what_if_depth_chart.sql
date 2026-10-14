CREATE SCHEMA IF NOT EXISTS web;
CREATE TABLE IF NOT EXISTS web.what_if_depth_chart (
  username text NOT NULL,
  team text NOT NULL,
  season integer NOT NULL,
  entry_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, team, season)
);
GRANT USAGE ON SCHEMA web TO cfb_web, cfb_watch;
GRANT SELECT ON web.what_if_depth_chart TO cfb_web;
GRANT SELECT, INSERT, UPDATE ON web.what_if_depth_chart TO cfb_watch;