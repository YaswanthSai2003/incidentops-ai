# AI-assisted development prompt history

Cloudflare's assignment explicitly allows AI-assisted coding and asks candidates to submit prompt history. This file records the material prompts and refinement constraints used to produce this repository. It is intentionally concise: repeated conversational confirmations and unrelated application discussion are omitted, while prompts that changed scope, architecture, code, safety, or polish are retained.

## Prompt 1 — Understand the optional assignment

**User intent**

> Review the Cloudflare Software Engineer role and optional assignment. The application should include an LLM, workflow/coordination, user input, and memory/state. I want to complete the optional assignment rather than submit a generic project.

**Resulting direction**

- Build an infrastructure-oriented project rather than a generic chatbot.
- Align the application with the role's backend/platform/reliability focus.
- Use Cloudflare-native primitives.

## Prompt 2 — Project concept

**User intent**

> Build something that will be relevant to Cloudflare and impressive for the Software Engineer role.

**Resulting direction**

- Concept: **IncidentOps AI**, an infrastructure incident triage application.
- Input: incident description + focused log excerpt.
- Output: severity, likely cause, evidence, prioritized remediation, verification, rollback, escalation.
- Durable incident memory and incident-scoped copilot.

## Prompt 3 — One-pass deliverable

**User intent**

> Complete the project in one go and give one full zip after locking requirements. I should only need to configure account/environment values and deploy.

**Resulting direction**

- Self-contained repository.
- Deployment and reviewer documentation included.
- No hidden external service dependency.
- Full submission structure in the repository rather than isolated snippets.

## Prompt 4 — Free-plan constraint

**User intent**

> Totally using free version?

**Resulting direction**

- No OpenAI/Anthropic/external paid API.
- Workers AI binding for inference.
- Cloudflare Workflows for durable coordination.
- SQLite-backed Durable Objects for memory/state.
- Static Assets + Worker for the full-stack application.
- Document current free allowances and warn that quotas can change / may already be consumed.

## Prompt 5 — Production-level quality

**User prompt**

> Take the time you need, it's for cloudflare company and it needs utmost perfection with no errors and need to be production level with no bugs in frontend or backend and it needs to be perfectly planned from start to finish nd ui should be responsive right and this should be considered with utmost care. They need to be impressed.

**Resulting refinements**

- Evidence-first deterministic signal extraction before LLM inference.
- Workers AI JSON schema output plus independent coercion/bounds.
- Durable Workflow retries and deterministic fallback.
- Server-side validation, request bounds, secret redaction, same-origin mutation checks.
- Browser security headers and no external UI/font/analytics CDN.
- Workspace-scoped Durable Object instead of global singleton state.
- Bounded incident and chat history.
- Explicit failure states and audit timeline.
- Human-reviewed remediation only; no infrastructure mutation tools.
- Desktop/tablet/mobile UI with loading, empty, processing, error, and complete states.
- Keyboard focus and reduced-motion behavior.
- Unit tests, structure validation, CI, deployment checklist, security notes, architecture, reviewer guide.

## Prompt 6 — Final hardening pass

**Engineering refinement prompt**

> Prefer the simplest architecture that still demonstrates Cloudflare primitives clearly. Reduce dependency/build risk, make failure behavior explicit, and ensure the repository can be reviewed without needing framework-specific knowledge.

**Resulting refinements**

- Removed unnecessary runtime framework dependencies.
- Frontend ships as static standards-based HTML/CSS/ES modules.
- Domain logic is dependency-free and testable with Node's built-in test runner.
- Wrangler is the only development/deployment tool required.
- Added a two-minute reviewer path and precise known-limitations documentation.

## Prompt 7 — Final UI/UX refinement

**User prompt**

> The deployed application works, but the UI can be much better. It is dark-mode only, the hamburger/menu control should also work on laptop, and responsiveness feels closer to 80% than fully polished.

**Resulting refinements**

