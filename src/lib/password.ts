/**
 * Password hashing primitives (#76) — pure helpers, no server-only / @/db
 * imports, so tests can import this module directly.
 *
 * Argon2id is the OWASP-recommended password hashing algorithm. bcrypt
 * (the legacy scheme) silently truncates input at 72 bytes, which drops
 * meaningful content from multi-byte passwords; Argon2id has no such limit.
 *
 * Migration is transparent: hashes are dispatched on their prefix, and a
 * legacy bcrypt hash that just verified successfully is re-hashed with
 * Argon2id by the caller (see loginAction).
 */
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import * as bcrypt from "bcryptjs";

/**
 * OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations,
 * 1 lane). Passed explicitly so a library default change can never silently
 * weaken stored hashes.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash a password with Argon2id (OWASP parameters). All NEW and upgraded
 * hashes use this scheme.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * True when the hash was produced by the legacy bcrypt scheme ($2a$, $2b$,
 * $2y$) and should be re-hashed with Argon2id after a successful verify.
 */
export function isLegacyBcryptHash(hash: string): boolean {
  return hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$");
}

/**
 * Verify a plaintext password against a stored hash, dispatching on the
 * hash's prefix:
 *   - `$argon2*` → Argon2id (current scheme)
 *   - `$2a$` / `$2b$` / `$2y$` → bcrypt (legacy, still verifies)
 *   - anything else → not a hash we produced; reject.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (hash.startsWith("$argon2")) {
    return argon2Verify(hash, password);
  }
  if (isLegacyBcryptHash(hash)) {
    return bcrypt.compare(password, hash);
  }
  return false;
}
