// Signed session tokens using Web Crypto, so the same code runs in proxy and server actions.
export const SESSION_COOKIE = "cfb_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

const encoder = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (32+ characters)");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(username: string): Promise<string> {
  const payload = `${encodeURIComponent(username)}.${Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  try {
    return safeEqual(sig, await hmac(`${user}.${exp}`));
  } catch {
    return false;
  }
}
