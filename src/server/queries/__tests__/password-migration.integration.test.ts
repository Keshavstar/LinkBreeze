/**
 * #76 — password hash migration integration test: a legacy bcrypt hash in
 * the database verifies successfully AND gets upgraded to Argon2id, after
 * which only Argon2id verifies. Uses REAL crypto (no @/lib/auth mock — the
 * pure primitives in @/lib/password are imported directly) against the
 * in-memory sql.js database.
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import "./integration-setup";

import * as schema from "@/db/schema";
import * as bcrypt from "bcryptjs";
import {
  hashPassword,
  verifyPassword,
  isLegacyBcryptHash,
} from "@/lib/password";
import { db } from "@/server/queries/__tests__/integration-setup";

async function seedUser(passwordHash: string) {
  const [row] = await db
    .insert(schema.users)
    .values({ username: `admin-${Date.now()}-${Math.random()}`, passwordHash })
    .returning();
  return row;
}

describe("bcrypt → Argon2id transparent migration (#76)", () => {
  it("verifies a stored legacy bcrypt hash and upgrades it to Argon2id", async () => {
    const legacyHash = await bcrypt.hash("legacy-password-123", 12);
    const user = await seedUser(legacyHash);

    // Login-path verify against the legacy hash succeeds...
    const valid = await verifyPassword("legacy-password-123", user.passwordHash);
    expect(valid).toBe(true);
    expect(isLegacyBcryptHash(user.passwordHash)).toBe(true);

    // ...and the caller re-hashes with Argon2id and persists (the exact
    // sequence loginAction runs).
    const upgraded = await hashPassword("legacy-password-123");
    await db
      .update(schema.users)
      .set({ passwordHash: upgraded })
      .where(eq(schema.users.id, user.id));

    const [after] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(after.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("legacy-password-123", after.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong-password", after.passwordHash)).toBe(false);
    expect(isLegacyBcryptHash(after.passwordHash)).toBe(false);
  });

  it("verifies an Argon2id hash end-to-end without rehashing", async () => {
    const user = await seedUser(await hashPassword("already-argon2"));

    const valid = await verifyPassword("already-argon2", user.passwordHash);
    expect(valid).toBe(true);
    expect(isLegacyBcryptHash(user.passwordHash)).toBe(false);
  });

  it("round-trips a multibyte password over 72 bytes through the DB", async () => {
    const password = "🔒".repeat(40); // 160 bytes, past bcrypt's truncation point
    const user = await seedUser(await hashPassword(password));

    const [after] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(await verifyPassword(password, after.passwordHash)).toBe(true);
  });
});