- Added a first-class light/dark theme toggle with persisted preference and system-theme default.
- Added a desktop navigation collapse/restore control instead of limiting the menu control to phones.
- Reworked mobile navigation with an explicit accessible backdrop and close control.
- Improved tablet and narrow-laptop breakpoints, content widths, metric wrapping, action layouts, dialog sizing, and signal visualization behavior.
- Refined card depth, spacing, typography hierarchy, theme contrast, and the incident-copilot treatment while preserving the Cloudflare-inspired restrained visual language.
- Kept the frontend dependency-free and added validation assertions for theme and navigation controls.

## Runtime prompts

The prompts actually sent to Workers AI are committed in source code rather than copied here so reviewers can inspect the exact implementation:

- Investigation prompt: `worker/workflow.js` → `buildPrompt()` and the `AI.run()` system message.
- Incident copilot prompt: `worker/index.js` → `incidentChat()`.

## Human review

AI-generated code and documentation were reviewed for architecture consistency, input/output bounds, error handling, Cloudflare API alignment, and submission transparency. The repository does not claim that AI recommendations are authoritative or that incident remediation is executed automatically.

### UI refinement: sticky right rail behavior
**Prompt/context:** Review screenshots where the Incident Memory card scrolled underneath the sticky Incident Copilot card and appeared to overlap/disappear.

**Implementation:** Reworked the secondary dashboard column into a single sticky `right-rail` container so Copilot and Incident Memory move as one unit on wide desktop layouts. Removed card-level sticky positioning from Copilot and disabled right-rail stickiness once the dashboard collapses to a single column. This preserves card order, prevents hidden headers/content, and keeps responsive behavior predictable.


## Prompt 8 — Cross-device durable workspace

**User prompt/context**

> Creating an incident on mobile did not make it appear on desktop, and clearing browser site data made the incident appear to disappear. There is no login, so how should the workspace ID work? Provide the full corrected version.

**Resulting refinements**

- Identified that incident records were durable server-side, but the pointer to the Durable Object was browser-local.
- Added a same-origin `POST /api/workspaces` endpoint that issues a cryptographically random UUID without creating a fake user account.
- Moved the durable workspace pointer into a shareable `#w=<uuid>` URL fragment, with localStorage retained only as a convenience/migration fallback.
- Added automatic migration from the previous `incidentops.workspace.v1` browser pointer so existing deployed workspace state remains reachable after upgrade.
- Added **Share workspace** UI and a compact sidebar workspace indicator.
- Opening the same workspace link on another device now reaches the same SQLite-backed Durable Object and therefore the same incidents, timeline, related-incident memory, and copilot history.
- Documented the security model explicitly: the workspace link is a bearer-style demo capability, not authentication. A production version would replace it with verified user/organization identity and authorization.

## Prompt 9 — Account-backed cross-device identity

**User prompt/context**

> Since we have SQL database why don't we use login, signup etc. Which is effective? We need to satisfy the requirements. Go ahead.

**Resulting refinements**

- Kept zero-friction reviewer demo mode so Cloudflare reviewers do not need an account to evaluate the assignment.
- Added a Cloudflare D1 binding dedicated to shared identity/index data.
- Added versioned D1 migration for `users`, `workspaces`, `memberships`, `sessions`, and auth rate-limit state.
- Added signup, login, logout, and session restoration endpoints.
- Added PBKDF2-SHA256 password derivation with unique random salt.
- Added random session tokens while persisting only SHA-256 token hashes in D1.
- Added `HttpOnly`, `Secure` (HTTPS), `SameSite=Lax` session cookies and bounded session lifetime/count.
- Added D1-backed login/signup throttling and generic login failure responses.
- Added server-side membership authorization so a claimed account workspace cannot be opened anonymously with its old demo bearer link.
- Signup claims the current demo workspace when possible, preserving its existing Durable Object incidents/timeline/Copilot history instead of creating an empty replacement.
- Added responsive sign-in/signup UI and explicit account/demo state indicators.
- Kept operational incident evidence in Durable Object SQLite rather than copying it into D1; D1 answers identity/authorization while the Durable Object owns workspace state.
- Added authentication unit tests, migration validation, deployment instructions, security documentation, and reviewer/account smoke-test paths.
