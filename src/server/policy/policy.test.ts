import { describe, expect, it } from "vitest";
import { AssessmentSchema } from "@/contracts";
import type { DimensionName, DimensionScore, DimensionScores, RuleHit } from "@/contracts";
import { buildConfig } from "@/server/config";
import type { PolicyConfig } from "@/server/config";
import type { ProviderAssessment } from "@/server/classifiers/types";
import {
  DEFAULT_DIMENSION,
  buildAssessment,
  combineProviders,
  decide,
} from "./index";

const basePolicy = buildConfig().policy;

function policyWith(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return { ...basePolicy, ...overrides };
}

function score(partial: Partial<DimensionScore> = {}): DimensionScore {
  return { risk: 0.1, confidence: 0.9, source: "rules", ...partial };
}

function dimensions(
  overrides: Partial<Record<DimensionName, DimensionScore>> = {},
): DimensionScores {
  return {
    scope: score(),
    exposure: score(),
    impact: score(),
    reversibility: score(),
    ...overrides,
  };
}

function provider(
  partial: Partial<ProviderAssessment> & Pick<ProviderAssessment, "provider">,
): ProviderAssessment {
  return { dimensions: {}, ruleHits: [], latencyMs: 0, ...partial };
}

function hit(partial: Partial<RuleHit> & Pick<RuleHit, "ruleId">): RuleHit {
  return { message: "hit", dimensions: {}, ...partial };
}

describe("combineProviders", () => {
  it("fills every dimension with the default when no providers supply it", () => {
    const combined = combineProviders([]);
    expect(combined.scope).toEqual(DEFAULT_DIMENSION);
    expect(combined.exposure).toEqual(DEFAULT_DIMENSION);
    expect(combined.impact).toEqual(DEFAULT_DIMENSION);
    expect(combined.reversibility).toEqual(DEFAULT_DIMENSION);
  });

  it("fills only the dimensions a provider left undefined", () => {
    const combined = combineProviders([
      provider({ provider: "rules", dimensions: { scope: score({ risk: 0.7 }) } }),
    ]);
    expect(combined.scope).toEqual(score({ risk: 0.7 }));
    expect(combined.impact).toEqual(DEFAULT_DIMENSION);
  });

  it("copies a single provider's dimension verbatim", () => {
    const supplied: DimensionScore = {
      risk: 0.42,
      confidence: 0.77,
      source: "jev",
      probabilities: { allow: 0.6, deny: 0.4 },
    };
    const combined = combineProviders([
      provider({ provider: "jev", dimensions: { exposure: supplied } }),
    ]);
    expect(combined.exposure).toEqual(supplied);
  });

  it("picks the highest risk across providers, marks source combined, keeps winner confidence", () => {
    const combined = combineProviders([
      provider({
        provider: "rules",
        dimensions: { impact: score({ risk: 0.3, confidence: 0.9 }) },
      }),
      provider({
        provider: "jev",
        dimensions: { impact: score({ risk: 0.6, confidence: 0.55, source: "jev" }) },
      }),
    ]);
    expect(combined.impact.risk).toBe(0.6);
    expect(combined.impact.confidence).toBe(0.55);
    expect(combined.impact.source).toBe("combined");
  });

  it("breaks risk ties in favor of the earlier provider", () => {
    const combined = combineProviders([
      provider({
        provider: "rules",
        dimensions: { scope: score({ risk: 0.5, confidence: 0.8 }) },
      }),
      provider({
        provider: "jev",
        dimensions: { scope: score({ risk: 0.5, confidence: 0.4, source: "jev" }) },
      }),
    ]);
    expect(combined.scope.confidence).toBe(0.8);
    expect(combined.scope.source).toBe("combined");
  });

  it("clamps risk and confidence to [0,1] and rounds to two decimals", () => {
    const combined = combineProviders([
      provider({
        provider: "rules",
        dimensions: {
          scope: score({ risk: 1.234, confidence: -0.4 }),
          exposure: score({ risk: 0.126, confidence: 0.555 }),
        },
      }),
    ]);
    expect(combined.scope.risk).toBe(1);
    expect(combined.scope.confidence).toBe(0);
    expect(combined.exposure.risk).toBe(0.13);
    expect(combined.exposure.confidence).toBe(0.56);
  });
});

