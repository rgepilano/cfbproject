CREATE SCHEMA IF NOT EXISTS web;
CREATE TABLE IF NOT EXISTS web.player_brief (
  cache_key text PRIMARY KEY,
  athlete_id text NOT NULL,
  team text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  brief jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA web TO cfb_web, cfb_watch;
GRANT SELECT ON web.player_brief TO cfb_web;
GRANT SELECT, INSERT ON web.player_brief TO cfb_watch;