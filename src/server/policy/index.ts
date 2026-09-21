import { AssessmentSchema, DIMENSIONS } from "@/contracts";
import type {
  Assessment,
  DimensionName,
  DimensionScore,
  DimensionScores,
  RuleHit,
  Verdict,
} from "@/contracts";
import type { PolicyConfig } from "@/server/config";
import type { ProviderAssessment } from "@/server/classifiers/types";

export const DEFAULT_DIMENSION: DimensionScore = {
  risk: 0.05,
  confidence: 0.5,
  source: "default",
};

const MAX_REASON_LENGTH = 200;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const round2 = (n: number): number => Math.round(n * 100) / 100;

const fmt = (n: number): string => n.toFixed(2);

function normalize(score: DimensionScore): DimensionScore {
  const next: DimensionScore = { ...score, risk: round2(clamp01(score.risk)) };
  if (score.confidence !== undefined) {
    next.confidence = round2(clamp01(score.confidence));
  }
  return next;
}

export function combineProviders(assessments: ProviderAssessment[]): DimensionScores {
  const combined = {} as Record<DimensionName, DimensionScore>;
  for (const dim of DIMENSIONS) {
    const supplied = assessments
      .map((a) => a.dimensions[dim])
      .filter((d): d is DimensionScore => d !== undefined);
    if (supplied.length === 0) {
      combined[dim] = { ...DEFAULT_DIMENSION };
    } else if (supplied.length === 1) {
      const only = supplied[0];
      combined[dim] = normalize(only);
    } else {
      let winner = supplied[0];
      for (const candidate of supplied.slice(1)) {
        if (candidate.risk > winner.risk) winner = candidate;
      }
      combined[dim] = normalize({ ...winner, source: "combined" });
    }
  }
  return combined;
}

export interface Decision {
  verdict: Verdict;
  reason: string;
  maxRisk: number;
  drivingDimension: DimensionName;
  forcedBy?: string;
}

function drivingOf(dimensions: DimensionScores): { dim: DimensionName; risk: number } {
  let dim: DimensionName = DIMENSIONS[0];
  let risk = dimensions[dim].risk;
  for (const name of DIMENSIONS.slice(1)) {
    if (dimensions[name].risk > risk) {
      dim = name;
      risk = dimensions[name].risk;
    }
  }
  return { dim, risk };
}

function strongestHit(ruleHits: RuleHit[], dim: DimensionName): RuleHit | undefined {
  let best: RuleHit | undefined;
  for (const hit of ruleHits) {
    const value = hit.dimensions[dim];
    if (value === undefined) continue;
    if (!best || value > (best.dimensions[dim] ?? -1)) best = hit;
  }
  return best;
}

function appendWhy(base: string, why: string): string {
  const separator = " — ";
  if (base.length + separator.length + why.length <= MAX_REASON_LENGTH) {
    return base + separator + why;
  }
  const room = MAX_REASON_LENGTH - base.length - separator.length - 1;
  if (room <= 0) return base.slice(0, MAX_REASON_LENGTH);
  return `${base}${separator}${why.slice(0, room)}…`;
}

export function decide(
  dimensions: DimensionScores,
  ruleHits: RuleHit[],
  policy: PolicyConfig,
): Decision {
  const { dim, risk } = drivingOf(dimensions);
  const maxRisk = round2(risk);

  for (const hit of ruleHits) {
    if (policy.forceDenyRules.includes(hit.ruleId)) {
      return {
        verdict: "deny",
        reason: appendWhy(`Would deny: rule ${hit.ruleId} is on the force-deny list`, hit.message),
        maxRisk,
        drivingDimension: dim,
        forcedBy: hit.ruleId,
      };
    }
  }

  const why = strongestHit(ruleHits, dim)?.message;

  if (maxRisk >= policy.thresholds.deny) {
    const base = `Would deny: ${dim} ${fmt(maxRisk)} ≥ ${fmt(policy.thresholds.deny)}`;
    return {
      verdict: "deny",
      reason: why ? appendWhy(base, why) : base,
      maxRisk,
      drivingDimension: dim,
    };
  }

  if (maxRisk >= policy.thresholds.review) {
    const base = `Would review: ${dim} ${fmt(maxRisk)} ≥ ${fmt(policy.thresholds.review)}`;
    return {
      verdict: "review",
      reason: why ? appendWhy(base, why) : base,
      maxRisk,
      drivingDimension: dim,
    };
  }

  const confidence = dimensions[dim].confidence;
  if (confidence !== undefined && confidence < policy.minConfidenceForAllow) {
    return {
      verdict: "review",
      reason: `Would review: low confidence ${fmt(confidence)} < ${fmt(
        policy.minConfidenceForAllow,
      )} on ${dim} (risk ${fmt(maxRisk)})`,
      maxRisk,
      drivingDimension: dim,
    };
  }

  return {
    verdict: "allow",
    reason: `Would allow: max risk ${fmt(maxRisk)} (${dim}) below ${fmt(policy.thresholds.review)}`,
    maxRisk,
    drivingDimension: dim,
  };
}

export function buildAssessment(params: {
  id: string;
  actionId: string;
  providerAssessments: ProviderAssessment[];
  policy: PolicyConfig;
  assessedAt?: string;
}): Assessment {
  const dimensions = combineProviders(params.providerAssessments);

  const seen = new Set<string>();
  const ruleHits: RuleHit[] = [];
  for (const assessment of params.providerAssessments) {
    for (const hit of assessment.ruleHits) {
      if (seen.has(hit.ruleId)) continue;
      seen.add(hit.ruleId);
      ruleHits.push(hit);
    }
  }

  const providers = [...new Set(params.providerAssessments.map((a) => a.provider))];
  const latencyMs = Math.max(
    0,
    Math.round(params.providerAssessments.reduce((sum, a) => sum + a.latencyMs, 0)),
  );

  const decision = decide(dimensions, ruleHits, params.policy);

  return AssessmentSchema.parse({
    id: params.id,
    actionId: params.actionId,
    policyVersion: params.policy.version,
    verdict: decision.verdict,
    reason: decision.reason,
    dimensions,
    ruleHits,
    providers,
    latencyMs,
    assessedAt: params.assessedAt ?? new Date().toISOString(),
  });
}
