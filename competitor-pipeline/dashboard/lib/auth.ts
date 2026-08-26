// Single shared password, no user accounts. Deliberately dependency-free
// (Web Crypto only) so this same code runs unmodified in both the Edge
// middleware runtime and normal Node server actions/route handlers.

export const SESSION_COOKIE_NAME = "dashboard_session";
export const USER_COOKIE_NAME = "dashboard_user";
export const APPROVED_COUNT_COOKIE = "dashboard_approved_count";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufferToHex(digest);
}

// The cookie stores a hash of the password, not the password itself. This
// also means a password rotation invalidates every existing session
// automatically -- there's no separate expiry/revocation list to maintain
// for a 3-person internal tool.
export async function expectedSessionValue(): Promise<string> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    throw new Error("DASHBOARD_PASSWORD must be set (see .env.example).");
  }
  return sha256Hex(password);
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    throw new Error("DASHBOARD_PASSWORD must be set (see .env.example).");
  }
  return candidate === password;
}

export async function isValidSessionCookie(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await expectedSessionValue();
  return cookieValue === expected;
}

// Server-only helper (uses next/headers, not callable from middleware).
// reviewed_by on /review's approve action comes from this, not a free-text
// field on every approval -- "from session" per the spec.
export async function getCurrentUser(): Promise<string> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return cookieStore.get(USER_COOKIE_NAME)?.value || "unknown";
}
