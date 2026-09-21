import type { ToolKind } from "@/contracts";

const EXACT: Record<string, ToolKind> = {
  Read: "read",
  NotebookRead: "read",
  Glob: "search",
  Grep: "search",
  LS: "search",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "shell",
  BashOutput: "shell",
  KillShell: "shell",
  WebFetch: "web",
  WebSearch: "web",
  Agent: "agent",
  Task: "agent",
};

/** Maps a tool name (Claude Code naming) to a coarse category. MCP tools are `mcp__<server>__<tool>`. */
export function classifyToolKind(toolName: string): ToolKind {
  if (toolName.startsWith("mcp__")) return "mcp";
  return EXACT[toolName] ?? "other";
}

/** Splits `mcp__server__tool` into its parts; returns null for non-MCP names. */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice("mcp__".length);
  const idx = rest.indexOf("__");
  if (idx === -1) return { server: rest, tool: "" };
  return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) };
}
