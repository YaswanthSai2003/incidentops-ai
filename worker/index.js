import { IncidentStore } from "./store.js";
import { IncidentInvestigationWorkflow } from "./workflow.js";
import {
  canAccessWorkspace,
  login,
  logout,
  sessionContext,
  signup,
  workspaceRegistration,
} from "./auth.js";
import {
  MODEL_ID_DEFAULT,
  normalizeChatMessage,
  normalizeIncidentInput,
  redactSecrets,
} from "./domain.js";

export { IncidentStore, IncidentInvestigationWorkflow };

const WORKSPACE_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(status, code, message, details) {
  return json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

function getWorkspaceId(request) {
  const value = request.headers.get("x-workspace-id") || "";
  return WORKSPACE_PATTERN.test(value) ? value.toLowerCase() : null;
}

function storeFor(env, workspaceId) {
  return env.INCIDENT_STORE.getByName(workspaceId);
}

async function readJson(request, maxBytes = 24000) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json."), { status: 415, code: "unsupported_media_type" });
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw Object.assign(new Error("Request body is too large."), { status: 413, code: "payload_too_large" });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw Object.assign(new Error("Request body is too large."), { status: 413, code: "payload_too_large" });
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw Object.assign(new Error("Request body contains invalid JSON."), { status: 400, code: "invalid_json" });
  }
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function assertSafeMutation(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!sameOrigin(request) || fetchSite === "cross-site") {
    throw Object.assign(new Error("Cross-origin mutations are not accepted."), { status: 403, code: "origin_rejected" });
  }
}

function pathParts(pathname) {
  return pathname.split("/").filter(Boolean);
}

async function resolveWorkspaceContext(request, env) {
  const requestedWorkspaceId = getWorkspaceId(request);
  const session = await sessionContext(request, env);

  if (session) {
    const workspaceId = requestedWorkspaceId || session.defaultWorkspace?.id || null;
    if (!workspaceId) {
      throw Object.assign(new Error("Your account does not have an accessible workspace."), { status: 403, code: "workspace_unavailable" });
    }
    const cachedMembership = session.workspaces.find((workspace) => workspace.id === workspaceId);
    const membership = cachedMembership || (await canAccessWorkspace(env.AUTH_DB, session.user.id, workspaceId));
    if (!membership || membership.allowed === false) {
      throw Object.assign(new Error("You do not have access to this workspace."), { status: 403, code: "workspace_forbidden" });
    }
    const workspace = cachedMembership || { id: workspaceId, name: "Workspace", role: membership.role };
    return {
      workspaceId,
      viewer: {
        mode: "account",
        authenticated: true,
        user: session.user,
        workspace,
      },
    };
  }

  if (!requestedWorkspaceId) {
    throw Object.assign(new Error("A valid demo workspace identifier is required."), { status: 400, code: "workspace_required" });
  }

  const registered = await workspaceRegistration(env.AUTH_DB, requestedWorkspaceId);
  if (registered) {
    throw Object.assign(new Error("This workspace is protected by an account. Sign in to continue."), { status: 401, code: "authentication_required" });
  }

  return {
    workspaceId: requestedWorkspaceId,
    viewer: {
      mode: "demo",
      authenticated: false,
      workspace: { id: requestedWorkspaceId, name: "Demo workspace", role: "demo" },
    },
  };
}

async function createIncident(request, env, workspaceId) {
  assertSafeMutation(request);
  const store = storeFor(env, workspaceId);
  const quota = await store.consumeQuota("create-incident", 8, 10 * 60 * 1000);
  if (!quota.allowed) return errorResponse(429, "rate_limited", "Too many incidents created in this workspace. Try again later.");

  const body = await readJson(request);
  const normalized = normalizeIncidentInput(body);
  if (!normalized.ok) return errorResponse(422, "validation_failed", "Please fix the highlighted incident fields.", normalized.errors);

  const incidentId = crypto.randomUUID();
  const workflowId = `incident-${incidentId}`;
  const incident = await store.createIncident({
    id: incidentId,
    ...normalized.data,
    status: "queued",
    severity: "unknown",
    workflowId,
    createdAt: new Date().toISOString(),
  });

  try {
    await env.INCIDENT_WORKFLOW.create({
      id: workflowId,
      params: { workspaceId, incidentId },
      retention: { successRetention: "1 day", errorRetention: "3 days" },
    });
    await store.setWorkflowId(incidentId, workflowId);
  } catch (error) {
    await store.markWorkflowError(incidentId, String(error?.message || error));
    const saved = await store.getIncident(incidentId);
    return json(
      {
        incident: saved,
        warning: "The incident was saved, but its investigation workflow could not be started.",
      },
      { status: 202 },
    );
  }

  return json({ incident: { ...incident, workflowId } }, { status: 201 });
}

