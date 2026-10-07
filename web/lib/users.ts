import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;
// Used for unknown usernames so response time doesn't reveal which accounts exist.
const DUMMY = { salt: randomBytes(16), hash: randomBytes(KEY_LEN) };

type Entry = { salt: Buffer; hash: Buffer; team?: string };

/**
 * APP_USERS format (extended):
 * "user1:saltHex:hashHex[:defaultTeam],user2:..."
 * The optional 4th field is a default team id or code assigned to the user.
 */
function users(): Map<string, Entry> {
  const map = new Map<string, Entry>();
  for (const item of (process.env.APP_USERS ?? "").split(",")) {
    const parts = item.trim().split(":");
    const [name, salt, hash, team] = parts;
    if (name && salt && hash) map.set(name.toLowerCase(), { salt: Buffer.from(salt, "hex"), hash: Buffer.from(hash, "hex"), team: team || undefined });
  }
  return map;
}

export function loginConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET) && (users().size > 0 || Boolean(process.env.APP_USERNAME && process.env.APP_PASSWORD));
}

export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const entry = users().get(username.toLowerCase());
  const target = entry ?? DUMMY;
  const derived = await scryptAsync(password, target.salt, KEY_LEN);
  if (entry) return timingSafeEqual(derived, entry.hash);

  // Legacy single login from APP_USERNAME / APP_PASSWORD.
  const u = process.env.APP_USERNAME;
  const p = process.env.APP_PASSWORD;
  if (!u || !p) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(username), digest(u)) && timingSafeEqual(digest(password), digest(p));
}

export function getUserDefaultTeam(username: string): string | null {
  const entry = users().get(username.toLowerCase());
  return entry?.team ?? null;
}

export function listUsers(): string[] {
  return [...users().keys()];
}
