import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema (via libsql). JSON columns are TEXT holding serialized JSON;
 * the repository is the only place that (de)serializes them.
 *
 * The DDL that creates these tables lives in `client.ts` (`SCHEMA_DDL`) and
 * runs idempotently at process boot, so a fresh clone works with zero setup.
 */

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sessionId: text("session_id").notNull(),
    cwd: text("cwd"),
    mission: text("mission"),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    updatedAt: text("updated_at").notNull(),
    phase: text("phase"),
    sessionVerdictJson: text("session_verdict_json"),
    usageJson: text("usage_json"),
  },
  (t) => [index("runs_updated_at_idx").on(t.updatedAt)],
);

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentType: text("agent_type").notNull(),
    parentAgentId: text("parent_agent_id"),
    mission: text("mission"),
    description: text("description"),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("agents_run_id_idx").on(t.runId)],
);

export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    toolUseId: text("tool_use_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolKind: text("tool_kind").notNull(),
    inputJson: text("input_json").notNull(),
    inputSummary: text("input_summary").notNull(),
    mcpServerJson: text("mcp_server_json"),
    proposedAt: text("proposed_at").notNull(),
    completedAt: text("completed_at"),
    outcome: text("outcome"),
    resultPreview: text("result_preview"),
    error: text("error"),
    assessmentJson: text("assessment_json"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("actions_run_id_idx").on(t.runId),
    index("actions_run_agent_idx").on(t.runId, t.agentId),
  ],
);

/** Small key-value store for connector bookkeeping (last sync times, cursors). */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
