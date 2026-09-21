"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DIMENSIONS,
  type Action,
  type Agent,
  type RunSnapshot,
  type StreamEvent,
  type Verdict,
} from "@/contracts";
import { useStreamEvents } from "@/lib/stream";
import {
  DIMENSION_MEANINGS,
  PHASE_STYLES,
  VERDICT_STYLES,
  cleanLabel,
  formatRelative,
  formatTime,
  formatTokens,
  riskTone,
  usageShares,
} from "@/lib/display";

const VERDICT_ORDER: Verdict[] = ["deny", "review", "allow"];

function VerdictBadge({ action }: { action: Action }) {
  const verdict: Verdict | "pending" = action.assessment?.verdict ?? "pending";
  return (
    <span
      className={`inline-flex w-16 shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${VERDICT_STYLES[verdict].badge}`}
    >
      {verdict}
    </span>
  );
}

/** Single risk meter for an action: max dimension risk against the review /
 * deny thresholds, with the contributing dimensions as labeled chips. */
function RiskPanel({ action }: { action: Action }) {
  const assessment = action.assessment;
  if (!assessment) return <p className="mt-2 text-xs text-zinc-400">Assessment pending…</p>;

  const ranked = DIMENSIONS.map((dim) => ({ dim, risk: assessment.dimensions[dim].risk }))
    .filter((d) => d.risk >= 0.25)
    .sort((a, b) => b.risk - a.risk);
  const maxRisk = Math.max(...DIMENSIONS.map((d) => assessment.dimensions[d].risk));

  return (
    <div>
      <p className="mt-1 text-sm leading-relaxed text-zinc-700">{assessment.reason}</p>

      <div className="relative mt-4 h-1.5 rounded-full bg-zinc-100">
        <div
          className={`h-1.5 rounded-full ${riskTone(maxRisk)}`}
          style={{ width: `${Math.round(maxRisk * 100)}%` }}
        />
        <span
          className="absolute -top-1 h-3.5 w-px bg-zinc-300"
          style={{ left: "50%" }}
          title="review threshold"
        />
        <span
          className="absolute -top-1 h-3.5 w-px bg-zinc-400"
          style={{ left: "80%" }}
          title="deny threshold"
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>0</span>
        <span>review ≥ 0.50</span>
        <span>deny ≥ 0.80</span>
      </div>

      {ranked.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ranked.map(({ dim, risk }) => (
            <span
              key={dim}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 ring-1 ring-zinc-200 ring-inset"
              title={`${dim}: ${risk.toFixed(2)}`}
            >
              {DIMENSION_MEANINGS[dim]} <span className="font-mono">{risk.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}

      {assessment.ruleHits.length > 0 && (
        <ul className="mt-3 space-y-1">
          {assessment.ruleHits.map((hit) => (
            <li key={hit.ruleId} className="text-xs text-zinc-600">
              <span className="font-mono text-zinc-500">{hit.ruleId}</span> — {hit.message}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-zinc-400">
        {assessment.providers.join(" + ")} · {assessment.latencyMs}ms · policy{" "}
        {assessment.policyVersion}
      </p>
    </div>
  );
}

function ActionRow({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-zinc-100 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-50"
      >
        <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-400">
          {formatTime(action.proposedAt)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800">
          {action.inputSummary}
        </span>
        {action.outcome === "failure" && (
          <span className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
            failed
          </span>
        )}
        <VerdictBadge action={action} />
      </button>

      {open && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-4">
          <div className="grid gap-6 sm:grid-cols-2">
            <RiskPanel action={action} />
            <div>
              {action.error && (
                <>
                  <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                    Error
                  </p>
                  <p className="mt-1 font-mono text-xs text-rose-600">{action.error}</p>
                </>
              )}
              {action.resultPreview && (
                <>
                  <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                    Result
                  </p>
                  <p className="mt-1 line-clamp-3 font-mono text-[11px] break-all text-zinc-500">
                    {action.resultPreview}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/** Per-action verdict strip — the run's risk arc at a glance. */
function VerdictTimeline({ actions }: { actions: Action[] }) {
  const sorted = [...actions].sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
  return (
    <div className="flex h-2 gap-px overflow-hidden rounded-full bg-zinc-100">
      {sorted.map((a) => (
        <div
          key={a.id}
          className={`min-w-[2px] flex-1 ${VERDICT_STYLES[a.assessment?.verdict ?? "pending"].dot}`}
          title={`${a.toolName} — ${a.assessment?.verdict ?? "pending"}`}
        />
      ))}
    </div>
  );
}

/** Compact stat line used in the summary strip. */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
      <span className="text-sm font-medium text-zinc-800 tabular-nums">{value}</span>
    </div>
  );
}

export function RunDetail({ initial }: { initial: RunSnapshot }) {
  const [snapshot, setSnapshot] = useState<RunSnapshot>(initial);

  const onEvent = useCallback((event: StreamEvent) => {
    setSnapshot((prev) => {
      if (event.type === "run.upserted" && event.run.id === prev.run.id) {
        return { ...prev, run: event.run };
      }
      if (event.type === "agent.upserted" && event.agent.runId === prev.run.id) {
        const agents = prev.agents.some((a) => a.id === event.agent.id)
          ? prev.agents.map((a) => (a.id === event.agent.id ? event.agent : a))
          : [...prev.agents, event.agent];
        return { ...prev, agents };
      }
      if (event.type === "action.upserted" && event.action.runId === prev.run.id) {
        const exists = prev.actions.some((a) => a.id === event.action.id);
        const actions = exists
          ? prev.actions.map((a) => (a.id === event.action.id ? event.action : a))
          : [...prev.actions, event.action];
        return { ...prev, actions };
      }
      return prev;
    });
  }, []);

  const live = useStreamEvents(onEvent);

  // Slow poll as a safety net: on serverless deployments the event may be
  // published on a different instance than the one holding this SSE stream.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(snapshot.run.id)}`);
        if (res.ok) setSnapshot(await res.json());
      } catch {
        // transient; next tick retries
      }
    }, 5000);
    return () => clearInterval(id);
  }, [snapshot.run.id]);

  // Group actions under their agent, preserving agent order (main first).
  const actionsByAgent = useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const a of snapshot.actions) {
      const list = map.get(a.agentId) ?? [];
      list.push(a);
      map.set(a.agentId, list);
    }
    return map;
  }, [snapshot.actions]);

  const tally = useMemo(() => {
    const t = { allow: 0, review: 0, deny: 0, pending: 0 };
    for (const a of snapshot.actions) t[a.assessment?.verdict ?? "pending"] += 1;
    return t;
  }, [snapshot.actions]);

  const { run } = snapshot;
  const total = snapshot.actions.length || 1;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="text-xs text-zinc-400 transition-colors hover:text-zinc-600">
        ← all runs
      </Link>

      <header className="mt-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-lg font-medium tracking-tight text-zinc-900">
            {run.mission ? cleanLabel(run.mission) : run.sessionId}
          </h1>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-zinc-300"}`}
            />
            {live ? "live" : "connecting"}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span className="font-mono">{run.id}</span>
          {run.cwd && <span className="font-mono">{run.cwd}</span>}
          <span>{formatRelative(run.updatedAt)}</span>
        </div>
      </header>

      {/* Summary strip */}
      <section className="mb-8 rounded-xl border border-zinc-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Stat label="status" value={run.status} />
          {run.phase && run.status === "active" && (
            <Stat
              label="phase"
              value={
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PHASE_STYLES[run.phase]}`}
                >
                  {run.phase}
                </span>
              }
            />
          )}
          {run.sessionVerdict && (
            <Stat
              label="verdict"
              value={`${run.sessionVerdict.archetype} · ${Math.round(run.sessionVerdict.accomplished * 100)}%`}
            />
          )}
          <Stat label="agents" value={snapshot.agents.length} />
          <Stat label="actions" value={snapshot.actions.length} />
          {run.usage && <Stat label="tokens" value={formatTokens(run.usage.totalTokens)} />}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
              shadow verdicts
            </span>
            <span className="flex items-center gap-2 text-sm tabular-nums">
              {VERDICT_ORDER.map((v) =>
                tally[v] > 0 ? (
                  <span key={v} className="flex items-center gap-1 text-xs text-zinc-600">
                    <span className={`h-2 w-2 rounded-full ${VERDICT_STYLES[v].dot}`} />
                    {tally[v]}
                  </span>
                ) : null,
              )}
              {tally.pending > 0 && (
                <span className="text-xs text-zinc-400">{tally.pending} pending</span>
              )}
            </span>
          </div>
        </div>
        {snapshot.actions.length > 0 && (
          <div className="mt-4">
            <VerdictTimeline actions={snapshot.actions} />
          </div>
        )}
        {run.usage && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-1.5 w-40 overflow-hidden rounded-full bg-zinc-100">
              {usageShares(run.usage).map((s) => (
                <div
                  key={s.label}
                  className={s.tone}
                  style={{ width: `${s.share * 100}%` }}
                  title={`${s.label}: ${formatTokens(Math.round(s.share * run.usage!.totalTokens))}`}
                />
              ))}
            </div>
            <span className="text-[11px] text-zinc-400">
              {formatTokens(run.usage.cacheReadTokens)} cached ·{" "}
              {formatTokens(run.usage.inputTokens)} in · {formatTokens(run.usage.outputTokens)} out
            </span>
          </div>
        )}
      </section>

      {snapshot.agents.map((agent) => (
        <AgentSection key={agent.id} agent={agent} actions={actionsByAgent.get(agent.id) ?? []} />
      ))}
      {snapshot.actions.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-400">
          No actions yet.
        </div>
      )}
    </div>
  );
}

function AgentSection({ agent, actions }: { agent: Agent; actions: Action[] }) {
  const [open, setOpen] = useState(true);
  const agentTally = { allow: 0, review: 0, deny: 0 };
  for (const a of actions) {
    const v = a.assessment?.verdict;
    if (v !== undefined) agentTally[v] += 1;
  }
  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-zinc-50"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            agent.status === "running" ? "animate-pulse bg-emerald-500" : "bg-zinc-300"
          }`}
        />
        <span className="font-mono text-xs font-medium text-zinc-700">{agent.agentId}</span>
        <span className="text-[11px] tracking-wide text-zinc-400 uppercase">{agent.agentType}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
          {agent.description ?? (agent.mission ? cleanLabel(agent.mission) : "")}
        </span>
        <span className="flex items-center gap-1.5">
          {VERDICT_ORDER.map((v) =>
            agentTally[v] > 0 ? (
              <span
                key={v}
                className={`h-1.5 w-1.5 rounded-full ${VERDICT_STYLES[v].dot}`}
                title={`${agentTally[v]} ${v}`}
              />
            ) : null,
          )}
        </span>
        <span className="text-[11px] text-zinc-400">
          {actions.length} {actions.length === 1 ? "action" : "actions"} · {agent.status}
        </span>
        <span className="text-zinc-300">{open ? "▾" : "▸"}</span>
      </button>
      {open && actions.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {actions.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </ul>
      )}
    </section>
  );
}
