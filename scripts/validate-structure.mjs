import { access, readFile } from "node:fs/promises";

const required = [
  "README.md",
  "wrangler.jsonc",
  "worker/index.js",
  "worker/auth.js",
  "worker/workflow.js",
  "worker/store.js",
  "worker/domain.js",
  "migrations/0001_auth.sql",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "docs/ARCHITECTURE.md",
  "docs/DEPLOYMENT.md",
  "docs/PROMPT_HISTORY.md",
  "docs/SECURITY.md",
  "docs/REVIEWER_GUIDE.md",
  "docs/SUBMISSION_CHECKLIST.md",
];

for (const file of required) await access(file);

const [html, app, css, worker, auth, workflow, wrangler, migration, prompts] = await Promise.all([
  readFile("public/index.html", "utf8"),
  readFile("public/app.js", "utf8"),
  readFile("public/styles.css", "utf8"),
  readFile("worker/index.js", "utf8"),
  readFile("worker/auth.js", "utf8"),
  readFile("worker/workflow.js", "utf8"),
  readFile("wrangler.jsonc", "utf8"),
  readFile("migrations/0001_auth.sql", "utf8"),
  readFile("docs/PROMPT_HISTORY.md", "utf8"),
]);

if (!html.includes('name="viewport"')) throw new Error("Responsive viewport meta tag missing");
if (!html.includes('id="incident-dialog"')) throw new Error("Incident dialog missing");
if (!html.includes('id="auth-dialog"')) throw new Error("Authentication dialog missing");
if (!html.includes('aria-live="assertive"')) throw new Error("Accessible toast region missing");
if (!app.includes("/api/workspaces")) throw new Error("Server-issued demo workspace bootstrap missing");
if (!app.includes('hash.set("w"')) throw new Error("Shareable demo workspace URL fragment missing");
if (!app.includes("copyWorkspaceLink")) throw new Error("Workspace sharing control missing");
if (!app.includes("/api/auth/signup") || !app.includes("/api/auth/login") || !app.includes("/api/auth/logout")) {
  throw new Error("Frontend account lifecycle integration missing");
}
if (!worker.includes('url.pathname === "/api/workspaces"')) throw new Error("Workspace issuance endpoint missing");
if (!worker.includes("workspaceRegistration") || !worker.includes("canAccessWorkspace")) throw new Error("Workspace authorization boundary missing");
if (!worker.includes("content-security-policy")) throw new Error("CSP header missing");
if (!auth.includes("PBKDF2-SHA256")) throw new Error("Password derivation contract missing");
if (!auth.includes("HttpOnly") || !auth.includes("SameSite=Lax")) throw new Error("Secure cookie attributes missing");
if (!auth.includes("token_hash")) throw new Error("Hashed session persistence missing");
if (!migration.includes("CREATE TABLE IF NOT EXISTS users") || !migration.includes("CREATE TABLE IF NOT EXISTS sessions")) {
  throw new Error("D1 auth migration incomplete");
}
if (!app.includes("escapeHtml(")) throw new Error("Frontend escaping helper missing");
if (!css.includes("@media (max-width: 760px)")) throw new Error("Mobile responsive breakpoint missing");
if (!css.includes("prefers-reduced-motion")) throw new Error("Reduced-motion handling missing");
if (!css.includes('html[data-theme="light"]')) throw new Error("Light theme styling missing");
if (!css.includes(".auth-dialog")) throw new Error("Responsive authentication UI styling missing");
if (!app.includes("toggleNavigation")) throw new Error("Desktop/mobile navigation toggle missing");
if (!app.includes("toggleTheme")) throw new Error("Theme toggle missing");
if (!worker.includes("INCIDENT_WORKFLOW.create")) throw new Error("Workflow trigger missing");
if (!workflow.includes("response_format")) throw new Error("Structured Workers AI output missing");
if (!workflow.includes("deterministic fallback")) throw new Error("Fallback workflow step missing");
if (!wrangler.includes('"storage": "sqlite"')) throw new Error("SQLite Durable Object export missing");
if (!wrangler.includes('"binding": "AUTH_DB"')) throw new Error("D1 auth binding missing");
if (!wrangler.includes('"not_found_handling": "single-page-application"')) throw new Error("SPA asset routing missing");
if (!prompts.includes("## Prompt 5 — Production-level quality") || !prompts.includes("## Prompt 9 — Account-backed cross-device identity")) {
  throw new Error("Material AI prompt history missing");
}

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) throw new Error(`Duplicate static HTML ids: ${duplicateIds.join(", ")}`);

console.log(`Structure validation passed (${required.length} required artifacts + auth/responsive/security/submission assertions).`);
