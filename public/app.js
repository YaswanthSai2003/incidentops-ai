const state = {
  workspaceId: null,
  auth: { authenticated: false, user: null, workspace: null, workspaces: [] },
  incidents: [],
  selectedId: null,
  selected: null,
  loading: true,
  health: true,
  search: "",
  filter: "all",
  sidebarOpen: false,
  sidebarCollapsed: getSidebarCollapsed(),
  theme: getThemePreference(),
  chatBusy: false,
  createBusy: false,
  pollTimer: null,
};

const SCENARIOS = {
  deploy: {
    title: "Checkout API returning 503 after rollout",
    service: "checkout-api",
    environment: "production",
    description:
      "Customers are receiving intermittent 503 responses from checkout. Error rate started within minutes of release v2.18.4. The previous release was stable.",
    logs: `2026-09-20T10:42:11Z INFO deploy version=v2.18.4 status=complete\n2026-09-20T10:44:02Z ERROR upstream returned 503 path=/v1/checkout request_id=req-demo-01\n2026-09-20T10:44:03Z WARN upstream timeout after 3000ms path=/v1/checkout\n2026-09-20T10:44:05Z ERROR 503 service unavailable path=/v1/checkout`,
  },
  database: {
    title: "Orders API latency and database connection failures",
    service: "orders-api",
    environment: "production",
    description:
      "Order creation latency increased sharply and some requests are failing. No infrastructure changes were planned, but traffic is above the normal morning baseline.",
    logs: `2026-09-20T09:18:10Z WARN connection pool exhausted active=40 idle=0 waiting=27\n2026-09-20T09:18:11Z ERROR database connection timeout after 2000ms\n2026-09-20T09:18:13Z ERROR SQLSTATE 53300 too many connections\n2026-09-20T09:18:15Z WARN request timeout path=/orders/create duration_ms=5024`,
  },
  traffic: {
    title: "Public API rate-limit spike",
    service: "public-gateway",
    environment: "production",
    description:
      "A subset of API clients is receiving 429 responses and retry volume is increasing. We need to determine whether client retries are amplifying the incident.",
    logs: `2026-09-20T11:02:01Z WARN 429 too many requests route=/v2/search client=demo-a\n2026-09-20T11:02:02Z WARN rate-limit exceeded route=/v2/search current=1280 limit=1000\n2026-09-20T11:02:03Z WARN retry attempt=4 backoff_ms=50\n2026-09-20T11:02:04Z WARN 429 too many requests route=/v2/search client=demo-a`,
  },
};


function getThemePreference() {
  try {
    const saved = localStorage.getItem("incidentops.theme.v1");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getSidebarCollapsed() {
  try {
    return localStorage.getItem("incidentops.sidebar.collapsed.v1") === "true";
  } catch {
    return false;
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#09090b" : "#f6f7f9");
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("incidentops.theme.v1", state.theme); } catch {}
  applyTheme(state.theme);
  renderShell();
}

function toggleNavigation() {
  if (matchMedia("(max-width: 760px)").matches) {
    state.sidebarOpen = !state.sidebarOpen;
  } else {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    try { localStorage.setItem("incidentops.sidebar.collapsed.v1", String(state.sidebarCollapsed)); } catch {}
  }
  renderShell();
}

const WORKSPACE_STORAGE_KEY = "incidentops.workspace.v2";
const LEGACY_WORKSPACE_STORAGE_KEY = "incidentops.workspace.v1";
const WORKSPACE_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function normalizeWorkspaceId(value) {
  const id = String(value || "").trim().toLowerCase();
  return WORKSPACE_PATTERN.test(id) ? id : null;
}

function workspaceIdFromHash() {
  try {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return normalizeWorkspaceId(params.get("w"));
  } catch {
    return null;
  }
}

function persistWorkspacePointer(workspaceId) {
  const id = normalizeWorkspaceId(workspaceId);
  if (!id) return;
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
  } catch {}

  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.set("w", id);
  url.hash = hash.toString();
  history.replaceState(null, "", url);
}

function clearWorkspacePointer() {
  try {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
  } catch {}
  const url = new URL(location.href);
  url.hash = "";
  history.replaceState(null, "", url);
}

async function createWorkspaceId() {
  const response = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Could not create a demo workspace.");
  const workspaceId = normalizeWorkspaceId(data.workspaceId);
  if (!workspaceId) throw new Error("Cloudflare returned an invalid workspace identifier.");
  return workspaceId;
}

async function ensureWorkspaceId() {
  const fromLink = workspaceIdFromHash();
  if (fromLink) {
    persistWorkspacePointer(fromLink);
    return fromLink;
  }

  try {
    const saved = normalizeWorkspaceId(localStorage.getItem(WORKSPACE_STORAGE_KEY));
    const legacy = normalizeWorkspaceId(localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY));
    const existing = saved || legacy;
    if (existing) {
      persistWorkspacePointer(existing);
      return existing;
    }
  } catch {}

  const created = await createWorkspaceId();
  persistWorkspacePointer(created);
  return created;
}

