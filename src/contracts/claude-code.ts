import { z } from "zod";

/**
 * Raw Claude Code hook payloads, as POSTed by `type: "http"` hooks.
 *
 * Schemas are deliberately loose (`looseObject`): Claude Code adds fields over
 * time and the adapter must never reject an event because of a new field.
 * Field names follow the Claude Code hooks reference (session_id, cwd,
 * hook_event_name, agent_id, agent_type, tool_name, tool_input, tool_use_id,
 * tool_response, mcp_server, prompt, last_assistant_message, error).
 */

const common = {
  session_id: z.string().min(1),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  /** Present only when the hook fired inside a subagent. */
  agent_id: z.string().optional(),
  /** Present inside a subagent, or when the session runs with --agent. */
  agent_type: z.string().optional(),
};

export const ClaudeMcpServerSchema = z.looseObject({
  name: z.string(),
  source: z.string().optional(),
});

const toolCommon = {
  ...common,
  tool_name: z.string().min(1),
  tool_input: z.unknown(),
  /** Correlates PreToolUse, PostToolUse and PostToolUseFailure for one call. */
  tool_use_id: z.string().optional(),
  mcp_server: ClaudeMcpServerSchema.optional(),
};

export const ClaudeSessionStartSchema = z.looseObject({
  ...common,
  hook_event_name: z.literal("SessionStart"),
  source: z.string().optional(),
  model: z.string().optional(),
});

export const ClaudeSessionEndSchema = z.looseObject({
  ...common,
  hook_event_name: z.literal("SessionEnd"),
  reason: z.string().optional(),
});

export const ClaudeUserPromptSubmitSchema = z.looseObject({
  ...common,
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string(),
});

export const ClaudeSubagentStartSchema = z.looseObject({
  ...common,
  hook_event_name: z.literal("SubagentStart"),
  agent_id: z.string().min(1),
  agent_type: z.string().min(1),
});

export const ClaudeSubagentStopSchema = z.looseObject({
  ...common,
  hook_event_name: z.literal("SubagentStop"),
  agent_id: z.string().min(1),
  agent_type: z.string().min(1),
  agent_transcript_path: z.string().optional(),
  last_assistant_message: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

export const ClaudePreToolUseSchema = z.looseObject({
  ...toolCommon,
  hook_event_name: z.literal("PreToolUse"),
});

export const ClaudePostToolUseSchema = z.looseObject({
  ...toolCommon,
  hook_event_name: z.literal("PostToolUse"),
  tool_response: z.unknown(),
});

export const ClaudePostToolUseFailureSchema = z.looseObject({
  ...toolCommon,
  hook_event_name: z.literal("PostToolUseFailure"),
  error: z.string(),
  is_interrupt: z.boolean().optional(),
});

export const ClaudeHookEventSchema = z.discriminatedUnion("hook_event_name", [
  ClaudeSessionStartSchema,
  ClaudeSessionEndSchema,
  ClaudeUserPromptSubmitSchema,
  ClaudeSubagentStartSchema,
  ClaudeSubagentStopSchema,
  ClaudePreToolUseSchema,
  ClaudePostToolUseSchema,
  ClaudePostToolUseFailureSchema,
]);

export type ClaudeHookEvent = z.infer<typeof ClaudeHookEventSchema>;
export type ClaudeHookEventName = ClaudeHookEvent["hook_event_name"];

/** Minimal shape used to recognise (and ignore) events Airlock does not model. */
export const ClaudeAnyHookEventSchema = z.looseObject({
  session_id: z.string().min(1),
  hook_event_name: z.string().min(1),
});

/**
 * The `Agent` tool's input and response, as seen in PreToolUse/PostToolUse.
 * The response's `agentId` is what links a spawn call to its SubagentStart.
 */
export const ClaudeAgentToolInputSchema = z.looseObject({
  description: z.string().optional(),
  prompt: z.string().optional(),
  subagent_type: z.string().optional(),
  run_in_background: z.boolean().optional(),
});

export const ClaudeAgentToolResponseSchema = z.looseObject({
  status: z.string().optional(),
  agentId: z.string().optional(),
});

export const HANDLED_CLAUDE_EVENTS: readonly ClaudeHookEventName[] = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
];
