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

      {tr && (
        <Card title="Transfer risk — validation (roster 2025 → portal 2026)">
          <MetricTable data={tr["validation"]} />
          <p className="mt-2 text-xs text-slate-500">Chosen model: {tr["chosen_model"]} · tiers {JSON.stringify(tr["tier_counts"])}</p>
        </Card>
      )}
      {nfl && (
        <Card title="NFL early-entry risk">
          {nfl["validation"] ? <MetricTable data={nfl["validation"]} /> : null}
          <p className="text-sm text-slate-500">
            Mode: {nfl["mode"]} · expected early entrants next draft: {nfl["expected_early_entrants"]} · tiers {JSON.stringify(nfl["tier_counts"])}
          </p>
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
            Outcomes: {JSON.stringify(rp["outcome_definition"])}
          </p>
        </Card>
      )}

      <Card title="Data quality">
        <Table>
          <thead><tr><Th>Check</Th><Th>Value</Th></tr></thead>
          <tbody>
            {checks.map((c) => <tr key={c.check_name}><Td>{c.check_name}</Td><Td>{c.value}</Td></tr>)}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
