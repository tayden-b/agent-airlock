import { parseMcpToolName } from "@/server/classifiers/tool-kind";

const MAX = 140;

function clip(text: string, max = MAX): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function firstStringField(input: Record<string, unknown>): string | null {
  for (const key of ["query", "path", "file_path", "url", "command", "name", "id", "title"]) {
    const v = str(input[key]);
    if (v) return `${key}=${v}`;
  }
  for (const [key, value] of Object.entries(input)) {
    const v = str(value);
    if (v) return `${key}=${v}`;
  }
  return null;
}

/**
 * One human-readable line per action, e.g. `Bash: rm -rf dist` or
 * `Read: /repo/.env`. Operates on the already-redacted input.
 */
export function summarizeToolInput(toolName: string, input: unknown): string {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  switch (toolName) {
    case "Bash":
      return clip(`Bash: ${str(obj.command) ?? ""}`);
    case "Read":
    case "NotebookRead":
      return clip(`${toolName}: ${str(obj.file_path) ?? str(obj.notebook_path) ?? ""}`);
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return clip(`${toolName}: ${str(obj.file_path) ?? str(obj.notebook_path) ?? ""}`);
    case "Glob":
      return clip(`Glob: ${str(obj.pattern) ?? ""}${str(obj.path) ? ` in ${obj.path}` : ""}`);
    case "Grep":
      return clip(`Grep: ${str(obj.pattern) ?? ""}${str(obj.path) ? ` in ${obj.path}` : ""}`);
    case "LS":
      return clip(`LS: ${str(obj.path) ?? ""}`);
    case "WebFetch":
      return clip(`WebFetch: ${str(obj.url) ?? ""}`);
    case "WebSearch":
      return clip(`WebSearch: ${str(obj.query) ?? ""}`);
    case "Agent":
    case "Task":
      return clip(
        `${toolName}: ${str(obj.subagent_type) ?? "agent"} — ${str(obj.description) ?? str(obj.prompt) ?? ""}`,
      );
  }

  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    const detail = firstStringField(obj);
    return clip(`${mcp.server}/${mcp.tool}${detail ? `: ${detail}` : ""}`);
  }

  const detail = firstStringField(obj);
  if (detail) return clip(`${toolName}: ${detail}`);
  try {
    return clip(`${toolName}: ${JSON.stringify(obj)}`);
  } catch {
    return clip(toolName);
  }
}