describe("decide", () => {
  it("force-denies on a listed rule even when scores are low, and sets forcedBy", () => {
    const decision = decide(
      dimensions(),
      [hit({ ruleId: "shell.pipe_to_shell", message: "curl piped to sh" })],
      basePolicy,
    );
    expect(decision.verdict).toBe("deny");
    expect(decision.forcedBy).toBe("shell.pipe_to_shell");
    expect(decision.reason).toBe(
      "Would deny: rule shell.pipe_to_shell is on the force-deny list — curl piped to sh",
    );
  });

  it("denies at the deny threshold and appends the strongest hit's message", () => {
    const decision = decide(
      dimensions({ impact: score({ risk: 0.9 }) }),
      [
        hit({ ruleId: "a", message: "weak signal", dimensions: { impact: 0.2 } }),
        hit({ ruleId: "b", message: "deletes production data", dimensions: { impact: 0.9 } }),
      ],
      basePolicy,
    );
    expect(decision.verdict).toBe("deny");
    expect(decision.drivingDimension).toBe("impact");
    expect(decision.reason).toBe("Would deny: impact 0.90 ≥ 0.80 — deletes production data");
  });

  it("denies at the deny threshold without a trailing clause when no hit supports the dimension", () => {
    const decision = decide(dimensions({ scope: score({ risk: 0.85 }) }), [], basePolicy);
    expect(decision.reason).toBe("Would deny: scope 0.85 ≥ 0.80");
  });

  it("reviews at the review threshold", () => {
    const decision = decide(dimensions({ exposure: score({ risk: 0.65 }) }), [], basePolicy);
    expect(decision.verdict).toBe("review");
    expect(decision.reason).toBe("Would review: exposure 0.65 ≥ 0.50");
  });

  it("reviews when the driving dimension's confidence is below minConfidenceForAllow", () => {
    const decision = decide(
      dimensions({ scope: score({ risk: 0.3, confidence: 0.4 }) }),
      [],
      basePolicy,
    );
    expect(decision.verdict).toBe("review");
    expect(decision.reason).toBe(
      "Would review: low confidence 0.40 < 0.60 on scope (risk 0.30)",
    );
  });

  it("allows when risk and confidence clear every threshold", () => {
    const decision = decide(
      dimensions({ impact: score({ risk: 0.3, confidence: 0.95 }) }),
      [],
      basePolicy,
    );
    expect(decision.verdict).toBe("allow");
    expect(decision.reason).toBe("Would allow: max risk 0.30 (impact) below 0.50");
  });

  it("breaks cross-dimension risk ties by DIMENSIONS order", () => {
    const decision = decide(
      dimensions({
        scope: score({ risk: 0.9 }),
        impact: score({ risk: 0.9 }),
        reversibility: score({ risk: 0.9 }),
      }),
      [],
      basePolicy,
    );
    expect(decision.drivingDimension).toBe("scope");
  });

  it("rounds maxRisk to two decimals on the decision", () => {
    const decision = decide(dimensions({ scope: score({ risk: 0.899 }) }), [], basePolicy);
    expect(decision.maxRisk).toBe(0.9);
  });

  it("formats all numbers in reasons with exactly two decimals", () => {
    const decision = decide(dimensions({ impact: score({ risk: 0.9 }) }), [], basePolicy);
    expect(decision.reason).toContain("0.90");
    expect(decision.reason).toContain("0.80");
    expect(decision.reason).not.toMatch(/(?<![\d.])0\.9(?!\d)/);
  });

  it("truncates an over-long supporting message with an ellipsis and stays under 200 chars", () => {
    const longMessage = "x".repeat(300);
    const decision = decide(
      dimensions({ impact: score({ risk: 0.9 }) }),
      [hit({ ruleId: "b", message: longMessage, dimensions: { impact: 0.9 } })],
      basePolicy,
    );
    expect(decision.reason.length).toBeLessThanOrEqual(200);
    expect(decision.reason.endsWith("…")).toBe(true);
    expect(decision.reason).toContain("Would deny: impact 0.90 ≥ 0.80 — ");
  });

  it("ignores hits that do not score the driving dimension", () => {
    const decision = decide(
      dimensions({ impact: score({ risk: 0.9 }) }),
      [hit({ ruleId: "a", message: "scopes only", dimensions: { scope: 1 } })],
      basePolicy,
    );
    expect(decision.reason).toBe("Would deny: impact 0.90 ≥ 0.80");
  });

  it("respects overridden thresholds", () => {
    const strict = policyWith({ thresholds: { deny: 0.4, review: 0.2 } });
    const decision = decide(dimensions({ scope: score({ risk: 0.45 }) }), [], strict);
    expect(decision.verdict).toBe("deny");
    expect(decision.reason).toBe("Would deny: scope 0.45 ≥ 0.40");
  });
});

