import { DurableObject } from "cloudflare:workers";
import { safeJsonParse } from "./domain.js";

function nowIso() {
  return new Date().toISOString();
}

function rowToIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    service: row.service,
    environment: row.environment,
    description: row.description,
    logs: row.logs,
    status: row.status,
    severity: row.severity,
    category: row.category,
    confidence: Number(row.confidence || 0),
    summary: row.summary || "",
    likelyCause: row.likely_cause || "",
    evidence: safeJsonParse(row.evidence_json, []),
    signals: safeJsonParse(row.signals_json, []),
    actions: safeJsonParse(row.actions_json, []),
    verification: safeJsonParse(row.verification_json, []),
    rollback: row.rollback || "",
    escalation: row.escalation || "",
    memoryNote: row.memory_note || "",
    related: safeJsonParse(row.related_json, []),
    analysisSource: row.analysis_source || "",
    modelId: row.model_id || "",
    workflowId: row.workflow_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class IncidentStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        service TEXT NOT NULL,
        environment TEXT NOT NULL,
        description TEXT NOT NULL,
        logs TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'unknown',
        category TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        likely_cause TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        signals_json TEXT NOT NULL DEFAULT '[]',
        actions_json TEXT NOT NULL DEFAULT '[]',
        verification_json TEXT NOT NULL DEFAULT '[]',
        rollback TEXT NOT NULL DEFAULT '',
        escalation TEXT NOT NULL DEFAULT '',
        memory_note TEXT NOT NULL DEFAULT '',
        related_json TEXT NOT NULL DEFAULT '[]',
        analysis_source TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        workflow_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_updated ON incidents(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
      CREATE TABLE IF NOT EXISTS timeline (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_incident ON timeline(incident_id, seq ASC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_incident ON chat_messages(incident_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS quota_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket TEXT NOT NULL,
        created_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_quota_bucket ON quota_events(bucket, created_ms);
    `);
  }

  async createIncident(incident) {
    const createdAt = incident.createdAt || nowIso();
    this.sql.exec(
      `INSERT INTO incidents (
        id, title, service, environment, description, logs, status, severity,
        category, confidence, created_at, updated_at, workflow_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?, ?)`,
      incident.id,
      incident.title,
      incident.service,
      incident.environment,
      incident.description,
      incident.logs,
      incident.status || "queued",
      incident.severity || "unknown",
      createdAt,
      createdAt,
      incident.workflowId || "",
    );
    await this.appendTimeline(incident.id, "created", "Incident created and queued for durable investigation.", {});
    this.prune();
    return this.getIncident(incident.id);
  }

  async getIncident(id) {
    const rows = this.sql.exec("SELECT * FROM incidents WHERE id = ? LIMIT 1", id).toArray();
    if (!rows.length) return null;
    const incident = rowToIncident(rows[0]);
    incident.timeline = await this.getTimeline(id);
    incident.chat = await this.getChatMessages(id, 30);
    return incident;
  }

  async listIncidents(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    return this.sql
      .exec(
        `SELECT * FROM incidents ORDER BY updated_at DESC LIMIT ?`,
        safeLimit,
      )
      .toArray()
      .map(rowToIncident)
      .map(({ logs, description, ...summary }) => summary);
  }

  async listResolved(limit = 30) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 60));
    return this.sql
      .exec(
        `SELECT * FROM incidents WHERE status = 'resolved' ORDER BY updated_at DESC LIMIT ?`,
        safeLimit,
      )
      .toArray()
      .map(rowToIncident);
  }

  async setWorkflowId(id, workflowId) {
    this.sql.exec("UPDATE incidents SET workflow_id = ?, updated_at = ? WHERE id = ?", workflowId, nowIso(), id);
  }

  async markInvestigating(id, signals) {
    const updatedAt = nowIso();
    this.sql.exec(
      "UPDATE incidents SET status = 'investigating', signals_json = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(signals || []),
      updatedAt,
      id,
    );
    await this.appendTimeline(id, "analysis", "Deterministic signals extracted; AI investigation started.", {
      signalCount: Array.isArray(signals) ? signals.length : 0,
    });
  }

  async completeAnalysis(id, assessment, related, modelId) {
    const updatedAt = nowIso();
    const nextStatus = assessment.severity === "critical" || assessment.severity === "high" ? "needs_attention" : "monitoring";
    this.sql.exec(
      `UPDATE incidents SET
        status = ?, severity = ?, category = ?, confidence = ?, summary = ?, likely_cause = ?,
        evidence_json = ?, actions_json = ?, verification_json = ?, rollback = ?, escalation = ?,
        memory_note = ?, related_json = ?, analysis_source = ?, model_id = ?, updated_at = ?
      WHERE id = ?`,
      nextStatus,
      assessment.severity,
      assessment.category,
      assessment.confidence,
      assessment.summary,
      assessment.likelyCause,
      JSON.stringify(assessment.evidence || []),
      JSON.stringify(assessment.actions || []),
      JSON.stringify(assessment.verification || []),
      assessment.rollback || "",
      assessment.escalation || "",
      assessment.memoryNote || "",
      JSON.stringify(related || []),
      assessment.source || "",
      modelId || "",
      updatedAt,
      id,
    );
    await this.appendTimeline(
      id,
      assessment.source === "workers-ai" ? "ai" : "fallback",
      assessment.source === "workers-ai"
        ? "Workers AI assessment completed and normalized against the application contract."
        : "Workers AI was unavailable; conservative deterministic fallback completed the investigation.",
      { severity: assessment.severity, category: assessment.category, confidence: assessment.confidence },
    );
    return this.getIncident(id);
  }

  async markWorkflowError(id, message) {
    const safeMessage = String(message || "Workflow failed").slice(0, 300);
    this.sql.exec(
      "UPDATE incidents SET status = 'needs_attention', updated_at = ? WHERE id = ?",
      nowIso(),
      id,
    );
    await this.appendTimeline(id, "error", "Investigation workflow reported an error.", { message: safeMessage });
  }

  async updateStatus(id, status, note = "") {
    const allowed = new Set(["needs_attention", "monitoring", "resolved"]);
    if (!allowed.has(status)) throw new Error("Unsupported status transition");
    const exists = this.sql.exec("SELECT id FROM incidents WHERE id = ? LIMIT 1", id).toArray().length;
    if (!exists) return null;
    this.sql.exec("UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?", status, nowIso(), id);
    await this.appendTimeline(id, "human", `Status changed to ${status.replaceAll("_", " ")}.`, {
      note: String(note || "").slice(0, 300),
    });
    return this.getIncident(id);
  }

  async appendTimeline(incidentId, type, message, detail = {}) {
    this.sql.exec(
      "INSERT INTO timeline (incident_id, type, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
      incidentId,
      String(type || "event").slice(0, 32),
      String(message || "Event").slice(0, 500),
      JSON.stringify(detail || {}).slice(0, 2000),
      nowIso(),
    );
    this.sql.exec("UPDATE incidents SET updated_at = ? WHERE id = ?", nowIso(), incidentId);
  }

  async getTimeline(incidentId) {
    return this.sql
      .exec(
        "SELECT seq, type, message, detail_json, created_at FROM timeline WHERE incident_id = ? ORDER BY seq ASC LIMIT 100",
        incidentId,
      )
      .toArray()
      .map((row) => ({
        seq: row.seq,
        type: row.type,
        message: row.message,
        detail: safeJsonParse(row.detail_json, {}),
        createdAt: row.created_at,
      }));
  }

  async addChatMessage(incidentId, role, content) {
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO chat_messages (id, incident_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      incidentId,
      role,
      content,
      nowIso(),
    );
    this.sql.exec(
      `DELETE FROM chat_messages
       WHERE incident_id = ? AND id NOT IN (
         SELECT id FROM chat_messages WHERE incident_id = ? ORDER BY created_at DESC LIMIT 40
       )`,
      incidentId,
      incidentId,
    );
    return { id, incidentId, role, content, createdAt: nowIso() };
  }

  async getChatMessages(incidentId, limit = 20) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 40));
    return this.sql
      .exec(
        `SELECT id, incident_id, role, content, created_at FROM (
          SELECT * FROM chat_messages WHERE incident_id = ? ORDER BY created_at DESC LIMIT ?
        ) ORDER BY created_at ASC`,
        incidentId,
        safeLimit,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        incidentId: row.incident_id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      }));
  }

  async consumeQuota(bucket, limit, windowMs) {
    const now = Date.now();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 1, 100));
    const safeWindow = Math.max(1000, Math.min(Number(windowMs) || 60000, 24 * 60 * 60 * 1000));
    const cutoff = now - safeWindow;
    this.sql.exec("DELETE FROM quota_events WHERE created_ms < ?", cutoff);
    const row = this.sql.exec("SELECT COUNT(*) AS count FROM quota_events WHERE bucket = ? AND created_ms >= ?", bucket, cutoff).one();
    const count = Number(row.count || 0);
    if (count >= safeLimit) {
      return { allowed: false, remaining: 0, retryAfterMs: safeWindow };
    }
    this.sql.exec("INSERT INTO quota_events (bucket, created_ms) VALUES (?, ?)", bucket, now);
    return { allowed: true, remaining: Math.max(0, safeLimit - count - 1), retryAfterMs: 0 };
  }

  prune() {
    this.sql.exec(`
      DELETE FROM incidents
      WHERE id NOT IN (
        SELECT id FROM incidents ORDER BY updated_at DESC LIMIT 200
      )
    `);
    this.sql.exec("DELETE FROM timeline WHERE incident_id NOT IN (SELECT id FROM incidents)");
    this.sql.exec("DELETE FROM chat_messages WHERE incident_id NOT IN (SELECT id FROM incidents)");
  }
}
