import pandas as pd

from db import query

CHECKS = {
    "null-season roster rows": """
        SELECT team, count(*) AS n, count(id) AS with_id, count("firstName") AS with_name,
               count(position) AS with_pos, count("recruitIds") AS with_recruit
        FROM ing.rosters WHERE "Season" IS NULL GROUP BY 1
    """,
    "null-season roster sample": 'SELECT * FROM ing.rosters WHERE "Season" IS NULL LIMIT 3',
    "roster rows where year looks like a season": """
        SELECT "Season", year, team, count(*) FROM ing.rosters
        WHERE year > 10 GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10
    """,
    "record placeholder counts": """
        SELECT
          (SELECT count(*) FILTER (WHERE location = '[Record]') FROM ing.teams) AS teams_location,
          (SELECT count(*) FILTER (WHERE "hometownInfo" = '[Record]') FROM ing.hsrecruits) AS hs_hometown,
          (SELECT count(*) FILTER (WHERE recruiting = '[Record]') FROM ing.coaches) AS coach_recruiting,
          (SELECT count(*) FILTER (WHERE "teamMetrics" = '[Record]') FROM ing.coaches) AS coach_metrics
    """,
    "coaches sample": """
        SELECT "coach.id", "coach.firstName", "coach.lastName", "team.school", year,
               games, wins, losses, "winPercentage", srs, "spOverall", "preseasonRank"
        FROM ing.coaches WHERE "team.school" = 'Georgia' ORDER BY year
    """,
    "coaches per team-year": """
        SELECT year, count(*) AS rows, count(DISTINCT "team.school") AS teams,
               count("spOverall") AS with_sp
        FROM ing.coaches GROUP BY 1 ORDER BY 1
    """,
    "portal destination blanks": """
        SELECT season,
               count(*) FILTER (WHERE coalesce(destination, '') = '') AS no_destination,
               count(*) FILTER (WHERE eligibility = 'Withdrawn') AS withdrawn
        FROM ing.portalplayers GROUP BY 1 ORDER BY 1
    """,
    "stats -> roster match for FBS 2025": """
        WITH sp AS (
            SELECT DISTINCT s."playerId" AS pid, (t.school IS NOT NULL) AS fbs
            FROM ing.stats s LEFT JOIN ing.teams t ON t.school = s.team AND t.classification = 'fbs'
            WHERE s.season = 2025),
        r AS (SELECT DISTINCT id FROM ing.rosters WHERE "Season" = 2025)
        SELECT sp.fbs, count(*) AS stat_players, count(r.id) AS in_rosters
        FROM sp LEFT JOIN r ON r.id = sp.pid GROUP BY 1
    """,
    "rosters home lat/long coverage": """
        SELECT "Season", count(*) AS n, count("homeLatitude") AS with_lat
        FROM ing.rosters WHERE "Season" IS NOT NULL GROUP BY 1 ORDER BY 1
    """,
    "hsrecruits bad heights": 'SELECT count(*) FROM ing.hsrecruits WHERE height < 60',
    "hsrecruits stars/rating": """
        SELECT stars, count(*), min(rating), max(rating) FROM ing.hsrecruits GROUP BY 1 ORDER BY 1
    """,
}

if __name__ == "__main__":
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 50)
    pd.set_option("display.max_colwidth", 80)
    for name, sql in CHECKS.items():
        print(f"\n=== {name} ===")
        try:
            print(query(sql).to_string(index=False))
        except Exception as e:
            print(f"ERROR: {e}")
