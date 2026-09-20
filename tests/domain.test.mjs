import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackAssessment,
  coerceAssessment,
  extractSignals,
  normalizeChatMessage,
  normalizeIncidentInput,
  rankRelatedIncidents,
  redactSecrets,
} from "../worker/domain.js";

test("incident input is normalized and secrets are redacted before persistence", () => {
  const result = normalizeIncidentInput({
    title: "  API failure after deploy  ",
    service: " checkout-api ",
    environment: "PRODUCTION",
    description: "Requests fail with token=super-secret-value-123456",
    logs: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.title, "API failure after deploy");
  assert.equal(result.data.environment, "production");
  assert.match(result.data.description, /\[REDACTED\]/);
  assert.match(result.data.logs, /\[REDACTED_TOKEN\]/);
  assert.doesNotMatch(result.data.logs, /abcdefghijklmnopqrstuvwxyz123456/);
});

test("input validation rejects weak incident payloads", () => {
  const result = normalizeIncidentInput({
    title: "x",
    service: "",
    environment: "prod",
    description: "tiny",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.title);
  assert.ok(result.errors.service);
  assert.ok(result.errors.environment);
  assert.ok(result.errors.description);
});

test("redaction covers credential-bearing database URLs and common API tokens", () => {
  const value = redactSecrets(
    "postgresql://admin:verysecretpassword@db.example.com/app sk-abcdefghijklmnopqrstuvwxyz123456 api_key=abcdef1234567890",
  );
  assert.match(value, /\[REDACTED_USER\]/);
  assert.match(value, /\[REDACTED_PASSWORD\]/);
  assert.match(value, /\[REDACTED_API_TOKEN\]/);
  assert.match(value, /api_key=\[REDACTED\]/);
  assert.doesNotMatch(value, /verysecretpassword/);
});

test("deterministic signals identify deploy + 503 + timeout evidence", () => {
  const incident = {
    description: "503 errors started immediately after deployment",
    logs: "ERROR 503 service unavailable\nWARN upstream timeout after 3000ms\nINFO deploy version=v2.1",
  };
  const signals = extractSignals(incident);
  const ids = new Set(signals.map((signal) => signal.id));
  assert.ok(ids.has("http_5xx"));
  assert.ok(ids.has("timeout"));
  assert.ok(ids.has("deployment"));
  assert.ok(signals.every((signal) => signal.count > 0));
});

test("fallback assessment is conservative and complete", () => {
  const incident = {
    title: "Production checkout outage",
    service: "checkout-api",
    description: "All users see service unavailable errors",
    logs: "503 service unavailable\n503 service unavailable\nupstream timeout",
  };
  const signals = extractSignals(incident);
  const assessment = buildFallbackAssessment(incident, signals, []);
  assert.ok(["critical", "high"].includes(assessment.severity));
  assert.ok(assessment.summary.length > 20);
  assert.ok(assessment.actions.length >= 3);
  assert.ok(assessment.verification.length >= 2);
  assert.equal(assessment.source, "deterministic-fallback");
});

test("model output is bounded and confidence is clamped", () => {
  const incident = { title: "Timeout", description: "timeouts", logs: "timeout" };
  const signals = extractSignals(incident);
  const assessment = coerceAssessment(
    {
      severity: "high",
      category: "Dependency / Upstream",
      confidence: 4.2,
      summary: "Likely dependency regression",
      likelyCause: "An upstream may be slow",
      evidence: ["timeout in supplied log"],
      actions: ["Check upstream health"],
      verification: ["Verify latency recovers"],
      rollback: "Use tested rollback if correlated",
      escalation: "Escalate if impact continues",
      memoryNote: "No related incident",
    },
    incident,
    signals,
    [],
  );

  assert.equal(assessment.confidence, 1);
  assert.equal(assessment.severity, "high");
  assert.equal(assessment.category, "dependency-upstream");
  assert.equal(assessment.source, "workers-ai");
});

test("related incident ranking rewards service and signal overlap", () => {
  const target = { id: "current", service: "orders", environment: "production" };
  const signals = [{ id: "database" }, { id: "timeout" }];
  const candidates = [
    {
      id: "a",
      service: "orders",
      environment: "production",
      signals: [{ id: "database" }],
      updatedAt: "2026-09-19T10:00:00Z",
    },
    {
      id: "b",
      service: "billing",
      environment: "production",
      signals: [{ id: "timeout" }],
      updatedAt: "2026-09-20T10:00:00Z",
    },
  ];
  const ranked = rankRelatedIncidents(target, candidates, signals);
  assert.equal(ranked[0].id, "a");
  assert.ok(ranked[0].matchScore > ranked[1].matchScore);
});

test("chat messages are bounded and secret-redacted", () => {
  const result = normalizeChatMessage("Can you inspect password=my-secret-password and suggest next step?");
  assert.equal(result.ok, true);
  assert.match(result.content, /password=\[REDACTED\]/);
  assert.doesNotMatch(result.content, /my-secret-password/);
});

test("oversized incident fields are rejected instead of silently persisted", () => {
  const result = normalizeIncidentInput({
    title: "A".repeat(101),
    service: "checkout-api",
    environment: "production",
    description: "A valid incident description.",
    logs: "x".repeat(16001),
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.title, /under 100/);
  assert.match(result.errors.logs, /under 16000/);
});

test("model output is secret-redacted before it can be persisted", () => {
  const incident = {
    title: "API errors",
    service: "gateway",
    environment: "production",
    description: "Requests are failing after a change",
    logs: "503 service unavailable",
  };
  const signals = extractSignals(incident);
  const assessment = coerceAssessment(
    {
      severity: "high",
      category: "application",
      confidence: 0.8,
      summary: "Observed token=super-secret-token-123456 in evidence",
      likelyCause: "Possible regression",
      evidence: ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"],
      actions: ["Check api_key=abcdef1234567890"],
      verification: ["Verify 5xx rate recovers"],
      rollback: "Use the tested rollback",
      escalation: "Escalate if impact continues",
      memoryNote: "No match",
    },
    incident,
    signals,
    [],
  );

  assert.match(assessment.summary, /\[REDACTED\]/);
  assert.match(assessment.evidence[0], /\[REDACTED_TOKEN\]/);
  assert.match(assessment.actions[0], /api_key=\[REDACTED\]/);
});
