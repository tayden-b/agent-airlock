import { z } from "zod";

/**
 * Domain contracts: the shapes Airlock persists and streams.
 * Everything downstream of an adapter (storage, policy, UI) speaks these types.
 */

export const SourceSchema = z.enum(["claude-code", "simulator", "devin-cli", "devin"]);
export type Source = z.infer<typeof SourceSchema>;

export const ToolKindSchema = z.enum([
  "read",
  "search",
  "edit",
  "shell",
  "web",
  "agent",
  "mcp",
  "other",
]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const VerdictSchema = z.enum(["allow", "review", "deny"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const DIMENSIONS = ["scope", "exposure", "impact", "reversibility"] as const;
export const DimensionNameSchema = z.enum(DIMENSIONS);
export type DimensionName = z.infer<typeof DimensionNameSchema>;

export const ProviderNameSchema = z.enum(["rules", "jev"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

/** One risk dimension: 0 = no risk, 1 = maximal risk. */
export const DimensionScoreSchema = z.object({
  risk: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["rules", "jev", "combined", "default"]),
  probabilities: z.record(z.string(), z.number()).optional(),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

export const DimensionScoresSchema = z.object({
  scope: DimensionScoreSchema,
  exposure: DimensionScoreSchema,
  impact: DimensionScoreSchema,
  reversibility: DimensionScoreSchema,
});
export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

export const RuleHitSchema = z.object({
  ruleId: z.string().min(1),
  message: z.string(),
  dimensions: z.partialRecord(DimensionNameSchema, z.number().min(0).max(1)),
});
export type RuleHit = z.infer<typeof RuleHitSchema>;

export const RunStatusSchema = z.enum(["active", "ended"]);
export const AgentStatusSchema = z.enum(["running", "completed", "failed"]);
export const OutcomeSchema = z.enum(["success", "failure"]);

/** What the session is currently doing — Jev's rolling judgment over recent actions. */
export const SessionPhaseSchema = z.enum(["exploring", "implementing", "verifying", "looping"]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

/** Jev's end-of-session judgment: what the session was, and whether it got there. */
export const SessionVerdictSchema = z.object({
  archetype: z.enum([
    "research",
    "bugfix",
    "feature",
    "refactor",
    "ops",
    "sensitive-access",
    "mixed",
  ]),
  /** Probability that the session accomplished its stated mission. */
  accomplished: z.number().min(0).max(1),
});
export type SessionVerdict = z.infer<typeof SessionVerdictSchema>;

/** Token usage reported by the source (Claude Code transcripts, etc.). */
export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const RunSchema = z.object({
  id: z.string().min(1),
  source: SourceSchema,
  sessionId: z.string().min(1),
  cwd: z.string().nullable(),
  mission: z.string().nullable(),
  status: RunStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
  phase: SessionPhaseSchema.nullable().default(null),
  sessionVerdict: SessionVerdictSchema.nullable().default(null),
  usage: UsageSchema.nullable().default(null),
});
export type Run = z.infer<typeof RunSchema>;

export const AgentSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  /** Adapter-native agent identifier. The main thread is always "main". */
  agentId: z.string().min(1),
  agentType: z.string().min(1),
  parentAgentId: z.string().nullable(),
  mission: z.string().nullable(),
  description: z.string().nullable(),
  status: AgentStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const McpServerRefSchema = z.object({
  name: z.string(),
  source: z.string().optional(),
});
export type McpServerRef = z.infer<typeof McpServerRefSchema>;

export const AssessmentSchema = z.object({
  id: z.string().min(1),
  actionId: z.string().min(1),
  policyVersion: z.string().min(1),
  verdict: VerdictSchema,
  reason: z.string(),
  dimensions: DimensionScoresSchema,
  ruleHits: z.array(RuleHitSchema),
  providers: z.array(ProviderNameSchema),
  latencyMs: z.number().nonnegative(),
  assessedAt: z.string(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const ActionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  /** FK to Agent.id (the composite id, not the adapter-native agentId). */
  agentId: z.string().min(1),
  toolUseId: z.string().min(1),
  toolName: z.string().min(1),
  toolKind: ToolKindSchema,
  /** Redacted and truncated tool input. Never the raw payload. */
  input: z.unknown(),
  inputSummary: z.string(),
  mcpServer: McpServerRefSchema.nullable(),
  proposedAt: z.string(),
  completedAt: z.string().nullable(),
  outcome: OutcomeSchema.nullable(),
  resultPreview: z.string().nullable(),
  error: z.string().nullable(),
  updatedAt: z.string(),
  assessment: AssessmentSchema.nullable(),
});
export type Action = z.infer<typeof ActionSchema>;

export const RunSnapshotSchema = z.object({
  run: RunSchema,
  agents: z.array(AgentSchema),
  actions: z.array(ActionSchema),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

/** Verdict tallies for one run; `pending` counts actions not yet assessed. */
export const VerdictCountsSchema = z.object({
  allow: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  deny: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});
export type VerdictCounts = z.infer<typeof VerdictCountsSchema>;

/** One row of the runs list: the run plus aggregate stats. */
export const RunSummarySchema = z.object({
  run: RunSchema,
  agents: z.number().int().nonnegative(),
  actions: z.number().int().nonnegative(),
  verdicts: VerdictCountsSchema,
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const MAIN_AGENT_ID = "main";

export function runIdFor(source: Source, sessionId: string): string {
  return `${source}:${sessionId}`;
}

export function agentIdFor(runId: string, agentId: string): string {
  return `${runId}:${agentId}`;
}

export function actionIdFor(runId: string, toolUseId: string): string {
  return `${runId}:${toolUseId}`;
}
