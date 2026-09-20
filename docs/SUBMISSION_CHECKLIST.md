# Submission checklist

Run this against the final deployed `opsagent` Worker before placing the GitHub URL in the Cloudflare application.

## Repository

- [ ] `npm run check` passes with no failures.
- [ ] No `.env`, `.dev.vars`, API token, password, or credential is committed.
- [ ] `wrangler.jsonc` points to `opsagent` and contains the expected AI, Workflow, Durable Object, D1, and Static Assets bindings.
- [ ] `migrations/0001_auth.sql` is committed.
- [ ] README live demo URL is correct.
- [ ] `docs/PROMPT_HISTORY.md` is included.

## Cloudflare deployment

- [ ] `npm run deploy` completes.
- [ ] Remote D1 migration reports applied/up to date.
- [ ] `/api/health` returns `ok: true` and `auth: true`.
- [ ] No paid third-party API key is configured.

## Demo mode

- [ ] Fresh browser creates a demo workspace.
- [ ] Incident creation works.
- [ ] Workflow reaches a final state.
- [ ] Workers AI path works, or fallback is clearly labeled if model capacity/quota is unavailable.
- [ ] Copilot works.
- [ ] Share workspace link opens the same incident state in another browser/device.

## Account mode

- [ ] Signup validates name/email/password.
- [ ] Signup from an existing demo claims that workspace and preserves its incidents.
- [ ] Duplicate account email is handled cleanly.
- [ ] Logout clears the session.
- [ ] Login with incorrect credentials returns a generic error.
- [ ] Correct login restores the same workspace on another device.
- [ ] Clearing browser storage does not lose an account workspace; signing in restores it.
- [ ] The old `#w=` link for a claimed workspace does not grant anonymous access.

## UI

- [ ] Light mode desktop checked.
- [ ] Dark mode desktop checked.
- [ ] 1024px layout checked.
- [ ] 768px layout checked.
- [ ] ~390px phone checked.
- [ ] ~320px narrow phone checked.
- [ ] Desktop navigation toggle works.
- [ ] Mobile drawer/backdrop/close works.
- [ ] Auth modal is readable and scrollable on mobile.
- [ ] Evidence & Action Plan sections align correctly.
- [ ] Incident Copilot and Incident Memory never overlap.
- [ ] Long titles/logs/chat messages wrap rather than overflow.
- [ ] Keyboard focus is visible.

## Product behavior

- [ ] Mark resolved works only after investigation is complete.
- [ ] Resolved incident can contribute to related-incident memory.
- [ ] JSON export works.
- [ ] Refresh preserves server-side state.
- [ ] No UI claims that remediation was executed.

## Final GitHub/application check

- [ ] Repository is public (if intended for recruiter access).
- [ ] README starts with the live demo and assignment mapping.
- [ ] GitHub contains only the final project, not extracted deployment artifacts.
- [ ] Optional-assignment field receives the repository URL, not the `workers.dev` URL unless the form explicitly asks for a live demo.
