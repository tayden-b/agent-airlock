import { and, desc, eq, sql } from "drizzle-orm";
import {
  ActionSchema,
  AgentSchema,
  AssessmentSchema,
  RunSchema,
  type Action,
  type Agent,
  type Assessment,
  type McpServerRef,
  type Run,
  type RunSnapshot,
  type RunSummary,
  type Source,
} from "@/contracts";
import { getDb, type AirlockDb } from "./client";
import { actions, agents, runs } from "./schema";

/**
 * The only module that talks to the database. Everything returned is parsed
 * through the domain schemas, so callers always see contract-valid objects.
 *
 * Write semantics are upserts with merge rules per column, because hook
 * events can arrive out of order (a PostToolUse can beat its PreToolUse when
 * Airlock starts mid-session, and agent.mission can beat agent.started).
 */

type RunRow = typeof runs.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type ActionRow = typeof actions.$inferSelect;

function toRun(row: RunRow): Run {
  return RunSchema.parse(row);
}

function toAgent(row: AgentRow): Agent {
  return AgentSchema.parse(row);
}

function parseJsonColumn<T>(json: string | null, parse: (value: unknown) => T): T | null {
  if (json === null) return null;
  try {
    return parse(JSON.parse(json));
  } catch {
    return null;
  }
}

function toAction(row: ActionRow): Action {
  return ActionSchema.parse({
    id: row.id,
    runId: row.runId,
    agentId: row.agentId,
    toolUseId: row.toolUseId,
    toolName: row.toolName,
    toolKind: row.toolKind,
    input: parseJsonColumn(row.inputJson, (v) => v) ?? {},
    inputSummary: row.inputSummary,
    mcpServer: parseJsonColumn<McpServerRef>(row.mcpServerJson, (v) => v as McpServerRef),
    proposedAt: row.proposedAt,
    completedAt: row.completedAt,
    outcome: row.outcome,
    resultPreview: row.resultPreview,
    error: row.error,
    updatedAt: row.updatedAt,
    assessment: parseJsonColumn(row.assessmentJson, (v) => AssessmentSchema.parse(v)),
  });
}

const now = (): string => new Date().toISOString();

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** Inserts a minimal run row if none exists; never touches an existing row. */
export async function ensureRun(params: {
  id: string;
  source: Source;
  sessionId: string;
  at: string;
  cwd?: string;
  db?: AirlockDb;
}): Promise<void> {
  const db = params.db ?? (await getDb());
  await db
    .insert(runs)
    .values({
      id: params.id,
      source: params.source,
      sessionId: params.sessionId,
      cwd: params.cwd ?? null,
      mission: null,
      status: "active",
      startedAt: params.at,
      endedAt: null,
      updatedAt: params.at,
    })
    .onConflictDoNothing();
}

export async function upsertRun(params: {
  id: string;
  source: Source;
  sessionId: string;
  at: string;
  cwd?: string;
  mission?: string;
  status?: "active" | "ended";
  endedAt?: string | null;
  db?: AirlockDb;
}): Promise<Run> {
  const db = params.db ?? (await getDb());
  await ensureRun(params);
  await db
    .update(runs)
    .set({
      ...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
      ...(params.mission !== undefined ? { mission: params.mission } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.endedAt !== undefined ? { endedAt: params.endedAt } : {}),
      updatedAt: now(),
    })
    .where(eq(runs.id, params.id));
  const run = await getRun(params.id, db);
  if (!run) throw new Error(`run disappeared after upsert: ${params.id}`);
  return run;
}

