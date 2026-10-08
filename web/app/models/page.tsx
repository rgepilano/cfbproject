import { connection } from "next/server";
import { Card, Table, Td, Th } from "@/components/ui";
import { sql } from "@/lib/db";

type Run = { run_id: string; model_name: string; version: string; trained_at: string; metrics: Record<string, unknown> };
type Check = { check_name: string; value: string; checked_at: string };

function MetricTable({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data);
  const cols = Array.from(new Set(rows.flatMap(([, v]) => Object.keys((v ?? {}) as object))));
  return (
    <Table>
      <thead><tr><Th>Score</Th>{cols.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <Td className="font-medium">{k}</Td>
            {cols.map((c) => <Td key={c}>{String((v as Record<string, unknown>)?.[c] ?? "—")}</Td>)}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function pivot(m: Record<string, Record<string, unknown>>) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [metric, byScore] of Object.entries(m)) {
    for (const [score, value] of Object.entries(byScore ?? {})) (out[score] ??= {})[metric] = value;
  }
  return out;
}

export default async function ModelsPage() {
  await connection();
  const [runs, checks] = await Promise.all([
    sql<Run>(
      `SELECT DISTINCT ON (model_name) run_id, model_name, version, trained_at, metrics
       FROM analytics.model_run ORDER BY model_name, trained_at DESC`,
    ),
    sql<Check>("SELECT check_name, value, checked_at FROM analytics.data_quality"),
  ]);
  const byName = Object.fromEntries(runs.map((r) => [r.model_name, r]));
  const tr = byName.transfer_risk?.metrics as Record<string, never> | undefined;
  const nfl = byName.nfl_risk?.metrics as Record<string, never> | undefined;
  const rp = byName.recruit_projection?.metrics as Record<string, never> | undefined;

  return (
    <>
      <h1 className="text-2xl font-bold">Models</h1>
      <p className="text-sm text-slate-500">
        Latest run {runs[0]?.run_id ?? "—"} · trained {runs[0] ? new Date(runs[0].trained_at).toLocaleString() : "—"}.
        All validation is out-of-time (train on earlier seasons/classes, test on the next).
      </p>

      <h2 className="mt-4 text-lg font-semibold">How to read this page</h2>
      <p className="mt-2 text-base text-slate-700">
        High-level summary: this page surfaces the most recent trained models and their
        validation results for the production families we maintain. Each card below shows
        the primary validation metrics and a short interpretation — use this when you need
        to explain what the model does, how it was evaluated, and what to watch for when
        interpreting predictions.
      </p>

      <div className="mt-3 text-sm text-slate-700">
        <strong>Quick guide for non-technical audiences:</strong>
        <ul className="list-disc ml-5 mt-2">
          <li>Each card is one model family (what the model predicts).</li>
          <li>"Score" is the model's output — usually a probability or risk number per player.</li>
          <li>Validation metrics below show how the model performed on held-out data (data
              the model did not see during training).</li>
          <li>Use the "Details" text in each card for plain-language explanations and
              operational guidance (what the score means for staff decisions).</li>
        </ul>

        <strong className="mt-3 block">Metrics explained (plain language)</strong>
        <ul className="list-disc ml-5 mt-2">
          <li><strong>Score</strong>: A higher score means the model thinks the event is more likely for that person (for example, higher transfer risk).</li>
          <li><strong>Brier</strong>: Measures how close predicted probabilities are to actual outcomes (lower is better). Think of it as an average squared "error" for probabilities.</li>
          <li><strong>PR AUC</strong> (Precision–Recall AUC): Shows how well the model finds true positives without including too many false positives. Useful when the event is rare.</li>
          <li><strong>ROC AUC</strong>: Indicates how well the model ranks positives above negatives (higher = better ranking).</li>
          <li><strong>Base rate</strong>: The observed frequency of the outcome (for context — if the base rate is 5%, a model that finds 25% positives in a slice is doing well).</li>
          <li><strong>Precision_top10pct</strong>: Of the top 10% highest-scored people, what fraction actually had the outcome. This shows how useful the top-ranked list is for targeted actions.</li>
        </ul>
      </div>

      {tr && (
        <Card title="Transfer risk — validation (roster 2025 → portal 2026)">
          <MetricTable data={tr["validation"]} />
          <p className="mt-2 text-xs text-slate-500">Chosen model: {tr["chosen_model"]} · tiers {JSON.stringify(tr["tier_counts"])}</p>
          <div className="mt-3 text-xs text-slate-600">
            <strong>Details (plain language):</strong> Transfer risk estimates how likely a
            rostered player is to enter the transfer portal the next season. We train the
            model on past seasons and test it on the following season (this mimics real
            deployment). Metrics shown summarize how well the model separates higher-risk
            players from lower-risk ones and how accurate the probabilities are.

            <strong className="block mt-2">What this means for staff</strong>
            - Use high scores to prioritize retention conversations and targeted support.
            - The model gives relative risk, not certainties: it helps allocate scarce
              advising resources rather than making final decisions.

            <strong className="block mt-2">Technical note (for transparency)</strong>
            - <em>Chosen_model</em> is the algorithm/version we selected after validation.
            - <em>Tier_counts</em> show how many athletes fall into each risk bucket.
            - Small probabilities can still imply meaningful differences when comparing players.
          </div>
        </Card>
      )}
      {nfl && (
        <Card title="NFL early-entry risk">
          {nfl["validation"] ? <MetricTable data={nfl["validation"]} /> : null}
          <p className="text-sm text-slate-500">
            Mode: {nfl["mode"]} · expected early entrants next draft: {nfl["expected_early_entrants"]} · tiers {JSON.stringify(nfl["tier_counts"]) }
          </p>
          <div className="mt-3 text-xs text-slate-600">
            <strong>Details (plain language):</strong> This model predicts the chance a
            college player will declare early for the NFL draft. In simple terms, the model
            ranks players by how likely they are to enter the draft early and gives an
            estimated probability for each player.

            <strong className="block mt-2">What this means for staff</strong>
            - Use the ranking to focus conversations with players and prepare draft
              readiness resources for those most likely to declare.
            - The <em>expected_early_entrants</em> number is an aggregate forecast and should
              be used alongside scouting reports and agent intelligence.

            <strong className="block mt-2">Technical note</strong>
            - The model is intended to inform planning and resource allocation, not replace
              case-by-case evaluation.
          </div>
        </Card>
      )}
      {rp && (
        <Card title={`Recruit projection — validation (class ${rp["valid_class"]})`}>
          <MetricTable data={pivot({
            spearman_peak_pct: rp["spearman_peak_pct"],
            impact_roc_auc: rp["impact_roc_auc"],
            impact_top_decile_hit: rp["impact_top_decile_hit"],
          })} />
          <p className="mt-2 text-xs text-slate-500">
            Outcomes: {JSON.stringify(rp["outcome_definition"]) }
          </p>
          <div className="mt-3 text-xs text-slate-600">
            <strong>Details (plain language):</strong> Recruit projection gives an estimated
            future impact for recruits in the class shown. "Impact" is defined explicitly
            in <em>outcome_definition</em> (for example: percent of games played in the first
            three seasons, a starts-weighted minutes metric, or a composite that blends
            playing time and performance). The model returns a score for each recruit that
            represents relative expected contribution compared with peers.

            <strong className="block mt-2">What inputs feed the model</strong>
            - High-school/performance metrics (game stats, offer level, camp/trial data).
            - Physical attributes (height, weight, age) and position grouping.
            - Contextual signals (team level, recruit's exposure, multi-sport background).
            - Historical labels from prior classes tying these inputs to later college impact.

            <strong className="block mt-2">How to read the metrics</strong>
            - <em>Spearman rank</em>: shows whether the model tends to put higher-impact
              future players at higher scores (useful when you want a ranked list).
            - <em>ROC-AUC</em>: measures how well the model separates high-impact recruits
              from lower-impact ones (50% is random, closer to 100% is better).
            - <em>Top-decile hit rate</em>: of the top 10% ranked recruits, how many
              actually become high-impact players — a practical measure of how useful the
              short-list is for recruiting focus.

            <strong className="block mt-2">Operational use and examples</strong>
            - Use scores to prioritize scouting visits and allocate recruiting budget to the
              highest-ranked prospects.
            - Example: if the base rate of high-impact outcomes is 5% but the top-decile
              hit rate is 30%, the model provides 6× enrichment and identifies a much
              stronger candidate pool for targeted offers.

            <strong className="block mt-2">Limitations and cautions</strong>
            - These are probabilistic forecasts, not guarantees. Low scores do not mean a
              recruit "can't" succeed — they mean the model has less historical evidence
              to expect high impact.
            - Models can encode historical biases in recruiting exposure and opportunity;
              combine quantitative results with coach evaluation to avoid over-reliance.
            - Check calibration occasionally: if predicted probabilities consistently
              over- or under-estimate outcomes, the scores need recalibration before use.

            <strong className="block mt-2">Maintenance notes</strong>
            - We retrain annually after each completed class; monitor performance drift and
              data quality for cohorts with different characteristics.

            <strong className="block mt-2">Quick example interpretation</strong>
            - A recruit with score 0.20 in a system where the class average expected impact
              is 0.05 is relatively promising — the number itself depends on the
              <em>outcome_definition</em>, so compare scores within the same release.
          </div>
        </Card>
      )}

      <Card title="Data quality">
        <Table>
          <thead><tr><Th>Check</Th><Th>Value</Th></tr></thead>
          <tbody>
            {checks.map((c) => <tr key={c.check_name}><Td>{c.check_name}</Td><Td>{c.value}</Td></tr>)}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-slate-600">
          <strong>Details:</strong> These data-quality checks surface upstream issues that
          could affect model training and scoring (missing cohorts, unexpected nulls,
          or distribution shifts). If any check fails, investigate the corresponding
          data pipeline before trusting new model runs.
        </p>
      </Card>
    </>
  );
}
