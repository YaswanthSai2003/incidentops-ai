const encoder = new TextEncoder();
const SESSION_COOKIE = "incidentops_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 120_000;
const PASSWORD_HASH_BYTES = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WORKSPACE_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomToken(bytes = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeSignupInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawName = String(source.name || "").trim().replace(/\s+/g, " ");
  const rawEmail = normalizeEmail(source.email);
  const password = typeof source.password === "string" ? source.password : "";
  const rawWorkspaceName = String(source.workspaceName || "").trim().replace(/\s+/g, " ");
  const name = rawName.slice(0, 60);
  const email = rawEmail.slice(0, 254);
  const workspaceName = rawWorkspaceName.slice(0, 60);
  const claimWorkspaceId = WORKSPACE_PATTERN.test(String(source.claimWorkspaceId || ""))
    ? String(source.claimWorkspaceId).toLowerCase()
    : null;
  const errors = {};

  if (name.length < 2) errors.name = "Enter your name.";
  else if (rawName.length > 60) errors.name = "Name must be under 60 characters.";
  if (!EMAIL_PATTERN.test(email) || rawEmail.length > 254) errors.email = "Enter a valid email address.";
  if (password.length < 10) errors.password = "Use at least 10 characters.";
  else if (password.length > 128) errors.password = "Password must be under 128 characters.";
  if (rawWorkspaceName.length > 60) errors.workspaceName = "Workspace name must be under 60 characters.";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: { name, email, password, workspaceName, claimWorkspaceId },
  };
}

export function normalizeLoginInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawEmail = normalizeEmail(source.email);
  const email = rawEmail.slice(0, 254);
  const password = typeof source.password === "string" ? source.password : "";
  const errors = {};
  if (!EMAIL_PATTERN.test(email) || rawEmail.length > 254) errors.email = "Enter a valid email address.";
  if (!password || password.length > 128) errors.password = "Enter your password.";
  return { ok: Object.keys(errors).length === 0, errors, data: { email, password } };
}

export async function derivePasswordHash(password, saltBase64Url = null, iterations = PBKDF2_ITERATIONS) {
  const salt = saltBase64Url ? base64UrlToBytes(saltBase64Url) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    PASSWORD_HASH_BYTES * 8,
  );
  return {
    hash: bytesToBase64Url(new Uint8Array(bits)),
    salt: bytesToBase64Url(salt),
    iterations,
    algorithm: "PBKDF2-SHA256",
  };
}

export async function verifyPassword(password, record) {
  if (!record?.password_salt || !record?.password_hash) return false;
  const iterations = Number(record.password_iterations || PBKDF2_ITERATIONS);
  const derived = await derivePasswordHash(password, record.password_salt, iterations);
  return constantTimeEqual(base64UrlToBytes(derived.hash), base64UrlToBytes(record.password_hash));
}

export function parseCookieHeader(header) {
  const result = {};
  for (const segment of String(header || "").split(";")) {
    const index = segment.indexOf("=");
    if (index < 1) continue;
    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function sessionCookie(token, production = true) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (production) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(production = true) {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (production) parts.push("Secure");
  return parts.join("; ");
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
  };
}

function publicWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role || "owner",
  };
}

async function workspacesForUser(db, userId) {
  const result = await db
    .prepare(
      `SELECT w.id, w.name, m.role
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ?1
       ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, w.created_at ASC`,
    )
    .bind(userId)
    .all();
  return (result.results || []).map(publicWorkspace);
}

async function issueSession(db, userId, production) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const expiresAt = now + SESSION_TTL_SECONDS;

  await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
      )
      .bind(id, userId, tokenHash, now, expiresAt),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
  ]);

  await db
    .prepare(
      `DELETE FROM sessions
       WHERE user_id = ?1 AND id NOT IN (
         SELECT id FROM sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 8
       )`,
    )
    .bind(userId)
    .run();

  return { cookie: sessionCookie(token, production), expiresAt };
}

async function sessionHashFromRequest(request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  return token ? sha256(token) : null;
}

