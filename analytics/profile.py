import pandas as pd

from db import query

CHECKS = {
    "allplayers object type": """
        SELECT table_name, table_type FROM information_schema.tables
        WHERE table_schema = 'ing' ORDER BY table_name
    """,
    "allplayers rows": 'SELECT count(*) AS n, count("recruitIds") AS with_recruit FROM ing.allplayers',
    "season coverage": """
        SELECT 'rosters' AS t, min("Season") AS min_s, max("Season") AS max_s FROM ing.rosters
        UNION ALL SELECT 'stats', min(season), max(season) FROM ing.stats
        UNION ALL SELECT 'hsrecruits', min(year), max(year) FROM ing.hsrecruits
        UNION ALL SELECT 'portalplayers', min(season), max(season) FROM ing.portalplayers
        UNION ALL SELECT 'coaches', min(year), max(year) FROM ing.coaches
    """,
    "rosters by season": """
        SELECT "Season", count(*) AS players, count(DISTINCT team) AS teams,
               count("recruitIds") AS with_recruit_id
        FROM ing.rosters GROUP BY 1 ORDER BY 1
    """,
    "rosters class year values": 'SELECT year, count(*) FROM ing.rosters GROUP BY 1 ORDER BY 1',
    "rosters duplicate id+season": """
        SELECT count(*) AS dup_groups FROM (
            SELECT id, "Season" FROM ing.rosters GROUP BY 1, 2 HAVING count(*) > 1) d
    """,
    "portal season vs transferDate": """
        SELECT season, count(*) AS entries,
               min(left("transferDate", 10)) AS first_date,
               max(left("transferDate", 10)) AS last_date,
               count(destination) AS with_destination
        FROM ing.portalplayers GROUP BY 1 ORDER BY 1
    """,
    "portal eligibility values": 'SELECT eligibility, count(*) FROM ing.portalplayers GROUP BY 1 ORDER BY 2 DESC',
    "portal -> roster match (same team, season-1 / same season)": """
        SELECT p.season,
               count(*) AS entries,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM ing.rosters r
                   WHERE lower(r."firstName") = lower(p."firstName")
                     AND lower(r."lastName") = lower(p."lastName")
                     AND r.team = p.origin AND r."Season" = p.season - 1)) AS match_prev_season,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM ing.rosters r
                   WHERE lower(r."firstName") = lower(p."firstName")
                     AND lower(r."lastName") = lower(p."lastName")
                     AND r.team = p.origin AND r."Season" = p.season)) AS match_same_season,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM ing.teams t WHERE t.school = p.origin)) AS origin_in_teams
        FROM ing.portalplayers p GROUP BY 1 ORDER BY 1
    """,
    "recruit -> roster match": """
        SELECT h.year, count(*) AS recruits,
               count(h."athleteId") AS with_athlete_id,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM ing.rosters r WHERE r.id = h."athleteId")) AS athlete_in_rosters,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM ing.rosters r WHERE r."recruitIds" = h.id)) AS recruit_id_in_rosters
        FROM ing.hsrecruits h GROUP BY 1 ORDER BY 1
    """,
    "recruitType values": 'SELECT "recruitType", count(*) FROM ing.hsrecruits GROUP BY 1',
    "stats category/statType": """
        SELECT category, string_agg(DISTINCT "statType", ', ') AS stat_types, count(*) AS rows
        FROM ing.stats GROUP BY 1 ORDER BY 1
    """,
    "stats -> roster match": """
        SELECT count(DISTINCT (s."playerId", s.season)) AS player_seasons,
               count(DISTINCT (s."playerId", s.season)) FILTER (WHERE EXISTS (
                   SELECT 1 FROM ing.rosters r
                   WHERE r.id = s."playerId" AND r."Season" = s.season)) AS in_rosters
        FROM ing.stats s
    """,
    "teams classification": 'SELECT classification, count(*) FROM ing.teams GROUP BY 1 ORDER BY 2 DESC',
    "sample text/json fields": """
        SELECT (SELECT location FROM ing.teams WHERE location IS NOT NULL LIMIT 1) AS team_location,
               (SELECT "hometownInfo" FROM ing.hsrecruits WHERE "hometownInfo" IS NOT NULL LIMIT 1) AS hometown,
               (SELECT "transferDate" FROM ing.portalplayers WHERE "transferDate" IS NOT NULL LIMIT 1) AS transfer_date,
               (SELECT "winPercentage" FROM ing.coaches LIMIT 1) AS win_pct
    """,
    "height ranges": """
        SELECT 'rosters' AS t, min(height), avg(height)::numeric(6,1), max(height) FROM ing.rosters
        UNION ALL SELECT 'hsrecruits', min(height), avg(height)::numeric(6,1), max(height) FROM ing.hsrecruits
    """,
}

if __name__ == "__main__":
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 50)
    pd.set_option("display.max_colwidth", 200)
    for name, sql in CHECKS.items():
        print(f"\n=== {name} ===")
        try:
            print(query(sql).to_string(index=False))
        except Exception as e:
            print(f"ERROR: {e}")
