export const DEFAULT_WEIGHTS = { quality: 0.5, need: 0.25, eligibility: 0.15, fit: 0.1 };
export type Weights = typeof DEFAULT_WEIGHTS;

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
  seasons_left_est: number | null;
  home_state: string | null;
  quality: number;
  eligibility_score: number;
  need: number;
  fit: number;
  default_score: number;
};

export function scoreCandidate(c: Pick<Candidate, "quality" | "need" | "eligibility_score" | "fit">, w: Weights): number {
  const total = w.quality + w.need + w.eligibility + w.fit || 1;
  return (100 * (w.quality * c.quality + w.need * c.need + w.eligibility * c.eligibility_score + w.fit * c.fit)) / total;
}