export async function getRun(id: string, db?: AirlockDb): Promise<Run | null> {
  const handle = db ?? (await getDb());
  const rows = await handle.select().from(runs).where(eq(runs.id, id)).limit(1);
  return rows[0] ? toRun(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function ensureAgent(params: {
  id: string;
  runId: string;
  agentId: string;
  agentType: string;
  parentAgentId?: string | null;
  at: string;
  db?: AirlockDb;
}): Promise<void> {
  const db = params.db ?? (await getDb());
  await db
    .insert(agents)
    .values({
      id: params.id,
      runId: params.runId,
      agentId: params.agentId,
      agentType: params.agentType,
      parentAgentId: params.parentAgentId ?? null,
      mission: null,
      description: null,
      status: "running",
      startedAt: params.at,
      endedAt: null,
      updatedAt: params.at,
    })
    .onConflictDoNothing();
}

export async function upsertAgent(params: {
  id: string;
  runId: string;
  agentId: string;
  at: string;
  agentType?: string;
  parentAgentId?: string | null;
  mission?: string;
  description?: string;
  status?: "running" | "completed" | "failed";
  endedAt?: string | null;
  db?: AirlockDb;
}): Promise<Agent> {
  const db = params.db ?? (await getDb());
  await ensureAgent({ ...params, agentType: params.agentType ?? "unknown" });
  await db
    .update(agents)
    .set({
      ...(params.agentType !== undefined ? { agentType: params.agentType } : {}),
      ...(params.parentAgentId !== undefined ? { parentAgentId: params.parentAgentId } : {}),
      ...(params.mission !== undefined ? { mission: params.mission } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.endedAt !== undefined ? { endedAt: params.endedAt } : {}),
      updatedAt: now(),
    })
    .where(eq(agents.id, params.id));
  const agent = await getAgent(params.id, db);
  if (!agent) throw new Error(`agent disappeared after upsert: ${params.id}`);
  return agent;
}

export async function getAgent(id: string, db?: AirlockDb): Promise<Agent | null> {
  const handle = db ?? (await getDb());
  const rows = await handle.select().from(agents).where(eq(agents.id, id)).limit(1);
  return rows[0] ? toAgent(rows[0]) : null;
}

/**
 * Closes out every still-running agent in a run (a run can end without a
 * SubagentStop per agent — most commonly `main`). Returns the updated agents
 * so callers can republish them.
 */
export async function completeRunningAgents(
  runId: string,
  at: string,
  db?: AirlockDb,
): Promise<Agent[]> {
  const handle = db ?? (await getDb());
  const where = and(eq(agents.runId, runId), eq(agents.status, "running"));
  const pending = await handle.select().from(agents).where(where);
  if (pending.length === 0) return [];
  const stamp = now();
  await handle
    .update(agents)
    .set({ status: "completed", endedAt: at, updatedAt: stamp })
    .where(where);
  return pending.map((row) => ({
    ...toAgent(row),
    status: "completed",
    endedAt: at,
    updatedAt: stamp,
  }));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Inserts a freshly proposed action; a no-op if the row already exists. */
export async function insertActionIfAbsent(action: Action, db?: AirlockDb): Promise<void> {
  const handle = db ?? (await getDb());
  await handle
    .insert(actions)
    .values({
      id: action.id,
      runId: action.runId,
      agentId: action.agentId,
      toolUseId: action.toolUseId,
      toolName: action.toolName,
      toolKind: action.toolKind,
      inputJson: JSON.stringify(action.input ?? {}),
      inputSummary: action.inputSummary,
      mcpServerJson: action.mcpServer ? JSON.stringify(action.mcpServer) : null,
      proposedAt: action.proposedAt,
      completedAt: action.completedAt,
      outcome: action.outcome,
      resultPreview: action.resultPreview,
      error: action.error,
      assessmentJson: null,
      updatedAt: action.updatedAt,
    })
    .onConflictDoNothing();
}

export async function completeAction(params: {
  id: string;
  completedAt: string;
  outcome: "success" | "failure";
  resultPreview?: string | null;
  error?: string | null;
  db?: AirlockDb;
}): Promise<void> {
  const db = params.db ?? (await getDb());
  await db
    .update(actions)
    .set({
      completedAt: params.completedAt,
      outcome: params.outcome,
      ...(params.resultPreview !== undefined ? { resultPreview: params.resultPreview } : {}),
      ...(params.error !== undefined ? { error: params.error } : {}),
      updatedAt: now(),
    })
    .where(eq(actions.id, params.id));
}

export async function attachAssessment(
  actionId: string,
  assessment: Assessment,
  db?: AirlockDb,
): Promise<void> {
  const handle = db ?? (await getDb());
  await handle
    .update(actions)
    .set({ assessmentJson: JSON.stringify(assessment), updatedAt: now() })
    .where(eq(actions.id, actionId));
}

export async function getAction(id: string, db?: AirlockDb): Promise<Action | null> {
  const handle = db ?? (await getDb());
  const rows = await handle.select().from(actions).where(eq(actions.id, id)).limit(1);
  return rows[0] ? toAction(rows[0]) : null;
}

/** The full context a classifier sees for one action. */
export async function getActionContext(
  actionId: string,
  db?: AirlockDb,
): Promise<{ action: Action; agent: Agent; run: Run } | null> {
  const handle = db ?? (await getDb());
  const action = await getAction(actionId, handle);
  if (!action) return null;
  const [agent, run] = await Promise.all([
    getAgent(action.agentId, handle),
    getRun(action.runId, handle),
  ]);
  if (!agent || !run) return null;
  return { action, agent, run };
}

// ---------------------------------------------------------------------------
// Read models for the UI
// ---------------------------------------------------------------------------

export async function getRunSnapshot(runId: string, db?: AirlockDb): Promise<RunSnapshot | null> {
  const handle = db ?? (await getDb());
  const run = await getRun(runId, handle);
  if (!run) return null;
  const agentRows = await handle
    .select()
    .from(agents)
    .where(eq(agents.runId, runId))
    .orderBy(agents.startedAt, agents.id);
  const actionRows = await handle
    .select()
    .from(actions)
    .where(eq(actions.runId, runId))
    .orderBy(actions.proposedAt, actions.id);
  return {
    run,
    agents: agentRows.map(toAgent),
    actions: actionRows.map(toAction),
  };
}

interface VerdictStatsRow {
  runId: string;
  total: number;
  assessed: number;
  allow: number;
  review: number;
  deny: number;
  agentCount: number;
}

/** Recent runs with aggregate stats for the runs list. */
export async function listRunSummaries(limit = 50, db?: AirlockDb): Promise<RunSummary[]> {
  const handle = db ?? (await getDb());
  const runRows = await handle.select().from(runs).orderBy(desc(runs.updatedAt)).limit(limit);

  const stats = await handle.all<VerdictStatsRow>(sql`
    SELECT
      a.run_id AS runId,
      COUNT(*) AS total,
      SUM(CASE WHEN a.assessment_json IS NOT NULL THEN 1 ELSE 0 END) AS assessed,
      SUM(CASE WHEN json_extract(a.assessment_json, '$.verdict') = 'allow' THEN 1 ELSE 0 END) AS allow,
      SUM(CASE WHEN json_extract(a.assessment_json, '$.verdict') = 'review' THEN 1 ELSE 0 END) AS review,
      SUM(CASE WHEN json_extract(a.assessment_json, '$.verdict') = 'deny' THEN 1 ELSE 0 END) AS deny,
      (SELECT COUNT(*) FROM agents g WHERE g.run_id = a.run_id) AS agentCount
    FROM actions a
    GROUP BY a.run_id
  `);
  const byRun = new Map(stats.map((s) => [s.runId, s]));

  return runRows.map((row) => {
    const s = byRun.get(row.id);
    const total = s?.total ?? 0;
    const assessed = s?.assessed ?? 0;
    return {
      run: toRun(row),
      agents: s?.agentCount ?? 0,
      actions: total,
      verdicts: {
        allow: s?.allow ?? 0,
        review: s?.review ?? 0,
        deny: s?.deny ?? 0,
        pending: Math.max(0, total - assessed),
      },
    };
  });
}
