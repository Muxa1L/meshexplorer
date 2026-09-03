/**
 * Password hashing helpers for MeshExplorer authentication.
 *
 * Uses the built-in Node.js scrypt implementation (no external dependencies).
 * This module is server-only (Node.js runtime) and must never be imported by
 * middleware or client components.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_LENGTH_BYTES = 64;
const SCHEME = "scrypt";

/**
 * Hash a plaintext password for storage.
 * Result format: `scrypt:<salt-hex>:<hash-hex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH_BYTES);
  return `${SCHEME}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored `scrypt:<salt>:<hash>` value.
 * Returns false for malformed stored values instead of throwing.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== SCHEME || !saltHex || !hashHex) {
    return false;
  }
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}