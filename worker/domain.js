export const MODEL_ID_DEFAULT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const INCIDENT_STATUSES = Object.freeze([
  "queued",
  "investigating",
  "needs_attention",
  "monitoring",
  "resolved",
]);

export const SEVERITIES = Object.freeze(["critical", "high", "medium", "low", "unknown"]);

const MAX = Object.freeze({
  title: 100,
  service: 60,
  description: 4000,
  logs: 16000,
  chat: 1800,
  action: 280,
  evidence: 240,
});

const SIGNAL_DEFINITIONS = [
  {
    id: "http_5xx",
    label: "HTTP 5xx errors",
    weight: 5,
    patterns: [/\b5\d\d\b/g, /internal server error/gi, /bad gateway/gi, /service unavailable/gi],
  },
  {
    id: "timeout",
    label: "Timeout / latency",
    weight: 4,
    patterns: [/timed?\s*out/gi, /timeout/gi, /deadline exceeded/gi, /latency/gi, /upstream.*slow/gi],
  },
  {
    id: "database",
    label: "Database pressure",
    weight: 4,
    patterns: [/connection pool/gi, /too many connections/gi, /database.*unavailable/gi, /sqlstate/gi, /deadlock/gi, /connection refused.*(?:postgres|mysql|db)/gi],
  },
  {
    id: "resource_pressure",
    label: "Resource pressure",
    weight: 4,
    patterns: [/out of memory/gi, /oom/gi, /memory limit/gi, /cpu.*(?:high|spike|limit)/gi, /heap/gi],
  },
  {
    id: "throttling",
    label: "Throttling / rate limit",
    weight: 3,
    patterns: [/\b429\b/g, /rate.?limit/gi, /throttl/gi, /too many requests/gi],
  },
  {
    id: "dns_tls",
    label: "DNS / TLS",
    weight: 4,
    patterns: [/dns/gi, /nxdomain/gi, /certificate/gi, /tls/gi, /ssl/gi, /handshake/gi],
  },
  {
    id: "auth",
    label: "Authentication / authorization",
    weight: 3,
    patterns: [/\b401\b/g, /\b403\b/g, /unauthorized/gi, /forbidden/gi, /jwt/gi, /permission denied/gi],
  },
  {
    id: "deployment",
    label: "Recent deployment",
    weight: 3,
    patterns: [/deploy(?:ed|ment)?/gi, /release/gi, /rollout/gi, /build\s+[a-f0-9]{6,}/gi, /version\s+v?\d+/gi],
  },
  {
    id: "dependency",
    label: "Dependency / upstream",
    weight: 3,
    patterns: [/upstream/gi, /dependency/gi, /third[- ]party/gi, /connection reset/gi, /econnreset/gi, /econnrefused/gi],
  },
  {
    id: "cache",
    label: "Cache / state",
    weight: 2,
    patterns: [/redis/gi, /cache miss/gi, /cache.*stale/gi, /eviction/gi],
  },
];

const SECRET_PATTERNS = [
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}\b/gi,
    replacement: "$1[REDACTED_TOKEN]",
  },
  {
    pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED_AWS_ACCESS_KEY]",
  },
  {
    pattern: /\b(api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["']?([^\s"',;]{6,})["']?/gi,
    replacement: "$1=[REDACTED]",
  },
  {
    pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^:@/\s]+):([^@/\s]+)@/gi,
    replacement: "$1://[REDACTED_USER]:[REDACTED_PASSWORD]@",
  },
  {
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED_API_TOKEN]",
  },
];

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function boundedString(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\r\n/g, "\n").slice(0, maxLength);
}

export function redactSecrets(value) {
  let text = typeof value === "string" ? value : "";
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function normalizeIncidentInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const raw = {
    title: typeof source.title === "string" ? source.title.trim() : "",
    service: typeof source.service === "string" ? source.service.trim() : "",
    description: typeof source.description === "string" ? source.description.trim() : "",
    logs: typeof source.logs === "string" ? source.logs.trim() : "",
  };
  const data = {
    title: boundedString(raw.title, MAX.title),
    service: boundedString(raw.service, MAX.service),
    environment: boundedString(source.environment, 20).toLowerCase(),
    description: redactSecrets(boundedString(raw.description, MAX.description)),
    logs: redactSecrets(boundedString(raw.logs, MAX.logs)),
  };

  const errors = {};
  if (data.title.length < 4) errors.title = "Use at least 4 characters.";
  else if (raw.title.length > MAX.title) errors.title = `Title must be under ${MAX.title} characters.`;
  if (data.service.length < 2) errors.service = "Service is required.";
  else if (raw.service.length > MAX.service) errors.service = `Service must be under ${MAX.service} characters.`;
  if (!["production", "staging", "development"].includes(data.environment)) {
    errors.environment = "Choose production, staging, or development.";
  }
  if (data.description.length < 10) errors.description = "Add a short incident description.";
  else if (raw.description.length > MAX.description) errors.description = `Description must be under ${MAX.description} characters.`;
  if (raw.logs.length > MAX.logs) errors.logs = `Logs must be under ${MAX.logs} characters.`;
  if (raw.description.length + raw.logs.length > 19000) {
    errors.logs = "Description and logs are too large for a focused triage request.";
  }

  return { ok: Object.keys(errors).length === 0, errors, data };
}

