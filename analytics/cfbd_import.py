"""Import data from the CollegeFootballData API into the analytics schema (ing stays untouched).

Usage: python cfbd_import.py [--rosters] | --stats-year 2026
Requires CFBD_API_KEY in .env.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import pandas as pd

from db import write_table

API = "https://api.collegefootballdata.com"
DRAFT_YEARS = range(2020, 2027)
HISTORICAL_ROSTER_YEARS = range(2021, 2024)
TEAM_YEAR = 2026


def prepare_season_stats(rows: list[dict], year: int) -> pd.DataFrame:
    if not rows:
        raise ValueError(f"Empty stats response for {year}; previous snapshot retained")
    frame = pd.DataFrame(rows)
    required = ["season", "playerId", "team", "position", "category", "statType", "stat"]
    if not set(required).issubset(frame.columns):
        raise ValueError("Stats response is missing required fields")
    frame = frame[required].rename(columns={"playerId": "athlete_id", "statType": "stat_type"})
    for column in ["season", "athlete_id", "stat"]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    if frame.isna().any().any() or not frame.season.eq(year).all():
        raise ValueError("Stats response contains null fields or an unexpected season")
    frame = frame.astype({"season": "int64", "athlete_id": "int64", "stat": "float64"})
    frame = frame.drop_duplicates()
    keys = ["season", "athlete_id", "team", "category", "stat_type"]
    if frame.duplicated(keys).any():
        raise ValueError("Conflicting duplicate season totals; previous snapshot retained")
    frame["fetched_at"] = datetime.now(timezone.utc)
    frame["source"] = "/stats/player/season?seasonType=regular"
    return frame.reset_index(drop=True)


def import_season_stats(year: int) -> None:
    if not 1900 <= year <= 2100:
        raise ValueError("Stats year must be between 1900 and 2100")
    frame = prepare_season_stats(get("/stats/player/season", year=year, seasonType="regular"), year)
    table = f"cfbd_player_stats_{year}"
    write_table(frame, table, indexes=[["athlete_id", "season"], ["season", "team"]])
    print(f"{table}: {len(frame)} stat rows, {frame.athlete_id.nunique()} players; "
          f"fetched_at={frame.fetched_at.iloc[0].isoformat()}")


def get(path: str, **params) -> list[dict]:
    key = os.environ.get("CFBD_API_KEY") or os.environ.get("CFBD_KEY")
    if not key:
        sys.exit("CFBD_API_KEY (or CFBD_KEY) is not set in .env")
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def import_team_locations() -> None:
    rows = []
    for t in get("/teams", year=TEAM_YEAR):
        loc = t.get("location") or {}
        rows.append({
            "team_id": t.get("id"), "team": t.get("school"), "conference": t.get("conference"),
            "classification": t.get("classification"), "city": loc.get("city"), "state": loc.get("state"),
            "latitude": loc.get("latitude"), "longitude": loc.get("longitude"),
        })
    df = pd.DataFrame(rows).astype({"latitude": float, "longitude": float})
    write_table(df, "cfbd_team_location", indexes=[["team"]])
    print(f"cfbd_team_location: {len(df)} teams")


def import_draft_picks() -> None:
    rows = []
    for year in DRAFT_YEARS:
        for p in get("/draft/picks", year=year):
            rows.append({
                "year": p.get("year"), "round": p.get("round"), "pick": p.get("pick"), "overall": p.get("overall"),
                "college_athlete_id": p.get("collegeAthleteId"), "name": p.get("name"),
                "position": p.get("position"), "college_team": p.get("collegeTeam"),
                "college_conference": p.get("collegeConference"), "nfl_team": p.get("nflTeam"),
            })
    df = pd.DataFrame(rows).astype({"college_athlete_id": "Int64"})
    write_table(df, "cfbd_draft_pick", indexes=[["college_athlete_id"], ["year"]])
    print(f"cfbd_draft_pick: {len(df)} picks ({min(DRAFT_YEARS)}-{max(DRAFT_YEARS)})")


def import_historical_rosters() -> None:
    rows = []
    for year in HISTORICAL_ROSTER_YEARS:
        for p in get("/roster", year=year):
            rows.append({
                "athlete_id": p.get("id"), "season": year, "team": p.get("team"),
                "first_name": p.get("firstName"), "last_name": p.get("lastName"), "position": p.get("position"),
                "class_year": p.get("year"), "height": p.get("height"), "weight": p.get("weight"),
                "home_state": p.get("homeState"), "recruit_id": (p.get("recruitIds") or [None])[0],
            })
    df = pd.DataFrame(rows).astype({"athlete_id": "Int64", "recruit_id": "Int64"})
    write_table(df, "cfbd_roster_history", indexes=[["athlete_id", "season"], ["season", "team"]])
    print(f"cfbd_roster_history: {len(df)} player-seasons")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rosters", action="store_true")
    parser.add_argument("--stats-year", type=int)
    args = parser.parse_args()
    if args.stats_year is not None:
        import_season_stats(args.stats_year)
    else:
        import_team_locations()
        import_draft_picks()
        if args.rosters:
            import_historical_rosters()
