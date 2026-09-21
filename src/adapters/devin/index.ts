import type { NormalizedEvent } from "@/contracts";

/**
 * Devin cloud session adapter. The Devin REST API returns session objects
 * (v3 `/v3/sessions`); field naming has shifted between API versions, so the
 * reader helpers accept the aliases we have seen.
 */

interface DevinSessionLike {
  session_id?: string;
  id?: string;
  title?: string | null;
  prompt?: string | null;
  status?: string | null;
  status_enum?: string | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  url?: string | null;
}

function asIso(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    // epoch seconds vs millis
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const TERMINAL = new Set([
  "finished",
  "stopped",
  "expired",
  "blocked",
  "suspend_requested",
  "suspend_user_requested",
]);

/** Map one Devin session object to normalized run events. */
export function devinSessionToEvents(raw: unknown): NormalizedEvent[] {
  const s = raw as DevinSessionLike;
  const sessionId = s.session_id ?? s.id;
  if (!sessionId) return [];

  const createdAt = asIso(s.created_at) ?? new Date().toISOString();
  const updatedAt = asIso(s.updated_at) ?? createdAt;
  const status = (s.status_enum ?? s.status ?? "").toLowerCase();
  const base = {
    source: "devin" as const,
    sessionId,
    at: createdAt,
  };

  const events: NormalizedEvent[] = [
    { ...base, kind: "run.started" },
    {
      ...base,
      kind: "agent.started",
      agentId: "devin",
      agentType: "devin",
    },
  ];

  const title = s.title ?? s.prompt;
  if (title) events.push({ ...base, kind: "run.mission", mission: title });
  if (s.prompt && s.prompt !== title) {
    events.push({
      ...base,
      kind: "agent.mission",
      agentId: "devin",
      agentType: "devin",
      mission: s.prompt.slice(0, 500),
    });
  }

  if (TERMINAL.has(status)) {
    events.push({ ...base, at: updatedAt, kind: "run.ended", reason: status });
  }
  return events;
}
