"use client";

import Link from "next/link";
import type { DashboardStats } from "@/server/storage/repository";
import {
  VERDICT_STYLES,
  cleanLabel,
  formatRelative,
  formatTokens,
  verdictLabel,
} from "@/lib/display";

const VERDICT_ORDER = ["deny", "review", "allow", "pending"] as const;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white px-5 py-4 ${className}`}>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-400">{sub}</p>}
    </Card>
  );
}

export function StatsOverview({ stats }: { stats: DashboardStats }) {
  const v = stats.verdicts;
  const vTotal = v.deny + v.review + v.allow + v.pending;
  const maxActions = Math.max(1, ...stats.activity.map((d) => d.actions));

  return (
    <div className="mb-10 space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="active sessions"
          value={stats.totals.activeRuns}
          sub={stats.totals.activeRuns > 0 ? "streaming now" : "none running"}
        />
        <Kpi label="sessions" value={stats.totals.runs} sub="all sources" />
        <Kpi label="actions observed" value={stats.totals.actions} />
        <Kpi
          label="tokens used"
          value={stats.totals.tokens > 0 ? formatTokens(stats.totals.tokens) : "—"}
          sub={stats.totals.tokens > 0 ? "across reporting runs" : "no usage reported yet"}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Verdict mix */}
        <Card>
          <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
            shadow verdicts
          </p>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
            {VERDICT_ORDER.map((k) =>
              v[k] > 0 ? (
                <div
                  key={k}
                  className={VERDICT_STYLES[k].dot}
                  style={{ width: `${(v[k] / Math.max(1, vTotal)) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {VERDICT_ORDER.map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-zinc-600">
                <span className={`h-2 w-2 rounded-full ${VERDICT_STYLES[k].dot}`} />
                {v[k]} {verdictLabel(k)}
                <span className="text-zinc-400">
                  ({vTotal ? Math.round((v[k] / vTotal) * 100) : 0}%)
                </span>
              </span>
            ))}
          </div>
        </Card>

        {/* Activity */}
        <Card>
          <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
            activity · last 14 days
          </p>
          <div className="mt-3 flex h-16 items-end gap-1">
            {stats.activity.length === 0 ? (
              <span className="text-xs text-zinc-400">no activity yet</span>
            ) : (
              stats.activity.map((d) => (
                <div
                  key={d.day}
                  className="group relative min-w-[6px] flex-1 rounded-sm bg-zinc-200 transition-colors hover:bg-zinc-300"
                  style={{ height: `${Math.max(6, (d.actions / maxActions) * 100)}%` }}
                  title={`${d.day}: ${d.actions} actions${d.flagged ? `, ${d.flagged} flagged` : ""}`}
                >
                  {d.flagged > 0 && (
                    <div
                      className="absolute right-0 bottom-0 left-0 rounded-sm bg-amber-400"
                      style={{ height: `${(d.flagged / d.actions) * 100}%` }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">
            gray = actions per day · amber overlay = flagged (review/deny)
          </p>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Sources */}
        <Card>
          <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">sources</p>
          <ul className="mt-3 space-y-2">
            {stats.perSource.length === 0 ? (
              <li className="text-xs text-zinc-400">none connected</li>
            ) : (
              stats.perSource.map((s) => (
                <li key={s.source} className="flex items-center gap-3 text-xs">
                  <span className="w-24 font-mono font-medium text-zinc-700">{s.source}</span>
                  <span className="text-zinc-500">
                    {s.runs} {s.runs === 1 ? "session" : "sessions"}
                  </span>
                  <span className="text-zinc-300">·</span>
                  <span className="text-zinc-500">{s.actions} actions</span>
                </li>
              ))
            )}
          </ul>
        </Card>

        {/* Attention feed */}
        <Card>
          <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
            needs attention
          </p>
          <ul className="mt-2 divide-y divide-zinc-100">
            {stats.attention.length === 0 ? (
              <li className="py-3 text-xs text-zinc-400">nothing flagged — all clear</li>
            ) : (
              stats.attention.slice(0, 6).map((a) => (
                <li key={a.actionId}>
                  <Link
                    href={`/runs/${encodeURIComponent(a.runId)}`}
                    className="flex items-center gap-2.5 py-2 transition-colors hover:text-zinc-900"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_STYLES[a.verdict].dot}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-700">
                      {a.inputSummary}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400">
                      {a.runMission ? cleanLabel(a.runMission).slice(0, 32) : a.runId.slice(0, 20)}
                      {" · "}
                      {formatRelative(a.at)}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
