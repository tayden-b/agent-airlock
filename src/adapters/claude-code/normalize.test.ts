import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedEventSchema } from "@/contracts";
import type { NormalizedEvent } from "@/contracts";
import { normalizeClaudeCodeEvent, synthesizeToolUseId } from "./normalize";

const fixturesDir = join(import.meta.dirname, "fixtures");
const fanoutPath = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "sessions",
  "research-fanout.jsonl",
);
const options = { receivedAt: "2026-09-21T10:15:00.000Z" } as const;

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

function normalizeFixture(name: string): NormalizedEvent[] {
  const result = normalizeClaudeCodeEvent(loadFixture(name), options);
  expect(result.error).toBeUndefined();
  expect(result.ignored).toBeUndefined();
  return result.events;
}

describe("normalizeClaudeCodeEvent fixtures", () => {
  it("session-start emits run.started", () => {
    const events = normalizeFixture("session-start.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "run.started",
      source: "claude-code",
      sessionId: "sess_7f3a9c",
      cwd: "/Users/dev/acme",
      at: "2026-09-21T10:15:00.000Z",
    });
  });

  it("user-prompt-submit emits run.mission", () => {
    const events = normalizeFixture("user-prompt-submit.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "run.mission",
      sessionId: "sess_7f3a9c",
      mission: "Add retry logic to the billing webhook handler and cover it with tests.",
    });
  });

  it("pre-tool-use-bash emits action.proposed for the main agent", () => {
    const events = normalizeFixture("pre-tool-use-bash.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.proposed",
      agentId: "main",
      agentType: "main",
      toolUseId: "toolu_01HQ4XKM2N9P3QR4ST5V6W7X",
      toolName: "Bash",
      toolInput: { command: "pnpm test", description: "Run the test suite" },
    });
  });

  it("post-tool-use-bash emits action.completed with the response", () => {
    const events = normalizeFixture("post-tool-use-bash.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.completed",
      agentId: "main",
      toolUseId: "toolu_01HQ4XKM2N9P3QR4ST5V6W7X",
      toolName: "Bash",
      toolResponse: {
        stdout: "Test Files  12 passed (12)\n     Tests  48 passed (48)",
        stderr: "",
        interrupted: false,
      },
    });
  });

  it("post-tool-use-failure-bash emits action.failed", () => {
    const events = normalizeFixture("post-tool-use-failure-bash.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.failed",
      agentId: "main",
      toolUseId: "toolu_01HQ52F7G8H9J0K1L2M3N4P5Q6",
      toolName: "Bash",
      isInterrupt: false,
    });
    expect(events[0]).toHaveProperty("error", expect.stringContaining("Exit code 1"));
  });

  it("pre-tool-use-read emits action.proposed for Read", () => {
    const events = normalizeFixture("pre-tool-use-read.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.proposed",
      toolName: "Read",
      toolUseId: "toolu_01HQ4Y2A8B3C4D5E6F7G8H9J0K",
      toolInput: { file_path: "/Users/dev/acme/src/auth/middleware.ts" },
    });
  });

  it("pre-tool-use-mcp carries the MCP server ref", () => {
    const events = normalizeFixture("pre-tool-use-mcp.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.proposed",
      toolName: "mcp__github__create_issue",
      toolUseId: "toolu_01HQ4Z3K5L7M9N1P3Q5R7S9T1V",
      mcpServer: { name: "github", source: "user" },
    });
  });

  it("pre-tool-use-agent emits a single action.proposed for the spawn call", () => {
    const events = normalizeFixture("pre-tool-use-agent.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.proposed",
      agentId: "main",
      toolName: "Agent",
      toolUseId: "toolu_01HQ50V2W4X6Y8Z0A2B4C6D8E0",
    });
  });

  it("post-tool-use-agent emits action.completed plus a linked agent.mission", () => {
    const events = normalizeFixture("post-tool-use-agent.json");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "action.completed",
      agentId: "main",
      toolName: "Agent",
      toolUseId: "toolu_01HQ50V2W4X6Y8Z0A2B4C6D8E0",
    });
    expect(events[1]).toMatchObject({
      kind: "agent.mission",
      agentId: "agt_3b91e2",
      parentAgentId: "main",
      agentType: "Explore",
      description: "Explore auth middleware",
    });
    expect(events[1]).toHaveProperty(
      "mission",
      expect.stringContaining("Trace the token refresh flow"),
    );
  });

  it("subagent-start emits agent.started with parent main", () => {
    const events = normalizeFixture("subagent-start.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "agent.started",
      agentId: "agt_3b91e2",
      agentType: "Explore",
      parentAgentId: "main",
    });
  });

  it("subagent-pre-tool-use-grep attributes the action to the subagent", () => {
    const events = normalizeFixture("subagent-pre-tool-use-grep.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "action.proposed",
      agentId: "agt_3b91e2",
      agentType: "Explore",
      toolName: "Grep",
      toolUseId: "toolu_01HQ51E4F6G8H0J2K4L6M8N0P2",
      sessionId: "sess_7f3a9c",
    });
  });

  it("subagent-stop emits agent.stopped with the last message preview", () => {
    const events = normalizeFixture("subagent-stop.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "agent.stopped",
      agentId: "agt_3b91e2",
      agentType: "Explore",
    });
    expect(events[0]).toHaveProperty(
      "lastMessagePreview",
      expect.stringContaining("token refresh logic"),
    );
  });

  it("subagent-stop with empty agent_type falls back to unknown", () => {
    const result = normalizeClaudeCodeEvent(
      {
        ...(loadFixture("subagent-stop.json") as Record<string, unknown>),
        agent_type: "",
      },
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.events[0]).toMatchObject({
      kind: "agent.stopped",
      agentId: "agt_3b91e2",
      agentType: "unknown",
    });
  });

  it("session-end emits run.ended with the reason", () => {
    const events = normalizeFixture("session-end.json");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "run.ended",
      sessionId: "sess_7f3a9c",
      reason: "exit",
    });
  });

  it("unknown events are ignored with a reason", () => {
    const result = normalizeClaudeCodeEvent(loadFixture("unknown-event.json"), options);
    expect(result.events).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.ignored).toEqual({
      hookEventName: "Notification",
      reason: "unhandled event",
    });
  });

  it("payloads missing a required common field produce an error", () => {
    const result = normalizeClaudeCodeEvent(loadFixture("invalid.json"), options);
    expect(result.events).toEqual([]);
    expect(result.ignored).toBeUndefined();
    expect(result.error).toMatch(/^invalid payload: /);
  });

  it("handled events missing a required field name the event in the error", () => {
    const result = normalizeClaudeCodeEvent(
      { session_id: "sess_7f3a9c", hook_event_name: "UserPromptSubmit" },
      options,
    );
    expect(result.events).toEqual([]);
    expect(result.error).toMatch(/^invalid UserPromptSubmit payload: prompt: /);
  });

  it("honours the source override", () => {
    const result = normalizeClaudeCodeEvent(loadFixture("session-start.json"), {
      ...options,
      source: "simulator",
    });
    expect(result.events[0]).toHaveProperty("source", "simulator");
  });

  it("never throws on garbage input", () => {
    for (const raw of [null, undefined, 42, "nope", [], { hook_event_name: 7 }]) {
      const result = normalizeClaudeCodeEvent(raw, options);
      expect(result.events).toEqual([]);
      expect(typeof result.error).toBe("string");
    }
  });

  it("every emitted event across all fixtures passes NormalizedEventSchema", () => {
    for (const file of readdirSync(fixturesDir)) {
      const result = normalizeClaudeCodeEvent(loadFixture(file), options);
      for (const event of result.events) {
        expect(() => NormalizedEventSchema.parse(event), file).not.toThrow();
      }
    }
  });
});

