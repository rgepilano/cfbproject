// Local smoke test for the login gate. Usage: node scripts/check-auth.mjs [baseUrl]
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const base = process.argv[2] ?? "http://localhost:3100";
const payload = `${encodeURIComponent(env.APP_USERNAME)}.${Math.floor(Date.now() / 1000) + 600}`;
const sig = createHmac("sha256", env.AUTH_SECRET).update(payload).digest("hex");
const cookie = `cfb_session=${payload}.${sig}`;

for (const path of ["/", "/retention?team=Georgia", "/recruits", "/portal", "/watchlist", "/models", "/api/export?table=recruit_projection"]) {
  const res = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
  console.log(`${res.status} ${path}`);
}
