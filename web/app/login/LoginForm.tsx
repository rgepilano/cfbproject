"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { useEffect } from "react";

export function LoginForm({ next }: { next: string }) {
  const [result, action, pending] = useActionState(login, null as any);

  // If the action returned a redirect object, perform client-side navigation.
  useEffect(() => {
    if (result && typeof result === "object" && "redirect" in result) {
      const r = (result as any).redirect as string;
      window.location.assign(r);
    }
  }, [result]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input name="username" autoComplete="username" placeholder="Username" required
        className="w-full rounded border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      <input name="password" type="password" autoComplete="current-password" placeholder="Password" required
        className="w-full rounded border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      {result && typeof result === "string" && <p className="text-sm text-red-600">{result}</p>}
      <button disabled={pending} className="w-full rounded bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
