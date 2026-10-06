"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function ParamSelect({
  name,
  value,
  options,
  label,
  allLabel,
}: {
  name: string;
  value?: string;
  options: string[];
  label: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (next) p.set(name, next);
    else p.delete(name);
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
