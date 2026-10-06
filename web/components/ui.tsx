import Link from "next/link";
import type { ReactNode } from "react";
import { tierClass } from "@/lib/util";

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tierClass(children)}`}>{children}</span>
  );
}

export function Bar({ value, max = 100, color = "bg-blue-500" }: { value: number; max?: number; color?: string }) {
  const w = Math.max(0, Math.min(100, (100 * value) / (max || 1)));
  return (
    <div className="h-2 w-full rounded bg-slate-200 dark:bg-slate-800">
      <div className={`h-2 rounded ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Th({ children, href, active }: { children: ReactNode; href?: string; active?: boolean }) {
  return (
    <th className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {href ? (
        <Link href={href} className={active ? "text-blue-600 underline" : "hover:underline"}>
          {children}
        </Link>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-2 py-1.5 text-sm ${className}`}>{children}</td>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">{children}</table>
    </div>
  );
}

export function PlayerLink({ id, children }: { id: unknown; children: ReactNode }) {
  if (id === null || id === undefined) return <>{children}</>;
  return (
    <Link href={`/players/${id}`} className="text-blue-600 hover:underline dark:text-blue-400">
      {children}
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}
