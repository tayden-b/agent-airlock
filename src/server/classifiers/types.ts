import type {
  Action,
  Agent,
  DimensionName,
  DimensionScore,
  ProviderName,
  RuleHit,
  Run,
} from "@/contracts";

/** Everything a classifier may look at. Inputs are already redacted. */
export interface AssessmentInput {
  action: Action;
  agent: Agent;
  run: Run;
}

/**
 * One provider's opinion. Providers may leave dimensions undefined when they
 * have nothing to say; the policy layer fills defaults and combines providers.
 */
export interface ProviderAssessment {
  provider: ProviderName;
  dimensions: Partial<Record<DimensionName, DimensionScore>>;
  ruleHits: RuleHit[];
  latencyMs: number;
}

export interface Classifier {
  readonly name: ProviderName;
  assess(input: AssessmentInput): Promise<ProviderAssessment>;
}
