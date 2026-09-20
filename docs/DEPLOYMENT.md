# Deployment and verification

## 1. Prerequisites

- Node.js 22+
- npm
- Cloudflare account with Workers enabled
- Wrangler authenticated to the intended account

No external LLM API key is required.

## 2. Quality gate

```bash
npm run check
```

Expected: JavaScript syntax passes, all unit tests pass, and repository validation passes.

## 3. Authenticate Wrangler

```bash
npx --yes wrangler@4.135.0 login
```

If the automatic browser callback is unavailable, Wrangler also supports manual browser/device authentication methods.

## 4. First deployment

```bash
npm run deploy
```

The script does three things:

1. reruns the quality gate;
2. deploys the Worker and lets Wrangler provision the `AUTH_DB` D1 binding if this account does not already have the resource; and
3. applies `migrations/0001_auth.sql` to the remote D1 database.

On the first run, Wrangler may ask you to confirm the migration. Approve it.

After automatic provisioning, Wrangler may write the generated D1 resource details into `wrangler.jsonc`. A D1 database ID is not an application secret, but do not commit Cloudflare API tokens or `.dev.vars`.

## 5. Health check

Open:

```text
https://opsagent.<your-subdomain>.workers.dev/api/health
```

Expected fields include:

- `ok: true`
- `service: incidentops-ai`
- configured model ID
- `auth: true`
- timestamp

## 6. Demo-mode smoke test

1. Open the root URL in a fresh browser.
2. Confirm a demo workspace identifier appears in the sidebar.
3. Use **503 after deploy** to create an incident.
4. Confirm state progresses `queued` → `investigating` → `needs attention` / `monitoring`.
5. Confirm assessment, evidence/action plan, timeline, and Copilot render.
6. Click **Share workspace**.
7. Open the copied URL on a second device/browser.
8. Confirm the same incident appears.

## 7. Account persistence smoke test

Starting from a demo workspace that already contains an incident:

1. Click **Create account**.
2. Register with a test name/email/password.
3. Confirm the UI reports account mode and the existing demo incident is still present.
4. Sign out.
5. Open the application on another device or private browser.
6. Sign in with the same credentials.
7. Confirm the same workspace and incident appear without needing the old `#w=` link.
8. Try opening the old claimed demo link while signed out; the API should require authentication instead of granting bearer access.

## 8. Responsive/UI test

Verify at approximately:

- 1440px desktop;
- 1024px laptop/tablet landscape;
- 768px tablet;
- 390px phone; and
- 320px narrow phone.

Check:

- desktop sidebar collapse/restore;
- mobile drawer/backdrop/close behavior;
- light and dark modes;
- auth dialog on desktop/mobile;
- Evidence & Action Plan alignment;
- right rail (Copilot + Incident Memory) moves as a unit and never overlaps;
- long incident titles/logs do not overflow;
- dialogs remain usable without horizontal scrolling.

## 9. Failure-path check

If Workers AI is unavailable or quota-limited, incident processing should still reach a final usable state through deterministic fallback. The timeline must label that path.

If the Copilot model call fails, the stored-assessment fallback should answer without losing the user message.

## 10. Local development

```bash
npm run dev
```

Workers AI uses a remote binding. D1/Durable Object behavior in local development can differ from deployed resources, so the final identity/persistence smoke test should be run against the deployed `workers.dev` URL.

For a local D1 migration, if needed:

```bash
npx --yes wrangler@4.135.0 d1 migrations apply AUTH_DB --local
```

## 11. Rollback

Use Cloudflare Worker deployment/version history to return to the previous known-good Worker version. Do not delete the Durable Object namespace or D1 database as a rollback mechanism because they own persisted state.
