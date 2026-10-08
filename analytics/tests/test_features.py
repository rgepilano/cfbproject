import numpy as np
import pandas as pd
import pytest

from pipeline import player_value
from recruit_projection import blend_score, estimate_nil
from transfer_risk import (BASELINE_FLAGS, baseline_score, build_stat_features, haversine_miles, match_portal,
                           norm_name)


def test_norm_name_strips_suffix_and_punctuation():
    assert norm_name("Dwight Phillips Jr.") == "dwight phillips"
    assert norm_name("Au'Tori") == "autori"
    assert norm_name(None) == ""


def test_haversine_known_distance():
    # Athens, GA to Atlanta, GA is roughly 60-65 miles.
    d = haversine_miles(pd.Series([33.95]), pd.Series([-83.38]), pd.Series([33.75]), pd.Series([-84.39]))
    assert 55 < d.iloc[0] < 70


def _stats(rows):
    return pd.DataFrame(rows, columns=["athlete_id", "season", "team", "stat_position", "metric", "value"])


def test_usage_share_and_depth_rank_within_team_group():
    stats = _stats([
        (1, 2025, "A", "RB", "rushing.CAR", 150), (1, 2025, "A", "RB", "receiving.REC", 10),
        (2, 2025, "A", "RB", "rushing.CAR", 40),
        (3, 2025, "B", "RB", "rushing.CAR", 100),
    ])
    sf = build_stat_features(stats).set_index("athlete_id")
    assert sf.loc[1, "usage_share"] == pytest.approx(160 / 200)
    assert sf.loc[2, "usage_share"] == pytest.approx(40 / 200)
    assert sf.loc[3, "usage_share"] == pytest.approx(1.0)
    assert sf.loc[1, "depth_rank"] == 1 and sf.loc[2, "depth_rank"] == 2


def test_build_stat_features_team_filter():
    stats = _stats([(1, 2025, "A", "WR", "receiving.REC", 10), (2, 2025, "FCS", "WR", "receiving.REC", 50)])
    sf = build_stat_features(stats, {"A"})
    assert list(sf.athlete_id) == [1]


def test_match_portal_exact_and_initial():
    roster = pd.DataFrame({
        "athlete_id": [10, 11], "season": [2025, 2025], "team": ["A", "A"], "group": ["QB", "WR"],
        "k_first": ["john", "michael"], "k_last": ["smith", "jones"],
    })
    portal = pd.DataFrame({
        "season": [2026, 2026, 2026], "first_name": ["John", "Mike", "Nobody"],
        "last_name": ["Smith", "Jones", "Here"], "position": ["QB", "WR", "RB"],
        "origin": ["A", "A", "A"], "destination": [None, "B", None], "eligibility": ["Immediate"] * 3,
    })
    departures, arrivals, stats = match_portal(portal, roster)
    got = departures.set_index("portal_row")
    assert got.loc[0, "athlete_id"] == 10 and got.loc[0, "match"] == "exact"
    assert got.loc[1, "athlete_id"] == 11 and got.loc[1, "match"] == "initial"
    assert 2 not in got.index
    assert stats[2026] == {"entries": 3, "matched": 2, "matched_exact": 1}


def test_baseline_score_bounds():
    n = 50
    rng = np.random.default_rng(0)
    f = pd.DataFrame({
        "has_stat_role": rng.integers(0, 2, n), "usage_share": rng.random(n), "usage_change": rng.normal(0, .2, n),
        "stars": rng.integers(2, 6, n), "pedigree_gap": rng.normal(0, .4, n), "new_head_coach": rng.integers(0, 2, n),
        "incoming_recruits": rng.integers(0, 5, n), "incoming_bluechips": rng.integers(0, 2, n),
        "incoming_transfers": rng.integers(0, 4, n), "prior_transfer": rng.integers(0, 2, n),
        "class_year": rng.integers(1, 6, n), "prev_win_pct": rng.random(n),
    })
    points = {k: int(v) for k, v in zip(BASELINE_FLAGS, rng.integers(-5, 10, len(BASELINE_FLAGS)))}
    s = baseline_score(f, points)
    assert s.between(0, 100).all()


def test_blend_score_range_and_order():
    a = pd.Series([0.1, 0.5, 0.9])
    s = blend_score(a, a, a)
    assert s.is_monotonic_increasing and s.between(0, 1).all()


def test_recruit_nil_uses_similar_first_year_peer_and_committed_team_pool():
    recruits = pd.DataFrame({
        "group": ["WR", "WR"], "rating": [0.8, np.nan], "committed_to": ["Target", None],
    })
    features = pd.DataFrame({
        "athlete_id": [1, 2, 3], "season": [2025, 2025, 2025],
        "years_since_hs": [1, 1, 2], "rating": [0.81, 0.99, 0.80],
    })
    nil = pd.DataFrame({
        "athlete_id": [1, 2, 3], "season": [2025, 2025, 2025], "team": ["Peer", "Peer", "Target"],
        "group": ["WR"] * 3, "nil_value": [100_000, 900_000, 700_000],
        "nil_share": [0.01, 0.09, 0.07], "team_nil_pool": [10_000_000] * 3,
    })

    estimate = estimate_nil(recruits, features, nil, neighbors=1)

    assert estimate.estimated_nil.iloc[0] == pytest.approx(100_000)
    assert estimate.estimated_nil.iloc[1] == pytest.approx(500_000)


def test_player_value_falls_back_to_pedigree():
    f = pd.DataFrame({"production_pct": [np.nan, 1.0], "rating_pct": [0.8, 0.0]})
    v = player_value(f)
    assert v.iloc[0] == pytest.approx(0.8)
    assert v.iloc[1] == pytest.approx(0.65)
