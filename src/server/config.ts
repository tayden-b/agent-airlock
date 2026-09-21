import { z } from "zod";
import { ProviderNameSchema } from "@/contracts";
import userConfig from "../../airlock.config";

/**
 * Typed configuration. `airlock.config.ts` at the repo root is the single
 * place operators edit; a few values can be overridden by environment
 * variables so Devin's VM, CI and a laptop can differ without code changes.
 */

export const PolicyConfigSchema = z
  .object({
    /** Bumped whenever thresholds or rules change; stored on every assessment. */
    version: z.string().min(1),
    thresholds: z.object({
      /** max dimension risk at or above this => deny */
      deny: z.number().min(0).max(1),
      /** max dimension risk at or above this => review */
      review: z.number().min(0).max(1),
    }),
    /** An "allow" whose driving dimension has lower confidence is downgraded to review. */
    minConfidenceForAllow: z.number().min(0).max(1),
    /** Rule ids that force a deny regardless of scores. */
    forceDenyRules: z.array(z.string()),
  })
  .refine((p) => p.thresholds.review <= p.thresholds.deny, {
    message: "thresholds.review must be <= thresholds.deny",
  });
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export const RedactionConfigSchema = z.object({
  maxStringLength: z.number().int().positive(),
  previewLength: z.number().int().positive(),
  maxArrayLength: z.number().int().positive(),
  maxDepth: z.number().int().positive(),
});
export type RedactionConfig = z.infer<typeof RedactionConfigSchema>;

export const AirlockConfigSchema = z.object({
  policy: PolicyConfigSchema,
  redaction: RedactionConfigSchema,
  classifier: z.object({
    /** Providers run in order; "rules" is always available and should stay first. */
    providers: z.array(ProviderNameSchema).min(1),
  }),
  stream: z.object({
    heartbeatMs: z.number().int().positive(),
  }),
  storage: z.object({
    /** libsql URL, e.g. file:./data/airlock.db or libsql://…turso.io */
    url: z.string().min(1),
    /** Auth token for remote libsql endpoints (e.g. Turso). */
    authToken: z.string().optional(),
  }),
});
export type AirlockConfig = z.infer<typeof AirlockConfigSchema>;

function applyEnvOverrides(config: AirlockConfig, env: NodeJS.ProcessEnv): AirlockConfig {
  const next: AirlockConfig = structuredClone(config);
  if (env.AIRLOCK_DATABASE_URL) next.storage.url = env.AIRLOCK_DATABASE_URL;
  if (env.AIRLOCK_DATABASE_AUTH_TOKEN) next.storage.authToken = env.AIRLOCK_DATABASE_AUTH_TOKEN;
  if (env.AIRLOCK_CLASSIFIER) {
    const providers = env.AIRLOCK_CLASSIFIER.split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    next.classifier.providers = z.array(ProviderNameSchema).min(1).parse(providers);
  }
  return next;
}

const globalKey = "__airlockConfig" as const;
type ConfigGlobal = typeof globalThis & { [globalKey]?: AirlockConfig };

/** Validated config, cached per process (survives Next.js dev-mode module reloads). */
export function getConfig(): AirlockConfig {
  const g = globalThis as ConfigGlobal;
  if (!g[globalKey]) {
    g[globalKey] = applyEnvOverrides(AirlockConfigSchema.parse(userConfig), process.env);
  }
  return g[globalKey];
}

/** Test helper: build a config without touching the process-wide cache. */
export function buildConfig(overrides: Partial<AirlockConfig> = {}): AirlockConfig {
  return AirlockConfigSchema.parse({ ...userConfig, ...overrides });
}