describe("buildAssessment", () => {
  const params = {
    id: "asmt_1",
    actionId: "act_1",
    policy: basePolicy,
    assessedAt: "2026-09-21T00:00:00.000Z",
  };

  it("returns an object that parses against AssessmentSchema", () => {
    const assessment = buildAssessment({
      ...params,
      providerAssessments: [
        provider({
          provider: "rules",
          dimensions: { impact: score({ risk: 0.9 }) },
          ruleHits: [hit({ ruleId: "r1", message: "boom", dimensions: { impact: 0.9 } })],
          latencyMs: 12,
        }),
      ],
    });
    expect(() => AssessmentSchema.parse(assessment)).not.toThrow();
    expect(assessment.policyVersion).toBe(basePolicy.version);
    expect(assessment.verdict).toBe("deny");
    expect(assessment.reason).toBe("Would deny: impact 0.90 ≥ 0.80 — boom");
  });

  it("dedupes rule hits by ruleId, keeping the first occurrence", () => {
    const assessment = buildAssessment({
      ...params,
      providerAssessments: [
        provider({
          provider: "rules",
          ruleHits: [hit({ ruleId: "r1", message: "first" })],
        }),
        provider({
          provider: "jev",
          ruleHits: [
            hit({ ruleId: "r1", message: "second" }),
            hit({ ruleId: "r2", message: "other" }),
          ],
        }),
      ],
    });
    expect(assessment.ruleHits.map((h) => h.ruleId)).toEqual(["r1", "r2"]);
    expect(assessment.ruleHits[0]?.message).toBe("first");
  });

  it("sums provider latencies rounded to a non-negative integer", () => {
    const assessment = buildAssessment({
      ...params,
      providerAssessments: [
        provider({ provider: "rules", latencyMs: 12.4 }),
        provider({ provider: "jev", latencyMs: 3.6 }),
      ],
    });
    expect(assessment.latencyMs).toBe(16);
  });

  it("lists unique provider names in assessment order", () => {
    const assessment = buildAssessment({
      ...params,
      providerAssessments: [
        provider({ provider: "rules" }),
        provider({ provider: "jev" }),
        provider({ provider: "rules" }),
      ],
    });
    expect(assessment.providers).toEqual(["rules", "jev"]);
  });

  it("defaults assessedAt to the current time when omitted", () => {
    const before = new Date().toISOString();
    const assessment = buildAssessment({
      id: params.id,
      actionId: params.actionId,
      policy: params.policy,
      providerAssessments: [provider({ provider: "rules" })],
    });
    expect(assessment.assessedAt >= before).toBe(true);
  });
});
