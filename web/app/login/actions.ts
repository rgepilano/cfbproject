"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { checkCredentials, loginConfigured } from "@/lib/users";

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/";
  // Only same-site relative paths; blocks open redirects like //evil.com.
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

export async function login(_: string | null, form: FormData): Promise<string | null> {
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!loginConfigured()) {
    return "Login is not configured on the server.";
  }
  if (!(await checkCredentials(username, password))) {
    await new Promise((r) => setTimeout(r, 750));
    return "Invalid username or password.";
  }
  (await cookies()).set(SESSION_COOKIE, await createSession(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
