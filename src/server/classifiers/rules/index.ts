import { DIMENSIONS } from "@/contracts";
import type { DimensionName, DimensionScore, RuleHit } from "@/contracts";
import type { AssessmentInput, Classifier, ProviderAssessment } from "../types";
import { BASELINES } from "./baselines";
import { RULES, buildContext } from "./definitions";

/**
 * Confidence is fixed: every score this classifier emits comes from a
 * deterministic pattern match, so the value communicates provenance rather
 * than uncertainty. Rule-touched dimensions get 0.9 (specific evidence fired);
 * baseline-only dimensions get 0.7 (kind-level prior, nothing matched).
 */
const BASELINE_CONFIDENCE = 0.7;
const RULE_HIT_CONFIDENCE = 0.9;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Deterministic rules provider. Starts from the per-ToolKind baseline, adds
 * every fired rule's per-dimension delta (clamped to [0,1]), and reports all
 * four dimensions so the policy layer never has to default them.
 */
export const rulesClassifier: Classifier = {
  name: "rules",
  async assess(input: AssessmentInput): Promise<ProviderAssessment> {
    const startedAt = performance.now();
    const ctx = buildContext(input);

    const risk: Record<DimensionName, number> = {
      scope: BASELINES[input.action.toolKind].scope.risk,
      exposure: BASELINES[input.action.toolKind].exposure.risk,
      impact: BASELINES[input.action.toolKind].impact.risk,
      reversibility: BASELINES[input.action.toolKind].reversibility.risk,
    };
    const touched = new Set<DimensionName>();
    const ruleHits: RuleHit[] = [];

    for (const rule of RULES) {
      if (!rule.test(ctx)) continue;
      ruleHits.push({ ruleId: rule.id, message: rule.message, dimensions: rule.dimensions });
      for (const dim of DIMENSIONS) {
        const delta = rule.dimensions[dim];
        if (delta === undefined) continue;
        risk[dim] = clamp01(risk[dim] + delta);
        touched.add(dim);
      }
    }

    const dimensions = {} as Record<DimensionName, DimensionScore>;
    for (const dim of DIMENSIONS) {
      dimensions[dim] = {
        risk: round2(risk[dim]),
        confidence: touched.has(dim) ? RULE_HIT_CONFIDENCE : BASELINE_CONFIDENCE,
        source: "rules",
      };
    }

    return {
      provider: "rules",
      dimensions,
      ruleHits,
      latencyMs: Math.max(0, performance.now() - startedAt),
    };
  },
};
