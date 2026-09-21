import { z } from "zod";
import { McpServerRefSchema, SourceSchema, UsageSchema } from "./domain";

/**
 * Normalized events: the adapter -> ingestion boundary.
 *
 * Every adapter (Claude Code hooks, the simulator, a future Devin CLI adapter)
 * translates its native payloads into this union. Ingestion never sees raw
 * hook JSON. Adapters do not redact; ingestion does.
 */

const base = {
  source: SourceSchema,
  sessionId: z.string().min(1),
  /** ISO-8601 timestamp. Adapters use the receive time when the source has none. */
  at: z.string(),
  cwd: z.string().optional(),
};

export const RunStartedEventSchema = z.object({
  ...base,
  kind: z.literal("run.started"),
});

export const RunMissionEventSchema = z.object({
  ...base,
  kind: z.literal("run.mission"),
  mission: z.string(),
});

export const RunEndedEventSchema = z.object({
  ...base,
  kind: z.literal("run.ended"),
  reason: z.string().optional(),
});

export const AgentStartedEventSchema = z.object({
  ...base,
  kind: z.literal("agent.started"),
  agentId: z.string().min(1),
  agentType: z.string().min(1),
  parentAgentId: z.string().optional(),
});

/**
 * Emitted when the parent's spawn call reveals what a subagent was asked to do.
 * May arrive before or after agent.started; ingestion upserts either way.
 */
export const AgentMissionEventSchema = z.object({
  ...base,
  kind: z.literal("agent.mission"),
  agentId: z.string().min(1),
  agentType: z.string().optional(),
  parentAgentId: z.string().optional(),
  mission: z.string().optional(),
  description: z.string().optional(),
});

export const AgentStoppedEventSchema = z.object({
  ...base,
  kind: z.literal("agent.stopped"),
  agentId: z.string().min(1),
  agentType: z.string().optional(),
  lastMessagePreview: z.string().optional(),
});

const actionBase = {
  ...base,
  agentId: z.string().min(1),
  agentType: z.string().optional(),
  toolUseId: z.string().min(1),
  toolName: z.string().min(1),
  toolInput: z.unknown(),
  mcpServer: McpServerRefSchema.optional(),
};

export const ActionProposedEventSchema = z.object({
  ...actionBase,
  kind: z.literal("action.proposed"),
});

export const ActionCompletedEventSchema = z.object({
  ...actionBase,
  kind: z.literal("action.completed"),
  toolResponse: z.unknown(),
});

export const ActionFailedEventSchema = z.object({
  ...actionBase,
  kind: z.literal("action.failed"),
  error: z.string(),
  isInterrupt: z.boolean().optional(),
});

/** Token usage for a session, reported by the source's own telemetry. */
export const RunUsageEventSchema = z.object({
  ...base,
  kind: z.literal("run.usage"),
  usage: UsageSchema,
});

export const NormalizedEventSchema = z.discriminatedUnion("kind", [
  RunStartedEventSchema,
  RunMissionEventSchema,
  RunEndedEventSchema,
  RunUsageEventSchema,
  AgentStartedEventSchema,
  AgentMissionEventSchema,
  AgentStoppedEventSchema,
  ActionProposedEventSchema,
  ActionCompletedEventSchema,
  ActionFailedEventSchema,
]);

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
export type NormalizedEventKind = NormalizedEvent["kind"];
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
export type RunMissionEvent = z.infer<typeof RunMissionEventSchema>;
export type RunEndedEvent = z.infer<typeof RunEndedEventSchema>;
export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;
export type AgentMissionEvent = z.infer<typeof AgentMissionEventSchema>;
export type AgentStoppedEvent = z.infer<typeof AgentStoppedEventSchema>;
export type ActionProposedEvent = z.infer<typeof ActionProposedEventSchema>;
export type ActionCompletedEvent = z.infer<typeof ActionCompletedEventSchema>;
export type ActionFailedEvent = z.infer<typeof ActionFailedEventSchema>;
export type RunUsageEvent = z.infer<typeof RunUsageEventSchema>;