async function incidentChat(request, env, workspaceId, incidentId) {
  assertSafeMutation(request);
  const store = storeFor(env, workspaceId);
  const incident = await store.getIncident(incidentId);
  if (!incident) return errorResponse(404, "incident_not_found", "Incident not found in this workspace.");

  const quota = await store.consumeQuota("chat", 24, 10 * 60 * 1000);
  if (!quota.allowed) return errorResponse(429, "rate_limited", "Chat limit reached for this workspace. Try again later.");

  const body = await readJson(request, 5000);
  const normalized = normalizeChatMessage(body.message);
  if (!normalized.ok) return errorResponse(422, "validation_failed", normalized.error);

  await store.addChatMessage(incidentId, "user", normalized.content);
  const history = await store.getChatMessages(incidentId, 10);

  const incidentContext = {
    title: incident.title,
    service: incident.service,
    environment: incident.environment,
    status: incident.status,
    severity: incident.severity,
    category: incident.category,
    summary: incident.summary,
    likelyCause: incident.likelyCause,
    evidence: incident.evidence,
    actions: incident.actions,
    verification: incident.verification,
    signals: incident.signals,
  };

  let content;
  try {
    const result = await env.AI.run(env.MODEL_ID || MODEL_ID_DEFAULT, {
      messages: [
        {
          role: "system",
          content:
            "You are the incident-scoped copilot inside IncidentOps AI. Answer using the incident context and conversation only. Be concise, operational, and uncertainty-aware. Never claim to execute infrastructure changes. Never ask for credentials or secrets. When recommending a change, include a verification or rollback consideration.",
        },
        {
          role: "system",
          content: `Incident context: ${JSON.stringify(incidentContext)}`,
        },
        ...history.map((message) => ({ role: message.role, content: message.content })),
      ],
      temperature: 0.25,
      max_tokens: 550,
    });
    const response = result?.response;
    content = typeof response === "string" ? response.trim() : "";
    if (!content) throw new Error("Empty model response");
  } catch (error) {
    content = incident.summary
      ? `The model is temporarily unavailable. Based on the stored investigation: ${incident.summary} ${incident.actions?.[0] ? `First safe action: ${incident.actions[0]}` : ""}`.trim()
      : "The model is temporarily unavailable. The durable investigation is still processing; check the timeline and retry after the assessment completes.";
    await store.appendTimeline(incidentId, "chat_fallback", "Incident copilot used a stored-assessment fallback.", {
      error: redactSecrets(String(error?.message || error)).slice(0, 220),
    });
  }

  content = redactSecrets(content).slice(0, 2400);
  const message = await store.addChatMessage(incidentId, "assistant", content);
  return json({ message });
}

async function updateStatus(request, env, workspaceId, incidentId) {
  assertSafeMutation(request);
  const body = await readJson(request, 3000);
  const status = String(body.status || "");
  if (status !== "resolved") {
    return errorResponse(422, "invalid_status", "The public application only allows a human to mark an incident resolved.");
  }
  const note = redactSecrets(String(body.note || "")).slice(0, 300);
  const store = storeFor(env, workspaceId);
  const current = await store.getIncident(incidentId);
  if (!current) return errorResponse(404, "incident_not_found", "Incident not found in this workspace.");
  if (["queued", "investigating"].includes(current.status)) {
    return errorResponse(409, "investigation_in_progress", "Wait for the durable investigation to finish before resolving this incident.");
  }
  const incident = await store.updateStatus(incidentId, status, note);
  return json({ incident });
}

