import { ActionSchema, MAIN_AGENT_ID, actionIdFor, agentIdFor, runIdFor } from "@/contracts";
import type {
  ActionCompletedEvent,
  ActionFailedEvent,
  ActionProposedEvent,
  NormalizedEvent,
} from "@/contracts";
import { publishStream } from "@/server/bus";
import { CLASSIFIERS } from "@/server/classifiers";
import type { ProviderAssessment } from "@/server/classifiers/types";
import { classifyToolKind } from "@/server/classifiers/tool-kind";
import { getConfig } from "@/server/config";
import { buildAssessment } from "@/server/policy";
import { previewValue, redactValue } from "@/server/redaction";
import {
  attachAssessment,
  completeAction,
  ensureAgent,
  ensureRun,
  getAction,
  getActionContext,
  insertActionIfAbsent,
  upsertAgent,
  upsertRun,
} from "@/server/storage/repository";
import type { AirlockDb } from "@/server/storage/client";
import { summarizeToolInput } from "./summarize";

/**
 * The ingestion pipeline: normalized events in, domain rows + stream events
 * out. Redaction runs before anything is persisted or classified — raw tool
 * input never reaches the database, the bus, or a classifier.
 *
 * Rows are upserts (hook events can arrive out of order) and every write is
 * republished on the bus, so SSE clients only ever upsert what they receive.
 */

function buildProposedAction(event: ActionProposedEvent, runId: string) {
  const redaction = getConfig().redaction;
  const input = redactValue(event.toolInput, redaction).value;
  const now = new Date().toISOString();
  return ActionSchema.parse({
    id: actionIdFor(runId, event.toolUseId),
    runId,
    agentId: agentIdFor(runId, event.agentId),
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    toolKind: classifyToolKind(event.toolName),
    input,
    inputSummary: summarizeToolInput(event.toolName, input),
    mcpServer: event.mcpServer ?? null,
    proposedAt: event.at,
    completedAt: null,
    outcome: null,
    resultPreview: null,
    error: null,
    updatedAt: now,
    assessment: null,
  });
}

async function publishAction(actionId: string, db?: AirlockDb): Promise<void> {
  const action = await getAction(actionId, db);
  if (action) publishStream({ type: "action.upserted", action });
}

/**
 * Runs the configured classifiers and attaches the combined assessment.
 * Provider failures are logged and skipped — a Jev outage or a missing
 * TYPESAFE_API_KEY must never block rules-based scoring or ingestion.
 */
