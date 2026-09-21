"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Bot, Gauge } from "lucide-react";
import type { StreamEvent } from "@/contracts";
import type { DashboardStats } from "@/server/storage/repository";
import { useStreamEvents } from "@/lib/stream";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/#sessions", label: "Sessions", icon: Bot },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) setStats(await res.json());
    } catch {
      // transient; next tick retries
    }
  }, []);

  const onEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === "heartbeat") return;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(refresh, 500);
    },
    [refresh],
  );

  const live = useStreamEvents(onEvent);

  useEffect(() => {
    const id = setTimeout(refresh, 0);
    return () => clearTimeout(id);
  }, [refresh]);

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-zinc-900">
            <div className="h-2 w-2 rounded-full border border-white/70" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-zinc-900">Airlock</span>
        </div>

        <nav className="px-3">
          <p className="px-2 pb-1.5 text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
            Console
          </p>
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : false;
              return (
                <li key={label}>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-zinc-100 font-medium text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800",
                    )}
                  >
                    <Icon size={14} strokeWidth={2} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-6 px-3">
          <p className="px-2 pb-1.5 text-[10px] font-medium tracking-wider text-zinc-400 uppercase">
            Sources
          </p>
          <ul className="space-y-0.5">
            {(stats?.perSource ?? []).map((s) => (
              <li
                key={s.source}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-zinc-500"
              >
                <Activity size={14} strokeWidth={2} className="shrink-0" />
                <span className="flex-1 truncate font-mono text-xs">{s.source}</span>
                <span className="text-[11px] text-zinc-400 tabular-nums">{s.runs}</span>
              </li>
            ))}
            {stats && stats.perSource.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-zinc-400">none connected</li>
            )}
          </ul>
        </div>

        <div className="mt-auto border-t border-zinc-100 px-5 py-4">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                live ? "animate-pulse bg-emerald-500" : "bg-zinc-300",
              )}
            />
            {live ? "Live" : "Connecting…"}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
