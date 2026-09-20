import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSessionCookie,
  derivePasswordHash,
  normalizeLoginInput,
  normalizeSignupInput,
  parseCookieHeader,
  sessionCookie,
  verifyPassword,
} from "../worker/auth.js";

test("signup normalization validates identity fields and preserves a valid claim workspace", () => {
  const claimWorkspaceId = "123e4567-e89b-42d3-a456-426614174000";
  const result = normalizeSignupInput({
    name: "  Yaswanth   Kadhati ",
    email: " TEST@Example.COM ",
    password: "correct-horse-battery",
    workspaceName: " Platform  Engineering ",
    claimWorkspaceId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.name, "Yaswanth Kadhati");
  assert.equal(result.data.email, "test@example.com");
  assert.equal(result.data.workspaceName, "Platform Engineering");
  assert.equal(result.data.claimWorkspaceId, claimWorkspaceId);
});


test("signup rejects overlong account metadata instead of silently truncating", () => {
  const result = normalizeSignupInput({
    name: "A".repeat(61),
    email: `${"a".repeat(245)}@example.com`,
    password: "a-secure-enough-password",
    workspaceName: "W".repeat(61),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.name);
  assert.ok(result.errors.email);
  assert.ok(result.errors.workspaceName);
});

test("login normalization rejects malformed credentials without exposing account state", () => {
  const result = normalizeLoginInput({ email: "not-an-email", password: "" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.email);
  assert.ok(result.errors.password);
});

test("password derivation is salted and verification rejects the wrong password", async () => {
  const record = await derivePasswordHash("a-strong-demo-password");
  assert.equal(record.algorithm, "PBKDF2-SHA256");
  assert.ok(record.iterations >= 100_000);
  assert.equal(await verifyPassword("a-strong-demo-password", {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations,
  }), true);
  assert.equal(await verifyPassword("wrong-password", {
    password_hash: record.hash,
    password_salt: record.salt,
    password_iterations: record.iterations,
  }), false);
});

test("session cookie is HttpOnly, SameSite and Secure in production", () => {
  const cookie = sessionCookie("opaque-token", true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.equal(parseCookieHeader("a=1; incidentops_session=opaque-token; b=2").incidentops_session, "opaque-token");
  assert.match(clearSessionCookie(true), /Max-Age=0/);
});