function workspaceShareUrl() {
  if (!state.workspaceId) return location.href;
  const url = new URL(location.href);
  const hash = new URLSearchParams();
  hash.set("w", state.workspaceId);
  url.hash = hash.toString();
  return url.toString();
}

async function copyWorkspaceLink() {
  const link = workspaceShareUrl();
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = link;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  toast("Workspace link copied. Anyone with this link can access this demo workspace.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function apiUrl(path) {
  return path;
}

async function requestJson(path, options = {}, includeWorkspace = false) {
  const headers = new Headers(options.headers || {});
  if (includeWorkspace) {
    if (!state.workspaceId) throw new Error("Workspace is not ready yet.");
    headers.set("x-workspace-id", state.workspaceId);
  }
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(apiUrl(path), { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.error?.code || null;
    error.details = data?.error?.details || null;
    throw error;
  }
  return data;
}

function api(path, options = {}) {
  return requestJson(path, options, true);
}

function publicApi(path, options = {}) {
  return requestJson(path, options, false);
}

function formatAge(iso) {
  if (!iso) return "—";
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return "—";
  const minutes = Math.max(0, Math.round(delta / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function displayStatus(value) {
  return String(value || "unknown").replaceAll("_", " ");
}

function confidence(value) {
  const number = Number(value || 0);
  return number ? `${Math.round(number * 100)}%` : "—";
}

function icon(name) {
  const icons = {
    mark: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7.5h9.1a4.4 4.4 0 0 1 4.1 2.8l.8 2.2H9.4A4.4 4.4 0 0 1 5.2 9.4L5 7.5Z" fill="currentColor"/><path d="M3 14h13.9c1.6 0 3 .9 3.7 2.2H7.3A4.3 4.3 0 0 1 3 14Z" fill="currentColor" opacity=".55"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>`,
    empty: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><path d="M10 12h4M12 10v4"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 15.2A8 8 0 0 1 8.8 4a7.2 7.2 0 1 0 11.2 11.2Z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>`,
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.2 13.8a4 4 0 0 0 5.6 0l2-2a4 4 0 0 0-5.6-5.6l-1.1 1.1"/><path d="M13.8 10.2a4 4 0 0 0-5.6 0l-2 2a4 4 0 0 0 5.6 5.6l1.1-1.1"/></svg>`,
  };
  return icons[name] || "";
}

function toast(message, type = "info") {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  region.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function sidebarIncidents() {
  const query = state.search.trim().toLowerCase();
  return state.incidents.filter((incident) => {
    const matchesQuery = !query || `${incident.title} ${incident.service}`.toLowerCase().includes(query);
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "open" && incident.status !== "resolved") ||
      (state.filter === "resolved" && incident.status === "resolved");
    return matchesQuery && matchesFilter;
  });
}

function renderLoading() {
  document.getElementById("app").innerHTML = `
    <div class="loading-screen">
      <div class="loading-brand"><span class="spinner"></span> Loading durable workspace…</div>
    </div>`;
}

function initials(name) {
  return String(name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";
}

function renderSidebarIdentity() {
  if (state.auth.authenticated && state.auth.user) {
    const workspaceName = state.auth.workspace?.name || "Account workspace";
    return `
      <div class="account-card">
        <span class="account-avatar">${escapeHtml(initials(state.auth.user.name))}</span>
        <div class="account-copy"><strong>${escapeHtml(state.auth.user.name)}</strong><span>${escapeHtml(workspaceName)}</span></div>
        <button class="account-logout" type="button" data-logout aria-label="Sign out" title="Sign out">↗</button>
      </div>`;
  }
  return `
    <div class="workspace-card">
      <div class="workspace-card-copy">
        <span class="workspace-label">DEMO WORKSPACE</span>
        <strong>${escapeHtml(state.workspaceId ? state.workspaceId.slice(0, 8) : "loading")}</strong>
      </div>
      <button class="workspace-copy" type="button" data-copy-workspace aria-label="Copy durable workspace link" title="Copy workspace link">${icon("link")}</button>
    </div>
    <div class="demo-account-actions">
      <button class="button ghost" type="button" data-open-auth="login">Sign in</button>
      <button class="button primary" type="button" data-open-auth="signup">Create account</button>
    </div>`;
}

function renderIdentityBanner() {
  if (state.auth.authenticated && state.auth.user) {
    return `<div class="identity-banner account"><span class="identity-dot"></span><span><strong>Account workspace.</strong> D1 stores account/session metadata while this workspace's incidents and Copilot history remain in its SQLite-backed Durable Object. Sign in on another device to continue here.</span></div>`;
  }
  return `<div class="identity-banner"><span class="identity-dot"></span><span><strong>Reviewer demo mode.</strong> No signup is required. This durable workspace can be shared by link, or create an account to claim it and access the same incident memory after signing in on another device.</span></div>`;
}

function renderShell() {
  const selected = state.selected;
  const incidents = sidebarIncidents();
  document.getElementById("app").innerHTML = `
    <div class="shell ${state.sidebarOpen ? "sidebar-open" : ""} ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}" id="shell">
      <aside class="sidebar" aria-label="Incident navigation">
        <div class="brand">
          <div class="brand-mark">${icon("mark")}</div>
          <div class="brand-copy"><strong>IncidentOps AI</strong><span>Infrastructure intelligence</span></div>
          <button class="icon-button sidebar-close" data-close-sidebar aria-label="Close incident navigation">${icon("close")}</button>
        </div>
        <div class="sidebar-body">
          <button class="new-button" data-new-incident><span aria-hidden="true">＋</span> New investigation</button>
          <div class="search-wrap">
            ${icon("search")}
            <input id="incident-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search incidents" aria-label="Search incidents" />
          </div>
          <div class="sidebar-section-head"><span>INCIDENTS</span><span class="count-pill">${incidents.length}</span></div>
          <div class="incident-list" id="incident-list">
            ${incidents.length ? incidents.map(renderIncidentRow).join("") : `<div class="empty-compact" style="padding:8px 6px">No incidents match this view.</div>`}
          </div>
        </div>
        <div class="sidebar-footer">
          ${renderSidebarIdentity()}
          <div class="platform-card"><span class="cf-dot"></span><span>Cloudflare-native · <strong>Durable by design</strong></span></div>
        </div>
      </aside>
      <button class="nav-backdrop" data-close-sidebar aria-label="Close incident navigation"></button>
      <main class="main">
        <header class="topbar">
          <div class="breadcrumb">
            <button class="icon-button nav-toggle" data-nav-toggle aria-label="Toggle incident navigation" title="Toggle navigation">${icon("menu")}</button>
            <span>IncidentOps</span><span class="slash">/</span><strong>${selected ? escapeHtml(selected.title) : "Overview"}</strong>
          </div>
          <div class="top-actions">
            <button class="icon-button theme-toggle" data-theme-toggle aria-label="Switch to ${state.theme === "dark" ? "light" : "dark"} theme" title="Switch theme">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
            ${state.auth.authenticated
              ? `<div class="account-chip" title="${escapeHtml(state.auth.user?.email || "Signed in")}"><span class="account-dot"></span><span>${escapeHtml(state.auth.user?.name || "Signed in")}</span></div>`
              : `<button class="button workspace-share" type="button" data-copy-workspace title="Copy a link to this durable workspace">${icon("link")}<span>Share workspace</span></button><button class="button ghost" type="button" data-open-auth="login">Sign in</button>`}
            <div class="health-chip ${state.health ? "" : "offline"}"><span class="health-dot"></span><span>${state.health ? "API healthy" : "API unavailable"}</span></div>
            <button class="button" data-new-incident>New incident</button>
          </div>
        </header>
        <div class="content">
          ${renderIdentityBanner()}
          ${selected ? renderIncident(selected) : renderEmpty()}
        </div>
      </main>
    </div>`;
  bindShellEvents();
}

function renderIncidentRow(incident) {
  const severity = incident.severity || "unknown";
  return `<button class="incident-row ${state.selectedId === incident.id ? "active" : ""}" data-select-incident="${escapeHtml(incident.id)}">
    <div class="row-line"><span class="severity-dot ${escapeHtml(severity)}"></span><span class="row-title">${escapeHtml(incident.title)}</span></div>
    <div class="row-meta"><span class="row-service">${escapeHtml(incident.service)} · ${escapeHtml(displayStatus(incident.status))}</span><span>${formatAge(incident.updatedAt)}</span></div>
  </button>`;
}

function renderEmpty() {
  return `<section class="empty-state">
    <div class="empty-inner">
      <div class="empty-icon">${icon("empty")}</div>
      <p class="eyebrow">CLOUDFLARE-NATIVE INCIDENT INTELLIGENCE</p>
      <h1>Turn noisy incident evidence into an auditable investigation.</h1>
      <p>Workers AI proposes a structured assessment, Workflows coordinate durable triage, and SQLite-backed Durable Objects keep incident memory close to the execution path. ${state.auth.authenticated ? "Your D1-backed account maps this workspace back to you across devices." : "Use it immediately in demo mode, or create an account to secure this workspace for cross-device access."}</p>
      <div class="empty-actions">
        <button class="button primary" data-new-incident>Start an investigation</button>
        <button class="button ghost" data-quick-demo="deploy">Load reviewer scenario</button>
        ${state.auth.authenticated ? "" : `<button class="button ghost" data-open-auth="signup">Create account</button>`}
      </div>
    </div>
  </section>`;
}

function renderIncident(incident) {
  const processing = ["queued", "investigating"].includes(incident.status);
  const maxSignal = Math.max(1, ...(incident.signals || []).map((signal) => Number(signal.count || 0)));
  return `
    <section>
      <div class="incident-header">
        <div class="incident-title-wrap">
          <div class="kicker-row">
            <span class="badge ${escapeHtml(incident.severity)}">${escapeHtml(incident.severity || "unknown")}</span>
            <span class="badge ${escapeHtml(incident.status)}">${escapeHtml(displayStatus(incident.status))}</span>
            <span class="eyebrow">${escapeHtml(incident.environment)}</span>
          </div>
          <h1>${escapeHtml(incident.title)}</h1>
          <div class="header-meta"><span>${escapeHtml(incident.service)}</span><span>Created ${formatTime(incident.createdAt)}</span><span>ID ${escapeHtml(incident.id.slice(0, 8))}</span></div>
        </div>
        <div class="header-actions">
          <button class="button ghost" data-export>Export JSON</button>
          ${incident.status !== "resolved" ? `<button class="button danger-soft" data-resolve ${processing ? "disabled" : ""}>Mark resolved</button>` : ""}
        </div>
      </div>

      ${processing ? `<div class="processing-banner"><span class="spinner"></span><span>Durable workflow is investigating this incident. This view refreshes automatically while steps complete.</span></div>` : ""}

      <div class="metrics">
        <div class="metric"><div class="metric-label">Confidence</div><div class="metric-value">${confidence(incident.confidence)}</div><div class="metric-sub">model + evidence fit</div></div>
        <div class="metric"><div class="metric-label">Signals</div><div class="metric-value">${(incident.signals || []).length}</div><div class="metric-sub">deterministic matches</div></div>
        <div class="metric"><div class="metric-label">Category</div><div class="metric-value small">${escapeHtml(incident.category || "Pending triage")}</div><div class="metric-sub">operational domain</div></div>
        <div class="metric"><div class="metric-label">Analysis path</div><div class="metric-value small">${escapeHtml(incident.analysisSource === "workers-ai" ? "Workers AI" : incident.analysisSource === "deterministic-fallback" ? "Safe fallback" : "In progress")}</div><div class="metric-sub">${escapeHtml(incident.modelId ? "Llama 3.3 · structured" : "durable workflow")}</div></div>
      </div>

      <div class="dashboard-grid">
        <div class="stack">
          <article class="card">
            <div class="card-head"><h2>Assessment</h2><span>${escapeHtml(incident.analysisSource || "workflow running")}</span></div>
            <div class="card-body">
              <p class="analysis-summary">${escapeHtml(incident.summary || (processing ? "The workflow is collecting deterministic signals and preparing a structured AI assessment." : "No assessment is available."))}</p>
              <div class="hypothesis"><div class="hypothesis-label">Leading hypothesis</div><p>${escapeHtml(incident.likelyCause || "Pending investigation. IncidentOps will keep hypotheses separate from verified evidence.")}</p></div>
            </div>
          </article>

          <article class="card">
            <div class="card-head"><h2>Observed signals</h2><span>deterministic extraction</span></div>
            <div class="card-body">
              ${(incident.signals || []).length ? `<div class="signal-list">${incident.signals.map((signal) => `<div class="signal-row"><span class="signal-name" title="${escapeHtml(signal.evidence || signal.label)}">${escapeHtml(signal.label)}</span><span class="signal-bar"><span class="signal-fill" style="width:${Math.max(8, Math.round((Number(signal.count || 0) / maxSignal) * 100))}%"></span></span><span class="signal-count">×${Number(signal.count || 0)}</span></div>`).join("")}</div>` : `<div class="empty-compact">No deterministic signal has been persisted yet.</div>`}
            </div>
          </article>

          <article class="card">
            <div class="card-head"><h2>Evidence & action plan</h2><span>human-reviewed remediation</span></div>
            <div class="card-body">
              <section class="plan-section">
                <p class="section-label">Supporting evidence</p>
                ${(incident.evidence || []).length ? `<ul class="plain-list">${incident.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="empty-compact">Evidence will appear after the workflow completes.</p>`}
              </section>
              <section class="plan-section">
                <p class="section-label">Prioritized actions</p>
                ${(incident.actions || []).length ? `<ol class="number-list">${incident.actions.map((item, index) => `<li><span class="num">${index + 1}</span><span>${escapeHtml(item)}</span></li>`).join("")}</ol>` : `<p class="empty-compact">No remediation is suggested before the assessment has evidence.</p>`}
              </section>
              <section class="plan-section">
                <p class="section-label">Verify after change</p>
                ${(incident.verification || []).length ? `<ul class="plain-list">${incident.verification.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="empty-compact">Verification criteria are pending.</p>`}
              </section>
              <div class="guardrail-grid">
                <div class="guardrail"><strong>Rollback</strong><p>${escapeHtml(incident.rollback || "Prefer a reversible mitigation and compare against the last known-good state.")}</p></div>
                <div class="guardrail"><strong>Escalation</strong><p>${escapeHtml(incident.escalation || "Escalate if impact grows or safe mitigation requires privileged production changes.")}</p></div>
              </div>
            </div>
          </article>

          <article class="card">
            <div class="card-head"><h2>Durable timeline</h2><span>${(incident.timeline || []).length} events</span></div>
            <div class="card-body">
              ${(incident.timeline || []).length ? `<div class="timeline">${incident.timeline.map((item) => `<div class="timeline-item"><span class="timeline-node ${escapeHtml(item.type)}"></span><div class="timeline-content"><strong>${escapeHtml(item.message)}</strong><span>${formatTime(item.createdAt)} · ${escapeHtml(item.type)}</span></div></div>`).join("")}</div>` : `<div class="empty-compact">No timeline events yet.</div>`}
            </div>
          </article>

          ${incident.logs ? `<article class="card"><div class="card-head"><h2>Redacted evidence</h2><span>stored after server-side secret filtering</span></div><div class="card-body"><pre class="log-box">${escapeHtml(incident.logs)}</pre></div></article>` : ""}
        </div>

        <aside class="stack right-rail" aria-label="Incident assistance">
          <article class="card copilot-card">
            <div class="card-head"><h2>Incident copilot</h2><span class="copilot-status">durable memory</span></div>
            <div class="chat" id="chat-thread">
              ${(incident.chat || []).length ? incident.chat.map(renderChatMessage).join("") : `<div class="chat-empty">Ask about the evidence, safest next check, rollback criteria, or what would increase confidence in the hypothesis.</div>`}
            </div>
            <form class="chat-form" id="chat-form">
              <textarea name="message" maxlength="1800" rows="1" placeholder="Ask about this incident…" aria-label="Message incident copilot" ${state.chatBusy ? "disabled" : ""}></textarea>
              <button type="submit" aria-label="Send message" ${state.chatBusy ? "disabled" : ""}>${state.chatBusy ? "…" : "↑"}</button>
            </form>
          </article>

          <article class="card">
            <div class="card-head"><h2>Incident memory</h2><span>workspace-local</span></div>
            <div class="card-body">
              <p class="analysis-summary" style="font-size:12px">${escapeHtml(incident.memoryNote || "Resolved incidents with overlapping service and signal patterns are ranked and supplied to the investigation workflow.")}</p>
              ${(incident.related || []).length ? `<ul class="plain-list related-list" style="margin-top:14px">${incident.related.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><br><span style="color:var(--muted-2)">${escapeHtml(item.service)} · match ${Number(item.matchScore || 0)}</span></li>`).join("")}</ul>` : ""}
            </div>
          </article>
        </aside>
      </div>
    </section>`;
}

function renderChatMessage(message) {
  return `<div class="chat-bubble ${message.role === "user" ? "user" : "assistant"}">${escapeHtml(message.content)}<span class="chat-meta">${message.role === "user" ? "You" : "IncidentOps"} · ${formatTime(message.createdAt)}</span></div>`;
}

function bindShellEvents() {
  document.querySelectorAll("[data-new-incident]").forEach((button) => button.addEventListener("click", openIncidentDialog));
  document.querySelectorAll("[data-quick-demo]").forEach((button) =>
    button.addEventListener("click", () => {
      openIncidentDialog();
      applyScenario(button.dataset.quickDemo);
    }),
  );
  document.querySelectorAll("[data-select-incident]").forEach((button) =>
    button.addEventListener("click", () => selectIncident(button.dataset.selectIncident)),
  );
  document.querySelector("[data-nav-toggle]")?.addEventListener("click", toggleNavigation);
  document.querySelectorAll("[data-close-sidebar]").forEach((button) =>
    button.addEventListener("click", () => {
      state.sidebarOpen = false;
      renderShell();
    }),
  );
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", toggleTheme);
  document.querySelectorAll("[data-copy-workspace]").forEach((button) => button.addEventListener("click", copyWorkspaceLink));
  document.querySelectorAll("[data-open-auth]").forEach((button) => button.addEventListener("click", () => openAuthDialog(button.dataset.openAuth || "login")));
  document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", logoutAccount));

  const search = document.getElementById("incident-search");
  search?.addEventListener("input", (event) => {
    const value = event.target.value;
    state.search = value;
    const list = document.getElementById("incident-list");
    if (list) {
      const items = sidebarIncidents();
      list.innerHTML = items.length ? items.map(renderIncidentRow).join("") : `<div class="empty-compact" style="padding:8px 6px">No incidents match this view.</div>`;
      list.querySelectorAll("[data-select-incident]").forEach((button) => button.addEventListener("click", () => selectIncident(button.dataset.selectIncident)));
    }
  });

  document.querySelector("[data-export]")?.addEventListener("click", exportSelected);
  document.querySelector("[data-resolve]")?.addEventListener("click", resolveSelected);
  document.getElementById("chat-form")?.addEventListener("submit", sendChat);

  const thread = document.getElementById("chat-thread");
  if (thread) thread.scrollTop = thread.scrollHeight;
}

async function bootstrap() {
  renderLoading();
  try {
    const session = await publicApi("/api/auth/me");
    state.auth = session.authenticated
      ? { authenticated: true, user: session.user, workspace: session.workspace, workspaces: session.workspaces || [session.workspace].filter(Boolean) }
      : { authenticated: false, user: null, workspace: null, workspaces: [] };

    if (state.auth.authenticated && state.auth.workspace) {
      state.workspaceId = state.auth.workspace.id;
      clearWorkspacePointer();
    } else {
      state.workspaceId = await ensureWorkspaceId();
    }

    const data = await api("/api/bootstrap");
    state.incidents = data.incidents || [];
    state.health = true;
    const preferred = new URL(location.href).searchParams.get("incident");
    const initial = state.incidents.find((item) => item.id === preferred)?.id || state.incidents[0]?.id || null;
    if (initial) await selectIncident(initial, false);
    else { state.selectedId = null; state.selected = null; }
  } catch (error) {
    state.health = false;
    toast(error.message, "error");
    if (error.status === 401) setTimeout(() => openAuthDialog("login"), 0);
  } finally {
    state.loading = false;
    renderShell();
  }
}

async function refreshList() {
  try {
    const data = await api("/api/bootstrap");
    state.incidents = data.incidents || [];
  } catch (error) {
    state.health = false;
  }
}

async function selectIncident(id, shouldRender = true) {
  state.selectedId = id;
  state.sidebarOpen = false;
  if (state.selected?.id !== id) state.selected = null;
  if (shouldRender) renderShell();
  try {
    const data = await api(`/api/incidents/${encodeURIComponent(id)}`);
    state.selected = data.incident;
    state.health = true;
    await refreshList();
    updateUrl(id);
    schedulePoll();
  } catch (error) {
    toast(error.message, "error");
    state.selected = null;
    state.selectedId = null;
  }
  if (shouldRender) renderShell();
}

function updateUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("incident", id);
  else url.searchParams.delete("incident");
  history.replaceState(null, "", url);
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  const incident = state.selected;
  if (!incident || !["queued", "investigating"].includes(incident.status)) return;
  state.pollTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/incidents/${encodeURIComponent(incident.id)}`);
      state.selected = data.incident;
      await refreshList();
      renderShell();
      schedulePoll();
    } catch {
      state.pollTimer = setTimeout(schedulePoll, 3500);
    }
  }, 2200);
}

function openIncidentDialog() {
  const dialog = document.getElementById("incident-dialog");
  if (!dialog.open) dialog.showModal();
  setTimeout(() => dialog.querySelector("input[name='title']")?.focus(), 30);
}

function closeIncidentDialog() {
  const dialog = document.getElementById("incident-dialog");
  if (dialog.open) dialog.close();
}

function applyScenario(key) {
  const scenario = SCENARIOS[key];
  const form = document.getElementById("incident-form");
  if (!scenario || !form) return;
  for (const [field, value] of Object.entries(scenario)) {
    const input = form.elements.namedItem(field);
    if (input) input.value = value;
  }
  clearFormErrors();
}

function clearFormErrors() {
  document.querySelectorAll("[data-error-for]").forEach((element) => (element.textContent = ""));
  document.querySelectorAll("#incident-form [aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
}

function showFormErrors(errors = {}) {
  clearFormErrors();
  for (const [field, message] of Object.entries(errors)) {
    const node = document.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
    const input = document.getElementById("incident-form")?.elements.namedItem(field);
    if (node) node.textContent = message;
    input?.setAttribute("aria-invalid", "true");
  }
}

async function createIncident(event) {
  event.preventDefault();
  if (state.createBusy) return;
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  state.createBusy = true;
  const submit = document.getElementById("create-submit");
  submit.disabled = true;
  submit.querySelector(".button-label").textContent = "Starting workflow…";
  clearFormErrors();
  try {
    const response = await api("/api/incidents", { method: "POST", body: JSON.stringify(data) });
    closeIncidentDialog();
    form.reset();
    toast(response.warning || "Incident saved. Durable investigation started.", response.warning ? "error" : "info");
    await refreshList();
    await selectIncident(response.incident.id);
  } catch (error) {
    if (error.details) showFormErrors(error.details);
    else toast(error.message, "error");
  } finally {
    state.createBusy = false;
    submit.disabled = false;
    submit.querySelector(".button-label").textContent = "Start durable investigation";
  }
}

async function sendChat(event) {
  event.preventDefault();
  if (state.chatBusy || !state.selected) return;
  const form = event.currentTarget;
  const input = form.elements.namedItem("message");
  const message = String(input.value || "").trim();
  if (message.length < 2) return;
  state.chatBusy = true;
  state.selected.chat = [
    ...(state.selected.chat || []),
    { id: `optimistic-${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() },
  ];
  input.value = "";
  renderShell();
  try {
    const response = await api(`/api/incidents/${encodeURIComponent(state.selected.id)}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    const fresh = await api(`/api/incidents/${encodeURIComponent(state.selected.id)}`);
    state.selected = fresh.incident;
  } catch (error) {
    toast(error.message, "error");
    const fresh = await api(`/api/incidents/${encodeURIComponent(state.selected.id)}`).catch(() => null);
    if (fresh) state.selected = fresh.incident;
  } finally {
    state.chatBusy = false;
    renderShell();
  }
}

async function resolveSelected() {
  const incident = state.selected;
  if (!incident || incident.status === "resolved") return;
  const confirmed = confirm("Mark this incident as resolved? This only changes IncidentOps state; it does not touch production infrastructure.");
  if (!confirmed) return;
  try {
    const response = await api(`/api/incidents/${encodeURIComponent(incident.id)}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "resolved", note: "Marked resolved by reviewer." }),
    });
    state.selected = response.incident;
    await refreshList();
    renderShell();
    toast("Incident marked resolved. It can now be used as workspace memory.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function exportSelected() {
  if (!state.selected) return;
  const payload = JSON.stringify(state.selected, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `incident-${state.selected.id.slice(0, 8)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setAuthMode(mode) {
  const selected = mode === "signup" ? "signup" : "login";
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    const active = button.dataset.authTab === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.getElementById("login-form")?.classList.toggle("hidden", selected !== "login");
  document.getElementById("signup-form")?.classList.toggle("hidden", selected !== "signup");
  const title = document.getElementById("auth-title");
  const subtitle = document.getElementById("auth-subtitle");
  if (title) title.textContent = selected === "signup" ? "Create your account" : "Sign in";
  if (subtitle) subtitle.textContent = selected === "signup"
    ? "Claim this demo workspace and make it available after sign-in on any device."
    : "Access your durable incident workspace from any device.";
  clearAuthErrors();
}

function openAuthDialog(mode = "login") {
  const dialog = document.getElementById("auth-dialog");
  if (!dialog) return;
  setAuthMode(mode);
  if (!dialog.open) dialog.showModal();
  const form = document.getElementById(mode === "signup" ? "signup-form" : "login-form");
  setTimeout(() => form?.querySelector("input")?.focus(), 30);
}

function closeAuthDialog() {
  const dialog = document.getElementById("auth-dialog");
  if (dialog?.open) dialog.close();
}

function clearAuthErrors() {
  document.querySelectorAll("[data-auth-error-for]").forEach((element) => (element.textContent = ""));
  document.querySelectorAll("#auth-dialog [aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
}

function showAuthErrors(form, errors = {}) {
  clearAuthErrors();
  for (const [field, message] of Object.entries(errors)) {
    const input = form.elements.namedItem(field);
    const node = input?.closest(".field")?.querySelector(`[data-auth-error-for="${CSS.escape(field)}"]`);
    if (node) node.textContent = message;
    input?.setAttribute("aria-invalid", "true");
  }
}

async function completeAccountTransition(response, message) {
  state.auth = {
    authenticated: true,
    user: response.user,
    workspace: response.workspace,
    workspaces: response.workspaces || [response.workspace].filter(Boolean),
  };
  state.workspaceId = response.workspace.id;
  clearWorkspacePointer();
  closeAuthDialog();
  state.incidents = [];
  state.selected = null;
  state.selectedId = null;
  toast(message);
  await bootstrap();
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  const label = submit?.querySelector(".button-label");
  if (submit?.disabled) return;
  clearAuthErrors();
  if (submit) submit.disabled = true;
  if (label) label.textContent = "Signing in…";
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const response = await publicApi("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    await completeAccountTransition(response, "Signed in. Your durable workspace is ready.");
  } catch (error) {
    if (error.details) showAuthErrors(form, error.details);
    else toast(error.message, "error");
  } finally {
    if (submit) submit.disabled = false;
    if (label) label.textContent = "Sign in securely";
  }
}

async function submitSignup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type='submit']");
  const label = submit?.querySelector(".button-label");
  if (submit?.disabled) return;
  clearAuthErrors();
  if (submit) submit.disabled = true;
  if (label) label.textContent = "Creating account…";
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    if (!state.auth.authenticated && normalizeWorkspaceId(state.workspaceId)) body.claimWorkspaceId = state.workspaceId;
    const response = await publicApi("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    await completeAccountTransition(response, response.claimedDemo ? "Account created. Your existing demo incidents are now secured to this account." : "Account created. Your workspace is ready.");
  } catch (error) {
    if (error.details) showAuthErrors(form, error.details);
    else toast(error.message, "error");
  } finally {
    if (submit) submit.disabled = false;
    if (label) label.textContent = "Create account & secure workspace";
  }
}

async function logoutAccount() {
  const confirmed = confirm("Sign out of IncidentOps AI? Your account workspace and incidents will remain stored on Cloudflare.");
  if (!confirmed) return;
  try {
    await publicApi("/api/auth/logout", { method: "POST", body: "{}" });
    clearTimeout(state.pollTimer);
    state.auth = { authenticated: false, user: null, workspace: null, workspaces: [] };
    state.workspaceId = null;
    state.incidents = [];
    state.selected = null;
    state.selectedId = null;
    clearWorkspacePointer();
    toast("Signed out. A fresh reviewer demo workspace will be created.");
    await bootstrap();
  } catch (error) {
    toast(error.message, "error");
  }
}

function bindDialogEvents() {
  const dialog = document.getElementById("incident-dialog");
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeIncidentDialog));
  document.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", () => applyScenario(button.dataset.scenario)));
  document.getElementById("incident-form")?.addEventListener("submit", createIncident);
  dialog?.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closeIncidentDialog();
  });

  const authDialog = document.getElementById("auth-dialog");
  document.querySelectorAll("[data-close-auth]").forEach((button) => button.addEventListener("click", closeAuthDialog));
  document.querySelectorAll("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authTab)));
  document.getElementById("login-form")?.addEventListener("submit", submitLogin);
  document.getElementById("signup-form")?.addEventListener("submit", submitSignup);
  authDialog?.addEventListener("click", (event) => {
    if (event.target === authDialog) closeAuthDialog();
  });
}

window.addEventListener("hashchange", () => {
  if (state.auth.authenticated) {
    clearWorkspacePointer();
    return;
  }
  const incoming = workspaceIdFromHash();
  if (!incoming || incoming === state.workspaceId) return;
  clearTimeout(state.pollTimer);
  state.workspaceId = incoming;
  state.incidents = [];
  state.selectedId = null;
  state.selected = null;
  state.search = "";
  persistWorkspacePointer(incoming);
  bootstrap();
});

applyTheme(state.theme);
bindDialogEvents();
bootstrap();
