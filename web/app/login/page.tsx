import { LoginForm } from "./LoginForm";
import { param, type SearchParams } from "@/lib/util";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const next = param(await searchParams, "next") ?? "/";
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h1 className="mb-4 text-xl font-bold">Sign in</h1>
      <LoginForm next={next} />
    </div>
  );
}