function countMatches(text, patterns) {
  let count = 0;
  for (const regex of patterns) {
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function evidenceForSignal(lines, patterns) {
  for (const line of lines) {
    for (const regex of patterns) {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        return boundedString(line.replace(/\s+/g, " "), MAX.evidence);
      }
    }
  }
  return "";
}

export function extractSignals(incident) {
  const description = redactSecrets(boundedString(incident?.description, MAX.description));
  const logs = redactSecrets(boundedString(incident?.logs, MAX.logs));
  const text = `${description}\n${logs}`;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 500);

  return SIGNAL_DEFINITIONS.map((definition) => {
    const count = countMatches(text, definition.patterns);
    if (!count) return null;
    return {
      id: definition.id,
      label: definition.label,
      count: Math.min(count, 99),
      weight: definition.weight,
      evidence: evidenceForSignal(lines, definition.patterns),
    };
  })
    .filter(Boolean)
    .sort((a, b) => b.weight * b.count - a.weight * a.count)
    .slice(0, 8);
}

function inferCategory(signals) {
  const ids = new Set(signals.map((signal) => signal.id));
  if (ids.has("database")) return "database";
  if (ids.has("dns_tls")) return "network";
  if (ids.has("resource_pressure")) return "capacity";
  if (ids.has("auth")) return "access";
  if (ids.has("throttling")) return "traffic";
  if (ids.has("dependency")) return "dependency";
  if (ids.has("deployment")) return "deployment";
  return "application";
}

function inferSeverity(signals, incident) {
  const combined = `${incident?.title || ""} ${incident?.description || ""}`.toLowerCase();
  const weighted = signals.reduce((sum, signal) => sum + signal.weight * Math.min(signal.count, 4), 0);
  const outageTerms = /outage|all users|100%|unavailable|production down|cannot access/.test(combined);
  const has5xx = signals.some((signal) => signal.id === "http_5xx");
  if (outageTerms && (has5xx || weighted >= 10)) return "critical";
  if (weighted >= 13 || (has5xx && weighted >= 8)) return "high";
  if (weighted >= 6) return "medium";
  return "low";
}

export function buildFallbackAssessment(incident, signals = extractSignals(incident), related = []) {
  const category = inferCategory(signals);
  const severity = inferSeverity(signals, incident);
  const top = signals[0];
  const relatedHint = related.length
    ? `A resolved ${related[0].service || "service"} incident has overlapping signals and should be compared before changing production.`
    : "No strong resolved-incident match was found in this workspace.";

  const actionsByCategory = {
    database: [
      "Check active database connections, pool saturation, and recent query latency before increasing limits.",
      "Compare application connection-pool settings with database capacity and recent deploy changes.",
      "If saturation is confirmed, reduce concurrency or roll back the triggering change before scaling capacity.",
    ],
    network: [
      "Validate DNS resolution and TLS certificate/handshake health from more than one network path.",
      "Compare the first failure timestamp with DNS, certificate, proxy, or routing changes.",
      "Roll back the most recent network configuration change if the failure correlates and validation is safe.",
    ],
    capacity: [
      "Inspect CPU, memory, and request concurrency around the first error spike.",
      "Identify whether a deploy, traffic change, or unbounded workload preceded resource pressure.",
      "Reduce load or roll back the triggering change before increasing resource limits blindly.",
    ],
    traffic: [
      "Check rate-limit counters, retry behavior, and request volume by endpoint/client.",
      "Confirm whether retries are amplifying traffic and apply bounded exponential backoff where appropriate.",
      "Adjust limits only after verifying downstream capacity and abuse controls.",
    ],
    deployment: [
      "Diff the latest deployment against the last known-good release and focus on request-path changes.",
      "Compare error rate and latency immediately before and after the rollout.",
      "Use the existing rollback path if the regression is strongly correlated with the release.",
    ],
    dependency: [
      "Check upstream health, error codes, and timeout/retry behavior before changing local capacity.",
      "Confirm circuit-breaker and retry settings are not multiplying downstream failures.",
      "Degrade gracefully or fail over only through an existing tested path.",
    ],
    access: [
      "Check authentication/authorization error distribution and the latest identity or policy changes.",
      "Validate token expiry, clock skew, signing keys, and role/policy configuration using non-sensitive metadata.",
      "Roll back a recent policy change only after confirming it caused the access regression.",
    ],
    application: [
      "Compare the first failure timestamp with recent code, configuration, and dependency changes.",
      "Inspect representative request traces and isolate the failing code path before making broad changes.",
      "Prefer the smallest reversible mitigation, then verify error rate and latency recover.",
    ],
  };

  return {
    severity,
    category,
    confidence: signals.length ? Math.min(0.78, 0.48 + signals.length * 0.06) : 0.35,
    summary: top
      ? `Deterministic triage found ${top.label.toLowerCase()} as the strongest signal. The assessment is conservative because model analysis was unavailable.`
      : "The supplied evidence did not contain a strong known signal. Start with the incident timeline and recent changes.",
    likelyCause: top
      ? `${top.label} is the leading hypothesis based on the supplied evidence; confirm it with runtime telemetry before remediation.`
      : "Insufficient evidence to identify a likely root cause safely.",
    evidence: signals.slice(0, 4).map((signal) => signal.evidence || `${signal.label}: ${signal.count} match(es)`),
    actions: actionsByCategory[category] || actionsByCategory.application,
    verification: [
      "Confirm the affected request/error metric returns toward its pre-incident baseline.",
      "Run a representative health check or synthetic request after mitigation.",
      "Watch for recurrence for at least one normal traffic cycle before resolving the incident.",
    ],
    rollback: "Use the last known-good deployment/configuration when a recent reversible change strongly correlates with the failure and rollback risk is understood.",
    escalation: severity === "critical" || severity === "high"
      ? "Escalate to the service owner/on-call if impact is ongoing, mitigation is unclear, or the first safe action does not reduce errors."
      : "Escalate if impact grows, the hypothesis cannot be verified, or safe mitigation requires privileged production changes.",
    memoryNote: relatedHint,
    source: "deterministic-fallback",
  };
}

function stringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => redactSecrets(boundedString(item, maxLength)))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function coerceAssessment(value, incident, signals, related = []) {
  const fallback = buildFallbackAssessment(incident, signals, related);
  const source = value && typeof value === "object" ? value : {};
  const severity = SEVERITIES.includes(source.severity) && source.severity !== "unknown" ? source.severity : fallback.severity;
  const category =
    boundedString(source.category, 32, fallback.category)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback.category;

  return {
    severity,
    category,
    confidence: clamp(source.confidence ?? fallback.confidence, 0, 1),
    summary: redactSecrets(boundedString(source.summary, 640, fallback.summary)),
    likelyCause: redactSecrets(boundedString(source.likelyCause, 640, fallback.likelyCause)),
    evidence: stringArray(source.evidence, 6, MAX.evidence).length
      ? stringArray(source.evidence, 6, MAX.evidence)
      : fallback.evidence,
    actions: stringArray(source.actions, 6, MAX.action).length
      ? stringArray(source.actions, 6, MAX.action)
      : fallback.actions,
    verification: stringArray(source.verification, 5, MAX.action).length
      ? stringArray(source.verification, 5, MAX.action)
      : fallback.verification,
    rollback: redactSecrets(boundedString(source.rollback, 480, fallback.rollback)),
    escalation: redactSecrets(boundedString(source.escalation, 480, fallback.escalation)),
    memoryNote: redactSecrets(boundedString(source.memoryNote, 420, fallback.memoryNote)),
    source: "workers-ai",
  };
}

export function normalizeChatMessage(value) {
  const content = redactSecrets(boundedString(value, MAX.chat));
  if (content.length < 2) return { ok: false, error: "Message is too short." };
  return { ok: true, content };
}

export function rankRelatedIncidents(target, candidates, signals = extractSignals(target)) {
  const targetSignalIds = new Set(signals.map((signal) => signal.id));
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && candidate.id !== target?.id)
    .map((candidate) => {
      const candidateSignals = Array.isArray(candidate.signals) ? candidate.signals : [];
      const overlap = candidateSignals.filter((signal) => targetSignalIds.has(signal.id)).length;
      const sameService = candidate.service && target?.service && candidate.service.toLowerCase() === target.service.toLowerCase();
      const sameEnvironment = candidate.environment === target?.environment;
      const score = overlap * 3 + (sameService ? 4 : 0) + (sameEnvironment ? 1 : 0);
      return { ...candidate, matchScore: score };
    })
    .filter((candidate) => candidate.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 3);
}

export function safeJsonParse(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function assessmentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      category: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      likelyCause: { type: "string" },
      evidence: { type: "array", items: { type: "string" }, maxItems: 6 },
      actions: { type: "array", items: { type: "string" }, maxItems: 6 },
      verification: { type: "array", items: { type: "string" }, maxItems: 5 },
      rollback: { type: "string" },
      escalation: { type: "string" },
      memoryNote: { type: "string" },
    },
    required: [
      "severity",
      "category",
      "confidence",
      "summary",
      "likelyCause",
      "evidence",
      "actions",
      "verification",
      "rollback",
      "escalation",
      "memoryNote",
    ],
  };
}