export async function assessAction(actionId: string, db?: AirlockDb): Promise<void> {
  const ctx = await getActionContext(actionId, db);
  if (!ctx || ctx.action.assessment) return;

  const config = getConfig();
  const results = await Promise.allSettled(
    config.classifier.providers.map((name) => CLASSIFIERS[name].assess(ctx)),
  );
  const providerAssessments: ProviderAssessment[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      providerAssessments.push(result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[airlock] classifier "${config.classifier.providers[i]}" failed: ${reason}`);
    }
  }

  const assessment = buildAssessment({
    id: `asmt-${actionId}`,
    actionId,
    providerAssessments,
    policy: config.policy,
  });
  await attachAssessment(actionId, assessment, db);
  await publishAction(actionId, db);
}

/** Fire-and-forget assessment; the hook route must ack before Jev returns. */
function scheduleAssessment(actionId: string): void {
  void assessAction(actionId).catch((err) => {
    console.warn(`[airlock] assessment failed for ${actionId}:`, err);
  });
}

/** Ensures the run and main-agent rows exist for events that may arrive first. */
async function ensureContext(event: NormalizedEvent, db?: AirlockDb): Promise<{ runId: string }> {
  const runId = runIdFor(event.source, event.sessionId);
  await ensureRun({
    id: runId,
    source: event.source,
    sessionId: event.sessionId,
    at: event.at,
    cwd: event.cwd,
    db,
  });
  return { runId };
}

/**
 * Applies one normalized event to storage and the stream. Any assessment is
 * scheduled asynchronously unless `awaitAssessment` is set (used by replay and
 * tests that need a settled database afterwards).
 */
export async function ingestEvent(
  event: NormalizedEvent,
  options: { db?: AirlockDb; awaitAssessment?: boolean } = {},
): Promise<void> {
  const db = options.db;
  const { runId } = await ensureContext(event, db);

  switch (event.kind) {
    case "run.started": {
      const run = await upsertRun({
        id: runId,
        source: event.source,
        sessionId: event.sessionId,
        at: event.at,
        cwd: event.cwd,
        status: "active",
        db,
      });
      const agent = await upsertAgent({
        id: agentIdFor(runId, MAIN_AGENT_ID),
        runId,
        agentId: MAIN_AGENT_ID,
        agentType: MAIN_AGENT_ID,
        at: event.at,
        db,
      });
      publishStream({ type: "run.upserted", run });
      publishStream({ type: "agent.upserted", agent });
      return;
    }

    case "run.mission": {
      const run = await upsertRun({
        id: runId,
        source: event.source,
        sessionId: event.sessionId,
        at: event.at,
        mission: event.mission,
        db,
      });
      publishStream({ type: "run.upserted", run });
      return;
    }

    case "run.ended": {
      const run = await upsertRun({
        id: runId,
        source: event.source,
        sessionId: event.sessionId,
        at: event.at,
        status: "ended",
        endedAt: event.at,
        db,
      });
      publishStream({ type: "run.upserted", run });
      return;
    }

    case "agent.started": {
      const agent = await upsertAgent({
        id: agentIdFor(runId, event.agentId),
        runId,
        agentId: event.agentId,
        agentType: event.agentType,
        parentAgentId: event.parentAgentId ?? null,
        at: event.at,
        status: "running",
        db,
      });
      publishStream({ type: "agent.upserted", agent });
      return;
    }

    case "agent.mission": {
      const agent = await upsertAgent({
        id: agentIdFor(runId, event.agentId),
        runId,
        agentId: event.agentId,
        at: event.at,
        agentType: event.agentType,
        parentAgentId: event.parentAgentId ?? undefined,
        mission: event.mission,
        description: event.description,
        db,
      });
      publishStream({ type: "agent.upserted", agent });
      return;
    }

    case "agent.stopped": {
      const agent = await upsertAgent({
        id: agentIdFor(runId, event.agentId),
        runId,
        agentId: event.agentId,
        at: event.at,
        agentType: event.agentType,
        status: "completed",
        endedAt: event.at,
        db,
      });
      publishStream({ type: "agent.upserted", agent });
      return;
    }

    case "action.proposed": {
      await ensureAgent({
        id: agentIdFor(runId, event.agentId),
        runId,
        agentId: event.agentId,
        agentType: event.agentType ?? "unknown",
        at: event.at,
        db,
      });
      const action = buildProposedAction(event, runId);
      await insertActionIfAbsent(action, db);
      await publishAction(action.id, db);
      if (options.awaitAssessment) {
        await assessAction(action.id, db);
      } else {
        scheduleAssessment(action.id);
      }
      return;
    }

    case "action.completed":
    case "action.failed": {
      // A Post can arrive without its Pre (Airlock started mid-session):
      // reconstruct a proposed row first so the action is never lost.
      const settled = event as ActionCompletedEvent | ActionFailedEvent;
      const proposed: ActionProposedEvent = {
        ...settled,
        kind: "action.proposed",
      };
      await ensureAgent({
        id: agentIdFor(runId, event.agentId),
        runId,
        agentId: event.agentId,
        agentType: event.agentType ?? "unknown",
        at: event.at,
        db,
      });
      const action = buildProposedAction(proposed, runId);
      await insertActionIfAbsent(action, db);
      await completeAction({
        id: action.id,
        completedAt: event.at,
        outcome: event.kind === "action.completed" ? "success" : "failure",
        resultPreview:
          event.kind === "action.completed"
            ? previewValue(event.toolResponse, getConfig().redaction)
            : null,
        error: event.kind === "action.failed" ? event.error : null,
        db,
      });
      await publishAction(action.id, db);
      // Assess only if not already done at proposal time.
      const current = await getAction(action.id, db);
      if (current && !current.assessment) {
        if (options.awaitAssessment) {
          await assessAction(action.id, db);
        } else {
          scheduleAssessment(action.id);
        }
      }
      return;
    }
  }
}
