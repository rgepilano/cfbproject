-- Per-user watchlist. Lives in its own schema because the scoring job recreates analytics tables.
-- After applying, set a password:  ALTER ROLE cfb_watch PASSWORD '...';  then set PGWATCH_USER / PGWATCH_PASSWORD for the web app.
CREATE SCHEMA IF NOT EXISTS web;

CREATE TABLE IF NOT EXISTS web.watchlist (
  username  text        NOT NULL,
  item_key  text        NOT NULL,
  kind      text        NOT NULL CHECK (kind IN ('player', 'recruit')),
  item_id   text        NOT NULL,
  label     text        NOT NULL,
  sub       text,
  href      text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, item_key)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cfb_watch') THEN
    CREATE ROLE cfb_watch LOGIN;
  END IF;
END $$;

GRANT CONNECT ON DATABASE postgres TO cfb_watch;
GRANT USAGE ON SCHEMA web TO cfb_watch;
GRANT SELECT, INSERT, DELETE ON web.watchlist TO cfb_watch;
-- Existing read-only web role can also read it, if you keep using that login.
GRANT USAGE ON SCHEMA web TO cfb_web;
GRANT SELECT ON web.watchlist TO cfb_web;
