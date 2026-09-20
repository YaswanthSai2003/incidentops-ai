# Engineering decisions

## Why IncidentOps AI?

The role emphasizes backend systems, APIs, developer platforms, infrastructure operations, reliability, testing, and AI-native problem solving. Incident triage naturally exercises those concerns without pretending to control production infrastructure.

## Why direct Cloudflare primitives instead of a large framework stack?

The interesting part of this assignment is the runtime architecture. A standards-based frontend plus direct Workers/Workflows/Durable Objects/D1/Workers AI keeps the repository small, auditable, and less vulnerable to dependency/version churn.

## Why Durable Objects for incident state?

Incident state is naturally partitioned by workspace. One Durable Object per workspace gives serialized mutation, colocated SQLite state, and a clear lifecycle boundary. A single global object would serialize unrelated reviewers; D1 alone would not demonstrate the same stateful object model.

## Why D1 for accounts?

Authentication needs a shared lookup layer before the Worker knows which workspace Durable Object to address. D1 is a better fit for users, workspace memberships, and sessions than trying to search across Durable Objects.

The split is therefore architectural rather than decorative:

- D1 answers **who is this and which workspace may they access?**
- the Durable Object answers **what is happening inside this workspace?**

## Why keep demo mode after adding authentication?

Requiring a recruiter to register before seeing the assignment creates unnecessary friction. Demo mode proves the core product instantly. Account mode then demonstrates the more realistic cross-device identity path.

Signup can claim the current demo workspace, so the reviewer does not lose work while moving from anonymous to authenticated use.

## Why not store raw sessions?

The browser receives an opaque random session token. Only a SHA-256 digest is stored in D1. If the database contents were exposed, the stored session value is not itself a reusable browser credential.

## Why PBKDF2?

Cloudflare Workers exposes Web Crypto directly. PBKDF2-SHA256 provides a dependency-free password KDF with per-user salt and configurable work factor. The work factor should be reviewed against the deployed Workers plan CPU budget before treating this assignment implementation as an internet-scale identity service.

## Why deterministic signals before the LLM?

Incident triage should separate observable evidence from generated interpretation. Deterministic extraction makes raw indicators visible, improves the prompt, and provides a useful fallback when inference is unavailable.

## Why no infrastructure action tool?

This public demo has no ownership of real services, credentials, or change controls. Adding a fake deploy/rollback tool would reduce trust. Recommendations + explicit verification/rollback criteria show agentic reasoning while preserving human control.

## Why polling instead of WebSockets?

The Workflow changes incident state only a handful of times. Short polling runs only while status is `queued`/`investigating` and then stops. WebSockets would add complexity without improving this focused reviewer flow.
