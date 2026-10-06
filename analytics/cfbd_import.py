"""Import data from the CollegeFootballData API into the analytics schema (ing stays untouched).

Usage: python cfbd_import.py [--rosters]
Requires CFBD_API_KEY in .env.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import pandas as pd

from db import write_table

API = "https://api.collegefootballdata.com"
DRAFT_YEARS = range(2020, 2027)
HISTORICAL_ROSTER_YEARS = range(2021, 2024)
TEAM_YEAR = 2026


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
    import_team_locations()
    import_draft_picks()
    if "--rosters" in sys.argv:
        import_historical_rosters()
