import type { AirlockConfig } from "@/server/config";

/**
 * Airlock configuration. Edit here, not in the UI.
 *
 * Environment overrides (see .env.example):
 *   AIRLOCK_DATABASE_URL  -> storage.url
 *   AIRLOCK_CLASSIFIER    -> classifier.providers (comma-separated, e.g. "rules")
 *   TYPESAFE_API_KEY      -> required for the "jev" provider; without it Jev is skipped
 */
const config: AirlockConfig = {
  policy: {
    version: "2026.09.21-1",
    thresholds: {
      deny: 0.8,
      review: 0.5,
    },
    minConfidenceForAllow: 0.6,
    forceDenyRules: ["shell.pipe_to_shell"],
  },
  redaction: {
    maxStringLength: 2000,
    previewLength: 400,
    maxArrayLength: 50,
    maxDepth: 6,
  },
  classifier: {
    providers: ["rules", "jev"],
  },
  stream: {
    heartbeatMs: 15_000,
  },
  storage: {
    url: "file:./data/airlock.db",
  },
};

export default config;
