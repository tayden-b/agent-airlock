import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/contracts";
import { normalizeClaudeCodeEvent } from "@/adapters/claude-code/normalize";
import { publishStream, subscribeStream } from "@/server/bus";
import { createTestDb, type AirlockDb } from "@/server/storage/client";
import { getRunSnapshot, listRunSummaries } from "@/server/storage/repository";
import { ingestEvent } from "./index";

// Deterministic scoring: rules only, no live Jev calls in tests.
beforeAll(() => {
  vi.stubEnv("AIRLOCK_CLASSIFIER", "rules");
});

const fanoutPath = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "sessions",
  "research-fanout.jsonl",
);

async function replayFixture(db: AirlockDb): Promise<string> {
  const lines = readFileSync(fanoutPath, "utf8").trim().split("\n");
  for (const line of lines) {
    const result = normalizeClaudeCodeEvent(JSON.parse(line), {
      receivedAt: "2026-09-21T10:15:00.000Z",
    });
    expect(result.error).toBeUndefined();
    for (const event of result.events) {
      await ingestEvent(event, { db, awaitAssessment: true });
    }
  }
  return "claude-code:sess_fanout_01";
}

describe("ingestEvent over research-fanout.jsonl", () => {
  it("builds a complete snapshot: run, four agents, fifteen assessed actions", async () => {
    const db = await createTestDb();
    const runId = await replayFixture(db);

    const snapshot = await getRunSnapshot(runId, db);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.run.status).toBe("ended");
    expect(snapshot!.run.mission).toContain("auth middleware");
    expect(snapshot!.run.cwd).toBe("/Users/dev/acme");

    const agentIds = snapshot!.agents.map((a) => a.agentId).sort();
    expect(agentIds).toEqual(["agt_a1", "agt_b2", "agt_c3", "main"]);
    for (const sub of ["agt_a1", "agt_b2", "agt_c3"]) {
      const agent = snapshot!.agents.find((a) => a.agentId === sub)!;
      expect(agent.parentAgentId).toBe("main");
      expect(agent.mission).toBeTruthy();
      expect(agent.status).toBe("completed");
    }

    expect(snapshot!.actions).toHaveLength(15);
    for (const action of snapshot!.actions) {
      expect(action.assessment).not.toBeNull();
      expect(action.outcome).not.toBeNull();
    }
  });

  it("produces the expected verdicts end to end", async () => {
    const db = await createTestDb();
    const runId = await replayFixture(db);
    const snapshot = await getRunSnapshot(runId, db);

    const bySummary = new Map(snapshot!.actions.map((a) => [a.inputSummary, a]));
    const verdictOf = (prefix: string) =>
      snapshot!.actions.find((a) => a.inputSummary.startsWith(prefix))?.assessment?.verdict;

    expect(verdictOf("Bash: git push --force")).toBe("deny");
    expect(verdictOf("Bash: curl -X POST https://webhook.site")).toBe("review");
    expect(verdictOf("Bash: rm -rf .next")).toBe("review");
    expect(verdictOf("Read: /Users/dev/acme/.env")).toBe("review");
    expect(verdictOf("Read: /Users/dev/acme/src/auth/middleware.ts")).toBe("allow");
    expect(verdictOf("github/list_issues")).toBe("allow");
    expect(verdictOf("Write: /Users/dev/acme/docs/plan.md")).toBe("allow");
    expect(bySummary.size).toBe(15);
  });

  it("redacts secrets inside persisted tool input", async () => {
    const db = await createTestDb();
    const result = normalizeClaudeCodeEvent({
      session_id: "sess_secret",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH1234" },
      tool_use_id: "toolu_secret",
    });
    for (const event of result.events) {
      await ingestEvent(event, { db, awaitAssessment: true });
    }
    const snapshot = await getRunSnapshot("claude-code:sess_secret", db);
    const stored = JSON.stringify(snapshot!.actions[0]!.input);
    expect(stored).not.toContain("sk-ant-api03");
    expect(stored).toContain("[REDACTED:");
  });

  it("publishes an upsert for every row written", async () => {
    const db = await createTestDb();
    const seen: StreamEvent[] = [];
    const unsubscribe = subscribeStream((e) => seen.push(e));
    try {
      await replayFixture(db);
    } finally {
      unsubscribe();
    }
    const types = seen.map((e) => e.type);
    expect(types).toContain("run.upserted");
    expect(types).toContain("agent.upserted");
    expect(types.filter((t) => t === "action.upserted").length).toBeGreaterThanOrEqual(15);
    // each assessed action publishes twice: once when the assessment lands,
    // once when completion republishes the row (assessment already attached)
    const assessed = seen.filter(
      (e) => e.type === "action.upserted" && e.action.assessment !== null,
    );
    expect(assessed.length).toBe(30);
  });

  it("listRunSummaries reports verdict tallies with pending count", async () => {
    const db = await createTestDb();
    const runId = await replayFixture(db);
    const summaries = await listRunSummaries(50, db);
    const summary = summaries.find((s) => s.run.id === runId)!;
    expect(summary.agents).toBe(4);
    expect(summary.actions).toBe(15);
    expect(summary.verdicts.pending).toBe(0);
    expect(summary.verdicts.deny).toBe(1);
    expect(summary.verdicts.review).toBe(3);
    expect(summary.verdicts.allow).toBe(11);
  });
});

describe("ingestEvent edge cases", () => {
  it("accepts a PostToolUse without its PreToolUse", async () => {
    const db = await createTestDb();
    const result = normalizeClaudeCodeEvent({
      session_id: "sess_orphan",
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/x.ts" },
      tool_use_id: "toolu_orphan",
      tool_response: { type: "text", file: {} },
    });
    for (const event of result.events) {
      await ingestEvent(event, { db, awaitAssessment: true });
    }
    const snapshot = await getRunSnapshot("claude-code:sess_orphan", db);
    expect(snapshot!.actions).toHaveLength(1);
    expect(snapshot!.actions[0]!.outcome).toBe("success");
    expect(snapshot!.actions[0]!.assessment).not.toBeNull();
  });

  it("a second subscriber after replay still gets new events", async () => {
    const seen: StreamEvent[] = [];
    subscribeStream((e) => seen.push(e));
    publishStream({ type: "heartbeat", at: "x" });
    expect(seen).toHaveLength(1);
  });
});
