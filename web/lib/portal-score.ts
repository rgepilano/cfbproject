export const DEFAULT_WEIGHTS = { quality: 0.5, need: 0.25, eligibility: 0.15, fit: 0.1 };
export type Weights = typeof DEFAULT_WEIGHTS;
export type PortalSortKey = "rank" | "player" | "position" | "current_team" | "source" | "score" |
  "quality" | "need" | "eligibility_score" | "fit" | "production_pct" | "usage_share" |
  "transfer_risk" | "nil_value" | "nil_forecast" | "signing_nil_estimate";

export function comparePortalRows(
  first: Candidate & { score: number; rank: number },
  second: Candidate & { score: number; rank: number },
  key: PortalSortKey, direction: "asc" | "desc",
): number {
  const value = (row: Candidate & { score: number; rank: number }) => key === "player"
    ? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() : row[key];
  const firstValue = value(first);
  const secondValue = value(second);
  const missing = (item: unknown) => item == null || item === "" || (typeof item === "number" && !Number.isFinite(item));
  if (missing(firstValue) || missing(secondValue)) return Number(missing(firstValue)) - Number(missing(secondValue)) || first.rank - second.rank;
  const text = ["player", "position", "current_team", "source"].includes(key);
  const difference = text ? String(firstValue).localeCompare(String(secondValue), undefined, { sensitivity: "base" })
    : Number(firstValue) - Number(secondValue);
  return (direction === "asc" ? difference : -difference) || first.rank - second.rank;
}

export type Candidate = {
  candidate_id: number;
  source: string;
  athlete_id: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  pos_group: string | null;
  current_team: string | null;
  class_year: number | null;
  production_pct: number | null;
  usage_share: number | null;
  portal_rating: number | null;
  portal_stars: number | null;
  transfer_risk: number | null;
  nil_value: number | null;
  nil_forecast?: number | null;
  forecast_season?: number | null;
  nil_forecast_drivers?: string | null;
  signing_nil_estimate?: number | null;
  signing_nil_drivers?: string | null;
  signing_season?: number | null;
  seasons_left_est: number | null;
  home_state: string | null;
  quality: number;
  eligibility_score: number;
  need: number;
  fit: number;
  default_score: number;
};

export function estimateSigningNIL(candidate: Candidate, context: {
  budget: number; sourceBudget: number; starterValue: number; competition: number; season: number; team: string;
}): { signing_nil_estimate: number | null; signing_nil_drivers: string | null; signing_season: number } {
  const baseline = Number(candidate.nil_forecast ?? 0);
  if (baseline <= 0 || context.budget <= 0 || context.sourceBudget <= 0 || context.starterValue <= 0) {
    return { signing_nil_estimate: null, signing_nil_drivers: null, signing_season: context.season };
  }
  const strength = 0.6 * Math.max(0, Number(candidate.usage_share ?? 0))
    + 0.25 * candidate.quality + 0.15 * Math.max(0, Number(candidate.production_pct ?? 0)) + 0.05;
  const slots: Record<string, number> = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, DB: 4, K: 1, P: 1, LS: 1, ATH: 1 };
  const probability = Math.min(1, (slots[candidate.pos_group ?? ""] ?? 1) * strength / (strength + Math.max(0, context.competition)));
  const scale = Math.min(2, Math.max(0.5, context.budget / context.sourceBudget));
  const returningValue = baseline * scale;
  const premium = 1 + 0.20 * Math.min(1, Math.max(0, candidate.need));
  const value = Math.min(context.budget, ((1 - probability) * returningValue
    + probability * Math.max(returningValue, context.starterValue)) * premium);
  return {
    signing_nil_estimate: Math.round(value / 100) * 100,
    signing_season: context.season,
    signing_nil_drivers: `Hypothetical ${context.team} signing; adjusted budget $${Math.round(context.budget).toLocaleString()}; `
      + `budget scale ${scale.toFixed(2)}; starting opportunity ${(probability * 100).toFixed(0)}% (heuristic); `
      + `starter value $${Math.round(context.starterValue).toLocaleString()}; need premium ${((premium - 1) * 100).toFixed(0)}%; `
      + "returner and committed-recruit competition; not a depth chart or an available-budget guarantee",
  };
}

export function scoreCandidate(c: Pick<Candidate, "quality" | "need" | "eligibility_score" | "fit">, w: Weights): number {
  const total = w.quality + w.need + w.eligibility + w.fit || 1;
  return (100 * (w.quality * c.quality + w.need * c.need + w.eligibility * c.eligibility_score + w.fit * c.fit)) / total;
}
