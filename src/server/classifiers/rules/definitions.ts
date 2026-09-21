import type { Action, Agent, DimensionName, Run } from "@/contracts";
import { isSensitivePath } from "@/server/redaction/sensitive-paths";
import { classifyToolKind, parseMcpToolName } from "@/server/classifiers/tool-kind";

export interface RuleContext {
  action: Action;
  agent: Agent;
  run: Run;
  input: Record<string, unknown>;
  /** Bash command string, lowercased for matching; "" for non-shell tools. */
  command: string;
  /** file_path / notebook_path input field, if present. */
  filePath: string | null;
  mcp: { server: string; tool: string } | null;
}

export interface RuleDefinition {
  id: string;
  message: string;
  dimensions: Partial<Record<DimensionName, number>>;
  test: (ctx: RuleContext) => boolean;
}

export function buildContext(params: { action: Action; agent: Agent; run: Run }): RuleContext {
  const { action, agent, run } = params;
  const input = (action.input && typeof action.input === "object" ? action.input : {}) as Record<
    string,
    unknown
  >;
  const kind = classifyToolKind(action.toolName);
  const command = kind === "shell" && typeof input.command === "string" ? input.command.toLowerCase() : "";
  const filePathRaw = input.file_path ?? input.notebook_path ?? input.path;
  const filePath = typeof filePathRaw === "string" ? filePathRaw : null;
  return { action, agent, run, input, command, filePath, mcp: parseMcpToolName(action.toolName) };
}

