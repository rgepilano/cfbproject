"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input name="username" autoComplete="username" placeholder="Username" required
        className="w-full rounded border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      <input name="password" type="password" autoComplete="current-password" placeholder="Password" required
        className="w-full rounded border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="w-full rounded bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
