import type { RedactionConfig } from "@/server/config";
import { SECRET_PATTERNS } from "./patterns";

export { isSensitivePath } from "./sensitive-paths";

export const DEFAULT_REDACTION: RedactionConfig = {
  maxStringLength: 2000,
  previewLength: 400,
  maxArrayLength: 50,
  maxDepth: 6,
};

export interface RedactionResult<T> {
  value: T;
  redactedCount: number;
  truncated: boolean;
  kinds: string[];
}

interface Counters {
  redactedCount: number;
  truncated: boolean;
  kinds: string[];
}

const resolveConfig = (config?: Partial<RedactionConfig>): RedactionConfig => ({
  ...DEFAULT_REDACTION,
  ...config,
});

const emptyCounters = (): Counters => ({
  redactedCount: 0,
  truncated: false,
  kinds: [],
});

function scrubString(text: string, counters: Counters): string {
  let out = text;
  // kinds are ordered by first occurrence in the original text, not by
  // pattern order, so a slack token preceding an AWS key lists slack first.
  const fired: Array<{ index: number; kind: string }> = [];
  for (const { kind, regex, replace } of SECRET_PATTERNS) {
    let count = 0;
    out = out.replace(regex, (...args: unknown[]) => {
      const matched = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      const replaced = replace(matched, ...groups);
      if (replaced !== matched) count += 1;
      return replaced;
    });
    if (count > 0) {
      counters.redactedCount += count;
      const nonGlobal = new RegExp(regex.source, regex.flags.replace("g", ""));
      let index = text.search(nonGlobal);
      if (index === -1) index = out.search(nonGlobal);
      fired.push({ index, kind });
    }
  }
  fired.sort((a, b) => a.index - b.index);
  for (const { kind } of fired) {
    if (!counters.kinds.includes(kind)) counters.kinds.push(kind);
  }
  return out;
}

function truncateString(text: string, max: number, counters: Counters): string {
  if (text.length <= max) return text;
  counters.truncated = true;
  const removed = text.length - max;
  return `${text.slice(0, max)}…[truncated ${removed} chars]`;
}

function walk(value: unknown, config: RedactionConfig, counters: Counters, depth: number, seen: Set<object>): unknown {
  if (typeof value === "string") {
    const scrubbed = scrubString(value, counters);
    return truncateString(scrubbed, config.maxStringLength, counters);
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "object") {
    // functions, symbols, bigints are never persisted as-is
    try {
      return String(value);
    } catch {
      return "[unprintable]";
    }
  }
  if (seen.has(value)) return "[circular]";
  if (depth >= config.maxDepth) {
    counters.truncated = true;
    return "[truncated: depth]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const kept = value.slice(0, config.maxArrayLength).map((item) => walk(item, config, counters, depth + 1, seen));
    if (value.length > config.maxArrayLength) {
      counters.truncated = true;
      kept.push(`…[truncated ${value.length - config.maxArrayLength} items]`);
    }
    return kept;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = walk(val, config, counters, depth + 1, seen);
  }
  return out;
}

export function redactString(text: string, config?: Partial<RedactionConfig>): RedactionResult<string> {
  const resolved = resolveConfig(config);
  const counters = emptyCounters();
  const value = truncateString(scrubString(text, counters), resolved.maxStringLength, counters);
  return { value, ...counters };
}

export function redactValue(value: unknown, config?: Partial<RedactionConfig>): RedactionResult<unknown> {
  const resolved = resolveConfig(config);
  const counters = emptyCounters();
  try {
    const walked = walk(value, resolved, counters, 0, new Set());
    return { value: walked, ...counters };
  } catch {
    // redaction must never throw; fall back to a bounded string
    return { value: truncateString(String(value), resolved.maxStringLength, counters), ...counters };
  }
}

export function previewValue(value: unknown, config?: Partial<RedactionConfig>): string {
  const resolved = resolveConfig(config);
  let line: string;
  if (typeof value === "string") {
    line = scrubString(value, emptyCounters());
  } else {
    try {
      const redacted = redactValue(value, resolved).value;
      line = JSON.stringify(redacted) ?? String(redacted);
    } catch {
      try {
        line = String(value);
      } catch {
        line = "[unprintable]";
      }
    }
  }
  line = line.replace(/\s+/g, " ").trim();
  if (line.length > resolved.previewLength) {
    line = `${line.slice(0, resolved.previewLength)}…`;
  }
  return line;
}