async function authApi(request, env, url) {
  if (!env.AUTH_DB) return errorResponse(503, "auth_database_unavailable", "Account storage is not configured.");

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const session = await sessionContext(request, env);
    if (!session) return json({ authenticated: false });
    return json({
      authenticated: true,
      user: session.user,
      workspace: session.defaultWorkspace,
      workspaces: session.workspaces,
    });
  }

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    assertSafeMutation(request);
    const result = await signup(request, env, await readJson(request, 5000));
    if (!result.ok) return errorResponse(result.status, result.code, result.message, result.details);
    return json(
      {
        authenticated: true,
        user: result.user,
        workspace: result.workspace,
        claimedDemo: result.claimedDemo,
      },
      { status: result.status, headers: { "set-cookie": result.cookie } },
    );
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    assertSafeMutation(request);
    const result = await login(request, env, await readJson(request, 3000));
    if (!result.ok) return errorResponse(result.status, result.code, result.message, result.details);
    return json(
      {
        authenticated: true,
        user: result.user,
        workspace: result.workspace,
        workspaces: result.workspaces,
      },
      { headers: { "set-cookie": result.cookie } },
    );
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    assertSafeMutation(request);
    const cookie = await logout(request, env);
    return json({ authenticated: false }, { headers: { "set-cookie": cookie } });
  }

  return errorResponse(404, "not_found", "Authentication route not found.");
}

async function api(request, env) {
  const url = new URL(request.url);
  const parts = pathParts(url.pathname);

  if (url.pathname === "/api/health" && request.method === "GET") {
    let authReady = false;
    if (env.AUTH_DB) {
      try {
        const schema = await env.AUTH_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1").first();
        authReady = Boolean(schema);
      } catch {
        authReady = false;
      }
    }
    return json({
      ok: true,
      service: "incidentops-ai",
      model: env.MODEL_ID || MODEL_ID_DEFAULT,
      auth: authReady,
      timestamp: new Date().toISOString(),
    });
  }

  if (url.pathname.startsWith("/api/auth/")) {
    return authApi(request, env, url);
  }

  if (url.pathname === "/api/workspaces" && request.method === "POST") {
    assertSafeMutation(request);
    const session = await sessionContext(request, env);
    if (session?.defaultWorkspace) {
      return json({ workspaceId: session.defaultWorkspace.id, mode: "account" }, { status: 200 });
    }
    return json({ workspaceId: crypto.randomUUID(), mode: "demo" }, { status: 201 });
  }

  const context = await resolveWorkspaceContext(request, env);
  const { workspaceId, viewer } = context;
  const store = storeFor(env, workspaceId);

  if (url.pathname === "/api/bootstrap" && request.method === "GET") {
    const incidents = await store.listIncidents(60);
    return json({
      workspaceId,
      viewer,
      incidents,
      limits: { maxIncidents: 200, logCharacters: 16000 },
    });
  }

  if (url.pathname === "/api/incidents" && request.method === "POST") {
    return createIncident(request, env, workspaceId);
  }

  if (parts[0] === "api" && parts[1] === "incidents" && parts[2]) {
    const incidentId = parts[2];
    if (parts.length === 3 && request.method === "GET") {
      const incident = await store.getIncident(incidentId);
      return incident
        ? json({ incident })
        : errorResponse(404, "incident_not_found", "Incident not found in this workspace.");
    }
    if (parts[3] === "chat" && request.method === "POST") {
      return incidentChat(request, env, workspaceId, incidentId);
    }
    if (parts[3] === "status" && request.method === "POST") {
      return updateStatus(request, env, workspaceId, incidentId);
    }
    if (parts[3] === "workflow" && request.method === "GET") {
      const incident = await store.getIncident(incidentId);
      if (!incident) return errorResponse(404, "incident_not_found", "Incident not found in this workspace.");
      if (!incident.workflowId) return json({ status: { status: "unknown" } });
      const instance = await env.INCIDENT_WORKFLOW.get(incident.workflowId);
      return json({ status: await instance.status() });
    }
  }

  return errorResponse(404, "not_found", "API route not found.");
}

function applySecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("x-frame-options", "DENY");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  );
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("cache-control", "no-cache");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      const asset = await env.ASSETS.fetch(request);
      return applySecurityHeaders(asset);
    } catch (error) {
      console.error("request_failed", {
        message: String(error?.message || error),
        path: new URL(request.url).pathname,
      });
      const status = Number(error?.status) || 500;
      const code = error?.code || "internal_error";
      const message = status >= 500 ? "Something went wrong while processing the request." : String(error?.message || error);
      return errorResponse(status, code, message);
    }
  },
};
