# Security model

IncidentOps AI is a public engineering demo with a deliberately narrow trust model. It is designed to show secure defaults around identity, incident evidence, LLM use, and durable state without pretending to be a complete enterprise IAM product.

## Account security

Account metadata is stored in Cloudflare D1.

- Emails are normalized before lookup.
- Passwords are never stored in plaintext.
- Passwords are derived with PBKDF2-SHA256 using a unique random 128-bit salt.
- Session tokens are cryptographically random.
- Only SHA-256 hashes of session tokens are stored in D1.
- Production session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to `/`.
- Sessions expire after seven days and active sessions are bounded per user.
- Login returns the same error for an unknown email and an incorrect password.
- Signup/login attempts are throttled in D1 using hashed request buckets.
- Account workspace access is authorized against the membership table on the server.
- Once a demo workspace is claimed by an account, the old bearer link alone no longer authorizes it.

The assignment does not include email verification, password reset, MFA, or SSO. Those require additional identity or delivery services and should be added before treating this as a general-purpose consumer identity system.

## Demo workspace security

Demo mode intentionally has no user identity. A random UUID in `#w=<uuid>` is a possession-based capability. The URL fragment is not automatically sent in HTTP requests/referrer headers; frontend JavaScript reads it and explicitly sends the UUID to the same-origin API.

Anyone who receives the full demo workspace link can access that demo workspace until it is claimed by an account. Do not place real customer data or production secrets into demo mode.

## Incident input

All mutation input is considered untrusted.

- JSON request sizes are bounded.
- Incident fields have server-side length/enum validation.
- Common passwords, tokens, private keys, credential-bearing database URLs, GitHub tokens, AWS access-key patterns, and API tokens are redacted before persistence/inference.
- Chat input is independently bounded and redacted.
- Oversized payloads are rejected rather than silently truncated into misleading incident context.

Secret redaction is defense-in-depth; it is not a substitute for data classification or upstream secret scanning.

## Browser/request controls

- Cross-origin/cross-site mutations are rejected.
- Static content receives a restrictive Content Security Policy.
- `X-Frame-Options: DENY` prevents framing.
- `X-Content-Type-Options: nosniff` is enabled.
- Permissions Policy disables camera, microphone, geolocation, and payment APIs.
- COOP/CORP restrict cross-origin interaction.
- Referrer policy is `strict-origin-when-cross-origin`.
- No third-party scripts, fonts, analytics, or UI CDNs execute in the page.

## LLM safety boundary

Workers AI is not authoritative.

- Incident/log fields are explicitly treated as untrusted evidence, not instructions.
- Deterministic signals are extracted before inference.
- Workflow output is requested through a JSON schema.
- Model output is bounded/coerced before persistence.
- A deterministic fallback exists if the model fails.
- The app never claims to have executed production remediation.
- No shell, deployment, cloud-control, or credential tool is exposed to the model.

## Persistence separation

D1 stores identity/index data only. Incident descriptions, logs, AI assessments, timeline entries, and Copilot conversations stay in workspace-local Durable Object SQLite storage.

This minimizes the amount of operational evidence copied into global account storage and makes the ownership boundary explicit.

## Remaining risks / production extensions

A commercial deployment should add, depending on threat model:

- verified-email or enterprise SSO identity;
- MFA / passkeys;
- password reset and account recovery;
- session-management UI and device revocation;
- stronger credential-stuffing protection / Turnstile where appropriate;
- organization invites and RBAC beyond `owner/member`;
- structured audit logging for identity events;
- data retention controls and deletion workflows;
- policy-approved external infrastructure actions with explicit approvals;
- security review of password work factor against the selected Workers plan CPU budget.
