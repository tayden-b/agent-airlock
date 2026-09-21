/**
 * Secret patterns applied in order. Specific vendor formats come before
 * generic ones (e.g. anthropic before openai, both `sk-` prefixed) so the
 * first match wins and a secret is never labelled twice.
 */

export interface SecretPattern {
  kind: string;
  regex: RegExp;
  /** Builds the replacement; receives the match and its capture groups. */
  replace: (match: string, ...groups: string[]) => string;
}

export const REDACTED_PREFIX = "[REDACTED";

const placeholder = (kind: string): string => `${REDACTED_PREFIX}:${kind}]`;

const wholeMatch = (kind: string) => (): string => placeholder(kind);

const SECRET_KEY_NAMES =
  "password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth";

/** Values that are already scrubbed or are documentation placeholders. */
const PLACEHOLDER_VALUE = /^(<.*>|\$\{.*\}|\*+|\[REDACTED.*)$/;

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    kind: "private_key_block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: wholeMatch("private_key_block"),
  },
  {
    kind: "aws_access_key",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: wholeMatch("aws_access_key"),
  },
  {
    kind: "github_token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: wholeMatch("github_token"),
  },
  {
    kind: "anthropic_key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    replace: wholeMatch("anthropic_key"),
  },
  {
    kind: "openai_key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: wholeMatch("openai_key"),
  },
  {
    kind: "slack_token",
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: wholeMatch("slack_token"),
  },
  {
    kind: "google_api_key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: wholeMatch("google_api_key"),
  },
  {
    kind: "typesafe_key",
    regex: /\bts_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    replace: wholeMatch("typesafe_key"),
  },
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: wholeMatch("jwt"),
  },
  {
    kind: "bearer_token",
    regex: /\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: (_match, prefix) => `${prefix}${placeholder("bearer_token")}`,
  },
  {
    kind: "url_credentials",
    regex: /:\/\/[^\s/:@]+:[^\s/@]+@/g,
    replace: () => `://${placeholder("url_credentials")}@`,
  },
  {
    kind: "secret_assignment",
    // Group 1 is key + separator + opening quote (kept), group 2 is the value.
    // `[REDACTED` is excluded from the value so an earlier pattern's output is
    // not redacted a second time under this kind.
    regex: new RegExp(
      `(\\b(?:${SECRET_KEY_NAMES})\\b["']?\\s*[:=]\\s*["']?)([^\\s"',;]{6,})`,
      "gi",
    ),
    replace: (match, prefix, value) =>
      PLACEHOLDER_VALUE.test(value) ? match : `${prefix}${placeholder("secret_assignment")}`,
  },
];
