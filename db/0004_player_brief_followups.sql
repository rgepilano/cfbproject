CREATE SCHEMA IF NOT EXISTS web;
CREATE TABLE IF NOT EXISTS web.player_brief_followup (
  username text NOT NULL,
  athlete_id text NOT NULL,
  team text NOT NULL,
  scenario text NOT NULL CHECK (scenario IN ('retention', 'acquisition')),
  item text NOT NULL,
  owner text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'verified')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, athlete_id, team, scenario, item)
);
GRANT USAGE ON SCHEMA web TO cfb_web, cfb_watch;
GRANT SELECT ON web.player_brief_followup TO cfb_web;
GRANT SELECT, INSERT, UPDATE ON web.player_brief_followup TO cfb_watch;
GRANT UPDATE ON web.player_brief TO cfb_watch;