/**
 * Stateless session tokens for MeshExplorer authentication.
 *
 * A token is an HMAC-SHA256 signed JSON payload (a minimal JWT-alike) built
 * with the Web Crypto API, so it can be created and verified in both the
 * Node.js runtime (API routes) and the Edge runtime (middleware) without any
 * external dependency.
 *
 * Configure `AUTH_SECRET` in the environment. In production without
 * `AUTH_SECRET` a warning is logged and an insecure fallback secret is used.
 */

export const SESSION_COOKIE_NAME = "meshexplorer_session";

/** Session lifetime in seconds (7 days). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  /** Subject: user id. */
  sub: string;
  /** User email (primary key of the users table). */
  email: string;
  /** Role at the time of login. Informational only — role checks re-read the database. */
  role: string;
  /** Expiry time as unix seconds. */
  exp: number;
}

const DEV_FALLBACK_SECRET = "meshexplorer-insecure-dev-secret-change-me";

let warnedAboutSecret = false;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production" && !warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn(
      "[auth] AUTH_SECRET is not set — falling back to an insecure development secret. " +
        "Set AUTH_SECRET to sign sessions securely."
    );
  }
  return DEV_FALLBACK_SECRET;
}

// ─── base64url helpers (Edge-safe, no Buffer) ────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
}

// ─── signing ────────────────────────────────────────────────────────────────

async function hmac(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

/** Constant-time string comparison (works on Edge, no node:crypto). */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Create a signed session token for the given payload. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const body = encodeJson(payload);
  const signature = await hmac(body);
  return `${body}.${signature}`;
}

/** Verify a session token and return its payload, or null when invalid/expired. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }
  const body = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  try {
    const expected = await hmac(body);
    if (!timingSafeEqualStrings(signature, expected)) {
      return null;
    }
    const payload = decodeJson<SessionPayload>(body);
    if (
      typeof payload?.sub !== "string" ||
      typeof payload?.email !== "string" ||
      typeof payload?.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Read and verify the session from a request's Cookie header.
 * Works with any Request (API routes) and NextRequest (middleware).
 */
export async function getSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      try {
        return await verifySessionToken(decodeURIComponent(trimmed.slice(eq + 1)));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Whether the request was made over HTTPS (directly or behind a proxy with
 * X-Forwarded-Proto), so the session cookie can be marked `Secure` accordingly.
 */
export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Cookie attributes used when issuing a session. */
export function buildSessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}