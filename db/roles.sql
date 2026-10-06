-- Least-privilege roles. Neither role can log in until you set a password yourself:
--   ALTER ROLE cfb_web PASSWORD '...';
--   ALTER ROLE cfb_scoring PASSWORD '...';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cfb_web') THEN
    CREATE ROLE cfb_web LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cfb_scoring') THEN
    CREATE ROLE cfb_scoring LOGIN;
  END IF;
END $$;

-- Lets the admin login transfer ownership to cfb_scoring and set its default privileges.
GRANT cfb_scoring TO CURRENT_USER;

ALTER ROLE cfb_web SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE postgres TO cfb_web, cfb_scoring;

-- Scoring job: read the source schema, own the analytics schema and its tables.
GRANT USAGE ON SCHEMA ing TO cfb_scoring;
GRANT SELECT ON ALL TABLES IN SCHEMA ing TO cfb_scoring;
ALTER DEFAULT PRIVILEGES IN SCHEMA ing GRANT SELECT ON TABLES TO cfb_scoring;
ALTER SCHEMA analytics OWNER TO cfb_scoring;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'analytics' LOOP
    EXECUTE format('ALTER TABLE analytics.%I OWNER TO cfb_scoring', t.tablename);
  END LOOP;
END $$;

-- Web app: read analytics plus the one source table it uses.
GRANT USAGE ON SCHEMA analytics TO cfb_web;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO cfb_web;
-- Tables are recreated on every scoring run, so grant on future tables too.
ALTER DEFAULT PRIVILEGES FOR ROLE cfb_scoring IN SCHEMA analytics GRANT SELECT ON TABLES TO cfb_web;
GRANT USAGE ON SCHEMA ing TO cfb_web;
GRANT SELECT ON ing.teams TO cfb_web;
