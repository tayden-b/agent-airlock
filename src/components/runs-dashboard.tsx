"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSummary, StreamEvent, Verdict } from "@/contracts";
import { useStreamEvents } from "@/lib/stream";
import {
  PHASE_STYLES,
  VERDICT_STYLES,
  formatRelative,
  formatTokens,
  verdictLabel,
} from "@/lib/display";
import { Badge } from "@/components/ui/badge";

function VerdictPill({ verdict, count }: { verdict: Verdict | "pending"; count: number }) {
  if (count === 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${VERDICT_STYLES[verdict].badge}`}
    >
      {count} {verdictLabel(verdict)}
    </span>
  );
}

export function RunsDashboard({ initial }: { initial: RunSummary[] }) {
  const [summaries, setSummaries] = useState<RunSummary[]>(initial);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (res.ok) setSummaries(await res.json());
    } catch {
      // transient; next tick retries
    }
  }, []);

  // Re-pull the summary list on any event; debounced so a burst of tool
  // calls coalesces into one read of (tiny, local) sqlite.
  const onEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === "heartbeat") return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, 200);
    },
    [refresh],
  );

  const live = useStreamEvents(onEvent);

  // Slow poll as a safety net: on serverless deployments the event may be
  // published on a different instance than the one holding this SSE stream.
  useEffect(() => {
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Empty session start/end pairs are noise; active runs stay visible even
  // before their first action lands.
  const visible = summaries.filter((s) => s.actions > 0 || s.run.status === "active");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Airlock</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Shadow-mode console — every agent action, scored before it lands.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className={`inline-block h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-zinc-300"}`}
          />
          {live ? "live" : "connecting"}
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center">
          <p className="text-sm text-zinc-500">No sessions observed yet.</p>
          <p className="mt-2 font-mono text-xs text-zinc-400">
            pnpm replay fixtures/sessions/research-fanout.jsonl
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
          {visible.map(({ run, agents, actions, verdicts }) => (
            <li key={run.id}>
              <Link
                href={`/runs/${encodeURIComponent(run.id)}`}
                className="block px-5 py-4 transition-colors hover:bg-zinc-50"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] tracking-wide text-zinc-500 uppercase"
                      >
                        {run.source}
                      </Badge>
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          run.status === "active" ? "bg-emerald-500" : "bg-zinc-300"
                        }`}
                      />
                      <span className="text-xs text-zinc-400">{formatRelative(run.updatedAt)}</span>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-zinc-800">
                      {run.mission ?? run.sessionId}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {run.sessionVerdict && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 ring-1 ring-zinc-200 ring-inset">
                        {run.sessionVerdict.archetype}
                      </span>
                    )}
                    {run.phase && run.status === "active" && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${PHASE_STYLES[run.phase]}`}
                      >
                        {run.phase}
                      </span>
                    )}
                    {run.usage && (
                      <span className="font-mono text-[11px] text-zinc-400">
                        {formatTokens(run.usage.totalTokens)} tok
                      </span>
                    )}
                    <span className="text-xs text-zinc-400">
                      {agents} {agents === 1 ? "agent" : "agents"} · {actions}{" "}
                      {actions === 1 ? "action" : "actions"}
                    </span>
                    <VerdictPill verdict="deny" count={verdicts.deny} />
                    <VerdictPill verdict="review" count={verdicts.review} />
                    <VerdictPill verdict="allow" count={verdicts.allow} />
                    <VerdictPill verdict="pending" count={verdicts.pending} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
