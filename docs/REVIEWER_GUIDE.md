# Reviewer guide

IncidentOps AI is designed to be understandable in a few minutes without requiring account creation.

## Two-minute path

1. Open the live URL.
2. Stay in **Reviewer demo mode**.
3. Click **Load reviewer scenario** or choose **503 after deploy**.
4. Start the durable investigation.
5. Watch the timeline progress through deterministic signal extraction, incident-memory correlation, and Workers AI/fallback analysis.
6. Inspect **Evidence & action plan**, especially verification, rollback, and escalation guidance.
7. Ask the Incident Copilot: `What would increase confidence before rollback?`
8. Resolve the incident and create a similar second one to see workspace-local incident memory become relevant.

## Cross-device state

In demo mode, click **Share workspace** and open the link on another device. Both browsers address the same workspace Durable Object.

## Optional account path

To demonstrate persistent identity rather than a bearer link:

1. Create an incident in demo mode.
2. Choose **Create account**.
3. Signup claims the current demo workspace instead of creating an empty replacement.
4. Sign in from another browser/device.
5. The same incident appears because D1 resolves the account's workspace membership back to the same Durable Object.

D1 stores account/session/index data; the incident evidence and Copilot history remain in Durable Object SQLite.

## What to inspect in the repository

- `worker/workflow.js` — durable orchestration, retry/fallback, Workers AI JSON schema.
- `worker/domain.js` — deterministic signal extraction, secret redaction, output coercion.
- `worker/store.js` — workspace-local SQLite incident/timeline/chat memory.
- `worker/auth.js` — password derivation, hashed sessions, D1 authorization.
- `migrations/0001_auth.sql` — explicit account database schema.
- `worker/index.js` — API boundary, demo/account workspace resolution, security headers.
- `docs/ARCHITECTURE.md` — storage split and trust boundaries.
- `docs/PROMPT_HISTORY.md` — AI-assisted development history requested by the assignment.

## Safety boundary

IncidentOps never changes real infrastructure. It analyzes evidence and proposes human-reviewed next steps, verification, rollback, and escalation criteria.
