export const DEFAULT_TEAM = process.env.DEFAULT_TEAM ?? "Georgia";
export const POSITION_GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K", "P", "LS", "ATH"];

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || undefined;
}

export function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function num(v: unknown, digits = 1): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export function pct(v: unknown, digits = 0): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${(100 * n).toFixed(digits)}%` : "—";
}

export function name(r: { first_name?: unknown; last_name?: unknown }): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
}

export function tierClass(tier: unknown): string {
  switch (tier) {
    case "High":
    case "Elite":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    case "Medium":
    case "Solid":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

export function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const merged = { ...base, ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
