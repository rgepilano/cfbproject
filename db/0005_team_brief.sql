CREATE SCHEMA IF NOT EXISTS web;
CREATE TABLE IF NOT EXISTS web.team_brief (
  cache_key text PRIMARY KEY,
  team text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  brief jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA web TO cfb_web, cfb_watch;
GRANT SELECT ON web.team_brief TO cfb_web;
GRANT SELECT, INSERT, UPDATE ON web.team_brief TO cfb_watch;