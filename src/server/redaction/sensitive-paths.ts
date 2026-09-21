/**
 * Paths whose contents are credentials or private state. Used by both
 * redaction (to flag) and the rules classifier (to score exposure).
 * Matching is on the path string only; nothing is read from disk.
 */

const BASENAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^credentials(\.json|\.ya?ml)?$/i,
  /^service[-_]?account.*\.json$/i,
  /^secrets?(\..+)?$/i,
  /secret/i,
  /^terraform\.tfstate(\.backup)?$/i,
  /\.tfvars$/i,
  /^kubeconfig$/i,
  /^token(s)?(\.json|\.txt)?$/i,
];

const DIRECTORY_PATTERNS: RegExp[] = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.kube(\/|$)/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.config\/gh\/hosts\.yml$/,
  /(^|\/)\.git\/config$/,
  /(^|\/)\.claude\/settings(\.local)?\.json$/,
  /(^|\/)\.terraform(\/|$)/,
];

const NEVER_SENSITIVE: RegExp[] = [/^\.env\.example$/i, /^\.env\.sample$/i, /^\.env\.template$/i];

export function isSensitivePath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/");
  if (normalized.length === 0) return false;
  const basename = normalized.split("/").pop() ?? normalized;
  if (NEVER_SENSITIVE.some((re) => re.test(basename))) return false;
  if (BASENAME_PATTERNS.some((re) => re.test(basename))) return true;
  return DIRECTORY_PATTERNS.some((re) => re.test(normalized));
}