describe("synthesizeToolUseId", () => {
  it("is stable across tool_input key order", () => {
    const a = synthesizeToolUseId("main", "Read", { file_path: "/x", limit: 10 });
    const b = synthesizeToolUseId("main", "Read", { limit: 10, file_path: "/x" });
    expect(a).toBe(b);
    expect(a).toMatch(/^synth-[0-9a-f]{8}$/);
  });

  it("differs when the input differs", () => {
    const a = synthesizeToolUseId("main", "Read", { file_path: "/x" });
    const b = synthesizeToolUseId("main", "Read", { file_path: "/y" });
    const c = synthesizeToolUseId("agt_3b91e2", "Read", { file_path: "/x" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("correlates Pre and Post payloads that lack tool_use_id", () => {
    const pre = normalizeClaudeCodeEvent(
      {
        session_id: "sess_7f3a9c",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { limit: 5, file_path: "/Users/dev/acme/README.md" },
      },
      options,
    );
    const post = normalizeClaudeCodeEvent(
      {
        session_id: "sess_7f3a9c",
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/Users/dev/acme/README.md", limit: 5 },
        tool_response: { type: "text", file: {} },
      },
      options,
    );
    expect(pre.events[0]).toHaveProperty("kind", "action.proposed");
    expect(post.events[0]).toHaveProperty("kind", "action.completed");
    const preId = (pre.events[0] as { toolUseId: string }).toolUseId;
    const postId = (post.events[0] as { toolUseId: string }).toolUseId;
    expect(preId).toMatch(/^synth-/);
    expect(postId).toBe(preId);
  });
});

describe("fixtures/sessions/research-fanout.jsonl", () => {
  const lines = readFileSync(fanoutPath, "utf8").trim().split("\n");
  const normalized = lines.map((line) => ({
    raw: JSON.parse(line) as unknown,
    result: normalizeClaudeCodeEvent(JSON.parse(line), options),
  }));

  it("is a coherent session of 34-40 lines", () => {
    expect(lines.length).toBeGreaterThanOrEqual(34);
    expect(lines.length).toBeLessThanOrEqual(40);
  });

  it("every line normalizes with no error and at least one event", () => {
    for (const { result } of normalized) {
      expect(result.error).toBeUndefined();
      expect(result.ignored).toBeUndefined();
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      for (const event of result.events) {
        expect(() => NormalizedEventSchema.parse(event)).not.toThrow();
      }
    }
  });

  it("every proposed action is completed or failed under the same toolUseId", () => {
    const proposed = new Set<string>();
    const settled = new Set<string>();
    for (const { result } of normalized) {
      for (const event of result.events) {
        if (event.kind === "action.proposed") proposed.add(event.toolUseId);
        if (event.kind === "action.completed" || event.kind === "action.failed") {
          settled.add(event.toolUseId);
        }
      }
    }
    for (const toolUseId of proposed) {
      expect(settled.has(toolUseId), toolUseId).toBe(true);
    }
  });

  it("links the three spawned agents' missions to their SubagentStart ids", () => {
    const missionIds = new Set<string>();
    const startedIds = new Set<string>();
    for (const { result } of normalized) {
      for (const event of result.events) {
        if (event.kind === "agent.mission") missionIds.add(event.agentId);
        if (event.kind === "agent.started") startedIds.add(event.agentId);
      }
    }
    expect([...missionIds].sort()).toEqual(["agt_a1", "agt_b2", "agt_c3"]);
    expect(missionIds).toEqual(startedIds);
  });
});
