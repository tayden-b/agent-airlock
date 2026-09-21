"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  DIMENSIONS,
  type Action,
  type RunSnapshot,
  type StreamEvent,
  type Verdict,
} from "@/contracts";
import { useStreamEvents } from "@/lib/stream";
import { VERDICT_STYLES, formatTime, riskTone } from "@/lib/display";

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

function DimensionBar({ name, risk }: { name: string; risk: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[11px] tracking-wide text-zinc-400 uppercase">{name}</span>
      <div className="h-1.5 flex-1 rounded-full bg-zinc-100">
        <div
          className={`h-1.5 rounded-full ${riskTone(risk)}`}
          style={{ width: `${Math.round(risk * 100)}%` }}
        />
      </div>
      <span className="w-9 text-right font-mono text-[11px] text-zinc-500">{risk.toFixed(2)}</span>
    </div>
  );
}

function ActionRow({ action, agentLabel }: { action: Action; agentLabel: string }) {
  const [open, setOpen] = useState(false);
  const assessment = action.assessment;

  return (
    <li className="border-b border-zinc-100 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-zinc-50"
      >
        <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-400">
          {formatTime(action.proposedAt)}
        </span>
        <span className="w-24 shrink-0 truncate font-mono text-[11px] text-zinc-500">
          {agentLabel}
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
            <div>
              <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                Assessment
              </p>
              {assessment ? (
                <>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-700">{assessment.reason}</p>
                  <div className="mt-3 space-y-1.5">
                    {DIMENSIONS.map((dim) => (
                      <DimensionBar key={dim} name={dim} risk={assessment.dimensions[dim].risk} />
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-zinc-400">
                    {assessment.providers.join(" + ")} · {assessment.latencyMs}ms · policy{" "}
                    {assessment.policyVersion}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-zinc-400">Assessment pending…</p>
              )}
            </div>
            <div>
              {assessment && assessment.ruleHits.length > 0 && (
                <>
                  <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                    Rules fired
                  </p>
                  <ul className="mt-2 space-y-1">
                    {assessment.ruleHits.map((hit) => (
                      <li key={hit.ruleId} className="text-xs text-zinc-600">
                        <span className="font-mono text-zinc-500">{hit.ruleId}</span> —{" "}
                        {hit.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {action.error && (
                <>
                  <p className="mt-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                    Error
                  </p>
                  <p className="mt-1 font-mono text-xs text-rose-600">{action.error}</p>
                </>
              )}
              {action.resultPreview && (
                <>
                  <p className="mt-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                    Result
                  </p>
                  <p className="mt-1 line-clamp-3 font-mono text-[11px] text-zinc-500">
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

  const agentLabel = useMemo(() => {
    const map = new Map(snapshot.agents.map((a) => [a.id, a]));
    return (action: Action) => map.get(action.agentId)?.agentId ?? "?";
  }, [snapshot.agents]);

  const tally = useMemo(() => {
    const t = { allow: 0, review: 0, deny: 0, pending: 0 };
    for (const a of snapshot.actions) t[a.assessment?.verdict ?? "pending"] += 1;
    return t;
  }, [snapshot.actions]);

  const { run } = snapshot;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-600">
        ← all runs
      </Link>

      <header className="mt-4 mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              {run.mission ?? run.sessionId}
            </h1>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                run.status === "active"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-zinc-100 text-zinc-500 ring-zinc-200"
              }`}
            >
              {run.status}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span
              className={`inline-block h-2 w-2 rounded-full ${live ? "animate-pulse bg-emerald-500" : "bg-zinc-300"}`}
            />
            {live ? "live" : "connecting"}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
          <span className="font-mono">{run.id}</span>
          {run.cwd && <span className="font-mono">{run.cwd}</span>}
          <span>
            {snapshot.agents.length} agents · {snapshot.actions.length} actions
          </span>
          <span>
            {tally.deny} deny · {tally.review} review · {tally.allow} allow
            {tally.pending > 0 ? ` · ${tally.pending} pending` : ""}
          </span>
        </div>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
          Agents
        </h2>
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {snapshot.agents.map((agent) => (
            <li key={agent.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  agent.status === "running" ? "animate-pulse bg-emerald-500" : "bg-zinc-300"
                }`}
              />
              <span className="w-28 shrink-0 font-mono text-xs text-zinc-700">{agent.agentId}</span>
              <span className="shrink-0 text-[11px] tracking-wide text-zinc-400 uppercase">
                {agent.agentType}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                {agent.description ?? agent.mission ?? ""}
              </span>
              <span className="text-[11px] text-zinc-400">{agent.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
          Actions
        </h2>
        <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {snapshot.actions.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-zinc-400">No actions yet.</li>
          ) : (
            snapshot.actions.map((action) => (
              <ActionRow key={action.id} action={action} agentLabel={agentLabel(action)} />
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