export async function sessionContext(request, env) {
  if (!env.AUTH_DB) return null;
  const tokenHash = await sessionHashFromRequest(request);
  if (!tokenHash) return null;

  const now = nowSeconds();
  const row = await env.AUTH_DB
    .prepare(
      `SELECT s.id AS session_id, s.last_seen_at, s.expires_at,
              u.id, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first();

  if (!row) return null;
  if (now - Number(row.last_seen_at || 0) > 900) {
    await env.AUTH_DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2").bind(now, row.session_id).run();
  }

  const workspaces = await workspacesForUser(env.AUTH_DB, row.id);
  return {
    sessionId: row.session_id,
    user: publicUser(row),
    workspaces,
    defaultWorkspace: workspaces[0] || null,
  };
}

async function authRateLimitKey(request, email, action) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return sha256(`${action}|${ip}|${normalizeEmail(email)}`);
}

export async function consumeAuthRateLimit(request, db, email, action, limit, windowSeconds) {
  const key = await authRateLimitKey(request, email, action);
  const now = nowSeconds();
  const cutoff = now - windowSeconds;
  await db.prepare("DELETE FROM auth_attempts WHERE created_at < ?1").bind(cutoff).run();
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE bucket = ?1 AND created_at >= ?2")
    .bind(key, cutoff)
    .first();
  if (Number(row?.count || 0) >= limit) return false;
  await db.prepare("INSERT INTO auth_attempts (bucket, created_at) VALUES (?1, ?2)").bind(key, now).run();
  return true;
}

export async function signup(request, env, body) {
  const normalized = normalizeSignupInput(body);
  if (!normalized.ok) {
    return { ok: false, status: 422, code: "validation_failed", message: "Please fix the highlighted account fields.", details: normalized.errors };
  }

  const { name, email, password, workspaceName, claimWorkspaceId } = normalized.data;
  if (!(await consumeAuthRateLimit(request, env.AUTH_DB, email, "signup", 5, 30 * 60))) {
    return { ok: false, status: 429, code: "rate_limited", message: "Too many signup attempts. Try again later." };
  }

  const existing = await env.AUTH_DB.prepare("SELECT id FROM users WHERE email = ?1 LIMIT 1").bind(email).first();
  if (existing) {
    return { ok: false, status: 409, code: "email_exists", message: "An account already exists for this email address." };
  }

  if (claimWorkspaceId) {
    const claimed = await env.AUTH_DB.prepare("SELECT id FROM workspaces WHERE id = ?1 LIMIT 1").bind(claimWorkspaceId).first();
    if (claimed) {
      return { ok: false, status: 409, code: "workspace_claimed", message: "This demo workspace is already attached to an account." };
    }
  }

  const userId = crypto.randomUUID();
  const workspaceId = claimWorkspaceId || crypto.randomUUID();
  const createdAt = nowSeconds();
  const passwordRecord = await derivePasswordHash(password);
  const effectiveWorkspaceName = workspaceName || `${name.split(" ")[0] || "My"}'s workspace`;

  try {
    await env.AUTH_DB.batch([
      env.AUTH_DB
        .prepare(
          `INSERT INTO users (id, email, name, password_hash, password_salt, password_iterations, password_algorithm, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
        )
        .bind(
          userId,
          email,
          name,
          passwordRecord.hash,
          passwordRecord.salt,
          passwordRecord.iterations,
          passwordRecord.algorithm,
          createdAt,
        ),
      env.AUTH_DB
        .prepare("INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
        .bind(workspaceId, effectiveWorkspaceName, userId, createdAt),
      env.AUTH_DB
        .prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)")
        .bind(workspaceId, userId, createdAt),
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || error))) {
      return { ok: false, status: 409, code: "account_conflict", message: "That account or workspace is already registered." };
    }
    throw error;
  }

  const session = await issueSession(env.AUTH_DB, userId, new URL(request.url).protocol === "https:");
  return {
    ok: true,
    status: 201,
    cookie: session.cookie,
    user: { id: userId, name, email },
    workspace: { id: workspaceId, name: effectiveWorkspaceName, role: "owner" },
    claimedDemo: Boolean(claimWorkspaceId),
  };
}

export async function login(request, env, body) {
  const normalized = normalizeLoginInput(body);
  if (!normalized.ok) {
    return { ok: false, status: 422, code: "validation_failed", message: "Please fix the highlighted login fields.", details: normalized.errors };
  }

  const { email, password } = normalized.data;
  if (!(await consumeAuthRateLimit(request, env.AUTH_DB, email, "login", 12, 10 * 60))) {
    return { ok: false, status: 429, code: "rate_limited", message: "Too many login attempts. Try again later." };
  }

  const row = await env.AUTH_DB
    .prepare(
      `SELECT id, email, name, password_hash, password_salt, password_iterations, password_algorithm
       FROM users WHERE email = ?1 LIMIT 1`,
    )
    .bind(email)
    .first();

  const valid = row ? await verifyPassword(password, row) : false;
  if (!valid) {
    return { ok: false, status: 401, code: "invalid_credentials", message: "Email or password is incorrect." };
  }

  const workspaces = await workspacesForUser(env.AUTH_DB, row.id);
  if (!workspaces.length) throw new Error("Authenticated user has no workspace membership");
  const session = await issueSession(env.AUTH_DB, row.id, new URL(request.url).protocol === "https:");
  return {
    ok: true,
    status: 200,
    cookie: session.cookie,
    user: publicUser(row),
    workspace: workspaces[0],
    workspaces,
  };
}

export async function logout(request, env) {
  const tokenHash = await sessionHashFromRequest(request);
  if (tokenHash && env.AUTH_DB) {
    await env.AUTH_DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
  }
  return clearSessionCookie(new URL(request.url).protocol === "https:");
}

export async function workspaceRegistration(db, workspaceId) {
  if (!db || !workspaceId) return null;
  return db.prepare("SELECT id, name, owner_user_id FROM workspaces WHERE id = ?1 LIMIT 1").bind(workspaceId).first();
}

export async function canAccessWorkspace(db, userId, workspaceId) {
  if (!db || !userId || !workspaceId) return false;
  const row = await db
    .prepare("SELECT role FROM memberships WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1")
    .bind(workspaceId, userId)
    .first();
  return row ? { allowed: true, role: row.role } : { allowed: false, role: null };
}
