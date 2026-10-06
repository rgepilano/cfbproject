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

export async function login(_: string | null, form: FormData): Promise<string | null | { redirect: string }> {
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!loginConfigured()) {
    return "Login is not configured on the server.";
  }
  try {
    if (!(await checkCredentials(username, password))) {
      await new Promise((r) => setTimeout(r, 750));
      return "Invalid username or password.";
    }
    const token = await createSession(username);
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return { redirect: safeNext(form.get("next")) };
  } catch (err: any) {
    // Surface a friendly error instead of letting a runtime exception propagate to the platform.
    console.error("Login error:", err && err.stack ? err.stack : err);
    // If it's an AUTH_SECRET problem, return a clear message for operators.
    if (typeof err?.message === "string" && err.message.includes("AUTH_SECRET")) {
      return "Server misconfiguration: AUTH_SECRET invalid or missing. Set a 32+ char AUTH_SECRET in environment variables.";
    }
    return "Internal server error during login. Check server logs.";
  }
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