// Matches `rm` (optionally via sudo/xargs) with a recursive/force flag anywhere in the command.
const RM_RF = /\brm\b[^|;&]*-[a-z]*[rf][a-z]*/;
// A shell-word boundary "target" — build/cache dirs whose deletion is routine and low-stakes.
const BUILD_ARTIFACT_TARGET = /(node_modules|dist|build|\.next|\.turbo|\.cache|coverage|out)\b/;
const PIPE_TO_SHELL = /(curl|wget)[^|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/;
const SUDO = /\bsudo\b/;
const GIT_PUSH_FORCE = /\bgit\s+push\b[^|;&]*(--force|-f\b)/;
const GIT_PUSH = /\bgit\s+push\b/;
const PACKAGE_INSTALL_GLOBAL = /\b(npm|pnpm|yarn)\s+(i|install|add)\b[^|;&]*(-g|--global)\b|\bbrew\s+install\b|\bpip\d?\s+install\b/;
const ENV_EXFIL = /\b(env|printenv|cat\s+.*\.env\S*)\b[^|;&]*\|\s*(curl|wget|nc|ssh)/;
const BACKGROUND_PROCESS = /(&\s*$|\bnohup\b|\bdisown\b|\bscreen\b|\btmux\s+new)/;
const NETWORK_TOOL = /\b(curl|wget|nc|ncat|ssh)\b/;
const LOCAL_HOST = /(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)/;

const INFRA_PATH = /(\.github\/workflows\/|Dockerfile|docker-compose|\.tf$|\.tfvars$|k8s\/|kubernetes\/|helm\/)/i;
const AGENT_INSTRUCTIONS_PATH = /(CLAUDE\.md|AGENTS\.md|\.cursorrules|\.claude\/settings.*\.json|\.claude\/hooks)/i;
const USER_CONFIG_PATH = /(^|\/)(\.zshrc|\.bashrc|\.bash_profile|\.gitconfig|\.ssh\/config|\.profile)$/;

const MUTATING_VERB = /^(write|delete|remove|create|update|send|post|execute|run|deploy|publish|merge)/i;
const OUTBOUND_COMMS = /(mail|email|slack|message|notify|sms|webhook|post)/i;

function isOutsideWorkspace(filePath: string | null, cwd: string | null): boolean {
  if (!filePath || !cwd) return false;
  if (!filePath.startsWith("/") && !filePath.startsWith("~")) return false; // relative path, assumed in-workspace
  const normalizedCwd = cwd.replace(/\/$/, "");
  const normalizedPath = filePath.startsWith("~") ? filePath : filePath;
  return !normalizedPath.startsWith(normalizedCwd) && !filePath.startsWith("~");
}

/**
 * 18 rules across shell / path / edit / web / mcp. Order doesn't matter — the
 * policy layer takes the max risk per dimension and lists every hit — but
 * grouping mirrors how an operator would explain them.
 */
export const RULES: RuleDefinition[] = [
  // --- shell -----------------------------------------------------------
  {
    id: "shell.destructive_build_artifacts",
    message: "Removes build/cache artifacts (recoverable by rebuilding)",
    dimensions: { impact: 0.2, reversibility: 0.15 },
    test: (ctx) => RM_RF.test(ctx.command) && BUILD_ARTIFACT_TARGET.test(ctx.command),
  },
  {
    id: "shell.destructive",
    message: "Recursive/forced delete outside known build artifacts",
    dimensions: { impact: 0.7, reversibility: 0.85 },
    test: (ctx) => RM_RF.test(ctx.command) && !BUILD_ARTIFACT_TARGET.test(ctx.command),
  },
  {
    id: "shell.pipe_to_shell",
    message: "Pipes a remote download directly into a shell",
    dimensions: { exposure: 0.8, impact: 0.7, reversibility: 0.6 },
    test: (ctx) => PIPE_TO_SHELL.test(ctx.command),
  },
  {
    id: "shell.network_egress",
    message: "Makes an outbound network call to a non-local host",
    dimensions: { exposure: 0.4 },
    test: (ctx) => NETWORK_TOOL.test(ctx.command) && !LOCAL_HOST.test(ctx.command),
  },
  {
    id: "shell.sudo",
    message: "Escalates privileges with sudo",
    dimensions: { scope: 0.5, impact: 0.4 },
    test: (ctx) => SUDO.test(ctx.command),
  },
  {
    id: "shell.env_exfil",
    message: "Reads environment/secrets and sends them over the network",
    dimensions: { exposure: 0.9, impact: 0.5 },
    test: (ctx) => ENV_EXFIL.test(ctx.command),
  },
  {
    id: "shell.package_install",
    message: "Installs a package globally or system-wide",
    dimensions: { scope: 0.35 },
    test: (ctx) => PACKAGE_INSTALL_GLOBAL.test(ctx.command),
  },
  {
    id: "shell.git_push",
    message: "Pushes commits to a remote (force flag raises impact further)",
    dimensions: { impact: 0.35, reversibility: 0.4 },
    test: (ctx) => GIT_PUSH.test(ctx.command) && !GIT_PUSH_FORCE.test(ctx.command),
  },
  {
    id: "shell.git_push_force",
    message: "Force-pushes, which can overwrite remote history",
    dimensions: { impact: 0.6, reversibility: 0.75 },
    test: (ctx) => GIT_PUSH_FORCE.test(ctx.command),
  },
  {
    id: "shell.background_process",
    message: "Starts a detached/background process that outlives this command",
    dimensions: { scope: 0.3 },
    test: (ctx) => BACKGROUND_PROCESS.test(ctx.command),
  },

  // --- path --------------------------------------------------------------
  {
    id: "path.sensitive_read",
    message: "Reads a path that looks like credentials or private config",
    dimensions: { exposure: 0.5 },
    test: (ctx) =>
      ["read", "search"].includes(classifyToolKind(ctx.action.toolName)) &&
      isSensitivePath(ctx.filePath ?? ""),
  },
  {
    id: "path.sensitive_write",
    message: "Writes to a path that looks like credentials or private config",
    dimensions: { exposure: 0.5, impact: 0.3 },
    test: (ctx) => classifyToolKind(ctx.action.toolName) === "edit" && isSensitivePath(ctx.filePath ?? ""),
  },
  {
    id: "path.outside_workspace",
    message: "Targets a path outside the run's working directory",
    dimensions: { scope: 0.3 },
    test: (ctx) => isOutsideWorkspace(ctx.filePath, ctx.run.cwd),
  },
  {
    id: "path.user_config_write",
    message: "Edits a shell/user config file that affects future sessions",
    dimensions: { scope: 0.3, reversibility: 0.3 },
    test: (ctx) =>
      classifyToolKind(ctx.action.toolName) === "edit" && USER_CONFIG_PATH.test(ctx.filePath ?? ""),
  },

  // --- edit ----------------------------------------------------------------
  {
    id: "edit.infra_or_ci",
    message: "Edits CI/infra-as-code that can change deploys or pipelines",
    dimensions: { impact: 0.4, scope: 0.2 },
    test: (ctx) =>
      classifyToolKind(ctx.action.toolName) === "edit" && INFRA_PATH.test(ctx.filePath ?? ""),
  },
  {
    id: "edit.agent_instructions",
    message: "Edits the agent's own instructions or hook configuration",
    dimensions: { impact: 0.35, scope: 0.3 },
    test: (ctx) =>
      classifyToolKind(ctx.action.toolName) === "edit" &&
      AGENT_INSTRUCTIONS_PATH.test(ctx.filePath ?? ""),
  },

  // --- web -------------------------------------------------------------------
  {
    id: "web.fetch_private",
    message: "Fetches a localhost/private-network URL",
    dimensions: { exposure: 0.3 },
    test: (ctx) => {
      const kind = classifyToolKind(ctx.action.toolName);
      if (kind !== "web" || ctx.action.toolName !== "WebFetch") return false;
      const url = typeof ctx.input.url === "string" ? ctx.input.url : "";
      return LOCAL_HOST.test(url) || /(^|\.)(internal|corp|local)(\/|$)/i.test(url);
    },
  },

  // --- mcp ---------------------------------------------------------------
  {
    id: "mcp.mutating_verb",
    message: "MCP tool name suggests it mutates external state",
    dimensions: { impact: 0.3 },
    test: (ctx) => ctx.mcp !== null && MUTATING_VERB.test(ctx.mcp.tool),
  },
  {
    id: "mcp.outbound_communication",
    message: "MCP server/tool suggests it sends messages or notifications",
    dimensions: { exposure: 0.35 },
    test: (ctx) =>
      ctx.mcp !== null && (OUTBOUND_COMMS.test(ctx.mcp.server) || OUTBOUND_COMMS.test(ctx.mcp.tool)),
  },
];
