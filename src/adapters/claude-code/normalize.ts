import {
  ClaudeAgentToolInputSchema,
  ClaudeAgentToolResponseSchema,
  ClaudeAnyHookEventSchema,
  ClaudeHookEventSchema,
  HANDLED_CLAUDE_EVENTS,
  MAIN_AGENT_ID,
} from "@/contracts";
import type { ClaudeHookEvent, NormalizedEvent, Source } from "@/contracts";

export interface NormalizeOptions {
  source?: Source;
  receivedAt?: string;
}

export interface NormalizeResult {
  events: NormalizedEvent[];
  ignored?: { hookEventName: string; reason: string };
  error?: string;
}

type ClaudeToolEvent = Extract<
  ClaudeHookEvent,
  { hook_event_name: "PreToolUse" | "PostToolUse" | "PostToolUseFailure" }
>;

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function synthesizeToolUseId(agentId: string, toolName: string, toolInput: unknown): string {
  return `synth-${fnv1a(`${agentId}\u0000${toolName}\u0000${stableStringify(toolInput)}`)}`;
}

/** Claude Code injects system envelopes (background-task notices, reminders,
 * command echoes) as prompt-shaped text. They are not user missions. */
const SYNTHETIC_PROMPT =
  /^\s*<(?:task-notification|system-reminder|command-name|command-args|command-message|local-command-stdout|local-command-stderr|bash-input|bash-output|ide-opened-file|ide-selection)\b/;

const MISSION_MAX = 200;

function cleanMission(prompt: string): string | undefined {
  if (SYNTHETIC_PROMPT.test(prompt)) return undefined;
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > MISSION_MAX ? `${flat.slice(0, MISSION_MAX).trimEnd()}…` : flat;
}

function firstIssueMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "unknown issue";
  const path = issue.path.map(String).join(".");
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

function toolFields(event: ClaudeToolEvent, agentId: string, agentType: string) {
  return {
    agentId,
    agentType,
    toolUseId: event.tool_use_id ?? synthesizeToolUseId(agentId, event.tool_name, event.tool_input),
    toolName: event.tool_name,
    // z.unknown() makes toolInput a required key on the normalized action events,
    // even though the value itself may be undefined.
    toolInput: event.tool_input,
    ...(event.mcp_server !== undefined
      ? {
          mcpServer: {
            name: event.mcp_server.name,
            ...(event.mcp_server.source !== undefined ? { source: event.mcp_server.source } : {}),
          },
        }
      : {}),
  };
}

export function normalizeClaudeCodeEvent(
  raw: unknown,
  options: NormalizeOptions = {},
): NormalizeResult {
  try {
    const source = options.source ?? "claude-code";
    const receivedAt = options.receivedAt ?? new Date().toISOString();

    const parsed = ClaudeHookEventSchema.safeParse(raw);
    if (!parsed.success) {
      const anyEvent = ClaudeAnyHookEventSchema.safeParse(raw);
      if (anyEvent.success) {
        const name = anyEvent.data.hook_event_name;
        if (!(HANDLED_CLAUDE_EVENTS as readonly string[]).includes(name)) {
          return { events: [], ignored: { hookEventName: name, reason: "unhandled event" } };
        }
        return {
          events: [],
          error: `invalid ${name} payload: ${firstIssueMessage(parsed.error)}`,
        };
      }
      return { events: [], error: `invalid payload: ${firstIssueMessage(parsed.error)}` };
    }

    const event = parsed.data;
    const base = {
      source,
      sessionId: event.session_id,
      at: receivedAt,
      ...(event.cwd !== undefined ? { cwd: event.cwd } : {}),
    };
    const agentId = event.agent_id ?? MAIN_AGENT_ID;
    // agent_type may be absent or empty (e.g. SubagentStop on Claude Code
    // 2.x); fall back to "unknown" for subagents and "main" for the thread.
    const agentType = event.agent_type || (event.agent_id ? "unknown" : MAIN_AGENT_ID);

    switch (event.hook_event_name) {
      case "SessionStart":
        return { events: [{ ...base, kind: "run.started" }] };
      case "SessionEnd":
        return {
          events: [
            {
              ...base,
              kind: "run.ended",
              ...(event.reason !== undefined ? { reason: event.reason } : {}),
            },
          ],
        };
      case "UserPromptSubmit": {
        const mission = cleanMission(event.prompt);
        if (mission === undefined) {
          return {
            events: [],
            ignored: { hookEventName: "UserPromptSubmit", reason: "synthetic envelope" },
          };
        }
        if (event.agent_id === undefined) {
          return { events: [{ ...base, kind: "run.mission", mission }] };
        }
        return {
          events: [{ ...base, kind: "agent.mission", agentId, agentType, mission }],
        };
      }
      case "SubagentStart":
        return {
          events: [
            {
              ...base,
              kind: "agent.started",
              agentId,
              agentType,
              parentAgentId: MAIN_AGENT_ID,
            },
          ],
        };
      case "SubagentStop":
        return {
          events: [
            {
              ...base,
              kind: "agent.stopped",
              agentId,
              agentType,
              ...(event.last_assistant_message !== undefined
                ? { lastMessagePreview: event.last_assistant_message }
                : {}),
            },
          ],
        };
      case "PreToolUse":
        return {
          events: [{ ...base, ...toolFields(event, agentId, agentType), kind: "action.proposed" }],
        };
      case "PostToolUse": {
        const events: NormalizedEvent[] = [
          {
            ...base,
            ...toolFields(event, agentId, agentType),
            kind: "action.completed",
            toolResponse: event.tool_response,
          },
        ];
        if (event.tool_name === "Agent" || event.tool_name === "Task") {
          const response = ClaudeAgentToolResponseSchema.safeParse(event.tool_response);
          const input = ClaudeAgentToolInputSchema.safeParse(event.tool_input);
          if (
            response.success &&
            typeof response.data.agentId === "string" &&
            response.data.agentId.length > 0 &&
            input.success
          ) {
            events.push({
              ...base,
              kind: "agent.mission",
              agentId: response.data.agentId,
              ...(input.data.subagent_type !== undefined
                ? { agentType: input.data.subagent_type }
                : {}),
              parentAgentId: agentId,
              ...(input.data.prompt !== undefined
                ? { mission: cleanMission(input.data.prompt) }
                : {}),
              ...(input.data.description !== undefined
                ? { description: input.data.description }
                : {}),
            });
          }
        }
        return { events };
      }
      case "PostToolUseFailure":
        return {
          events: [
            {
              ...base,
              ...toolFields(event, agentId, agentType),
              kind: "action.failed",
              error: event.error,
              ...(event.is_interrupt !== undefined ? { isInterrupt: event.is_interrupt } : {}),
            },
          ],
        };
    }
  } catch (err) {
    return {
      events: [],
      error: `normalization failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
