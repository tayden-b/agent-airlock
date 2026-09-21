import type { Verdict } from "@/contracts";

export const VERDICT_STYLES: Record<Verdict | "pending", { badge: string; dot: string }> = {
  allow: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  review: { badge: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
  deny: { badge: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  pending: { badge: "bg-zinc-100 text-zinc-500 ring-zinc-200", dot: "bg-zinc-300" },
};

export function verdictLabel(verdict: Verdict | "pending"): string {
  switch (verdict) {
    case "allow":
      return "allow";
    case "review":
      return "review";
    case "deny":
      return "deny";
    default:
      return "pending";
  }
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatRelative(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Risk bar color: zinc under review threshold, amber to review, rose at deny. */
export function riskTone(risk: number): string {
  if (risk >= 0.8) return "bg-rose-500";
  if (risk >= 0.5) return "bg-amber-500";
  return "bg-zinc-300";
}
