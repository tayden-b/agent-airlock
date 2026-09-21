import { describe, expect, it } from "vitest";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { ActionSchema, AgentSchema, RunSchema } from "@/contracts";
import type { Action } from "@/contracts";
import { createJevClassifier, jevClassifier } from "./index";

const run = RunSchema.parse({
  id: "claude-code:sess_1",
  source: "claude-code",
  sessionId: "sess_1",
  cwd: "/Users/dev/acme",
  mission: "Fix token refresh",
  status: "active",
  startedAt: "2026-09-21T10:00:00.000Z",
  endedAt: null,
  updatedAt: "2026-09-21T10:00:00.000Z",
});

const agent = AgentSchema.parse({
  id: "claude-code:sess_1:main",
  runId: run.id,
  agentId: "main",
  agentType: "main",
  parentAgentId: null,
  mission: null,
  description: null,
  status: "running",
  startedAt: "2026-09-21T10:00:00.000Z",
  endedAt: null,
  updatedAt: "2026-09-21T10:00:00.000Z",
});

const action: Action = ActionSchema.parse({
  id: `${run.id}:toolu_1`,
  runId: run.id,
  agentId: agent.id,
  toolUseId: "toolu_1",
  toolName: "Bash",
  toolKind: "shell",
  input: { command: "rm -rf /Users/dev/acme" },
  inputSummary: "Bash: rm -rf /Users/dev/acme",
  mcpServer: null,
  proposedAt: "2026-09-21T10:00:01.000Z",
  completedAt: null,
  outcome: null,
  resultPreview: null,
  error: null,
  updatedAt: "2026-09-21T10:00:01.000Z",
  assessment: null,
});

const LEGEND = { "0": "None", "1": "Low", "2": "Moderate", "3": "High", "4": "Severe" };

function scoreAnswer(value: number, confidence = 0.9) {
  const probabilities: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0 };
  probabilities[String(Math.round(value))] = 1;
  return { type: "score", score: value, confidence, legend: LEGEND, probabilities };
}

function fakeClient(body: unknown, captured?: { payload?: Record<string, unknown> }) {
  const fetchImpl = async (_input: string, init?: RequestInit): Promise<Response> => {
    if (captured && init?.body) captured.payload = JSON.parse(String(init.body));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return new TypeSafeClient({ apiKey: "test-key", fetch: fetchImpl });
}

const okBody = {
  model: "jev-latest",
  answers: {
    scope: scoreAnswer(1.2, 0.8),
    exposure: scoreAnswer(0.4, 0.95),
    impact: scoreAnswer(3.6, 0.88),
    reversibility: scoreAnswer(4, 1),
  },
  usage: { input_tokens: 100, output_tokens: 20 },
};

describe("createJevClassifier", () => {
  it("maps Jev score answers onto DimensionScores", async () => {
    const classifier = createJevClassifier(fakeClient(okBody));
    const result = await classifier.assess({ action, agent, run });

    expect(result.provider).toBe("jev");
    expect(result.ruleHits).toEqual([]);
    expect(result.dimensions.scope?.risk).toBeCloseTo(0.3); // 1.2 / 4
    expect(result.dimensions.exposure?.risk).toBeCloseTo(0.1); // 0.4 / 4
    expect(result.dimensions.impact?.risk).toBeCloseTo(0.9); // 3.6 / 4
    expect(result.dimensions.reversibility?.risk).toBe(1); // 4 / 4
    expect(result.dimensions.impact?.confidence).toBe(0.88);
    expect(result.dimensions.impact?.source).toBe("jev");
    expect(result.dimensions.reversibility?.probabilities?.["4"]).toBe(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends one score question per dimension over the action's redacted state", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    const classifier = createJevClassifier(fakeClient(okBody, captured));
    await classifier.assess({ action, agent, run });

    const payload = captured.payload as {
      model: string;
      state: { action: { tool: string; input: { command: string } }; run: { mission: string } };
      questions: Record<string, { type: string; criteria: string[] }>;
    };
    expect(payload.model).toBe("jev-latest");
    expect(Object.keys(payload.questions).sort()).toEqual(
      ["exposure", "impact", "reversibility", "scope"].sort(),
    );
    for (const q of Object.values(payload.questions)) {
      expect(q.type).toBe("score");
      expect(q.criteria).toHaveLength(5);
    }
    expect(payload.state.action.tool).toBe("Bash");
    expect(payload.state.action.input.command).toBe("rm -rf /Users/dev/acme");
    expect(payload.state.run.mission).toBe("Fix token refresh");
  });

  it("propagates API errors so the runner can skip the provider", async () => {
    const client = new TypeSafeClient({
      apiKey: "test-key",
      retry: { maxRetries: 0 },
      fetch: async () => new Response("nope", { status: 500 }),
    });
    const classifier = createJevClassifier(client);
    await expect(classifier.assess({ action, agent, run })).rejects.toThrow();
  });
});

describe("jevClassifier (default)", () => {
  it("throws when TYPESAFE_API_KEY is not configured", async () => {
    const original = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    (globalThis as Record<string, unknown>).__airlockJev = undefined;
    try {
      await expect(jevClassifier.assess({ action, agent, run })).rejects.toThrow();
    } finally {
      if (original !== undefined) process.env.TYPESAFE_API_KEY = original;
      (globalThis as Record<string, unknown>).__airlockJev = undefined;
    }
  });
});
