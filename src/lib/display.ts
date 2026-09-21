import type { SessionPhase, Usage, Verdict } from "@/contracts";

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

/** Strip markup envelopes and entities from hook-provided text (missions,
 * previews) so synthetic XML blobs render as plain labels. */
export function cleanLabel(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

export const PHASE_STYLES: Record<SessionPhase, string> = {
  exploring: "bg-sky-50 text-sky-700 ring-sky-200",
  implementing: "bg-violet-50 text-violet-700 ring-violet-200",
  verifying: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  looping: "bg-amber-50 text-amber-700 ring-amber-200",
};

/** Compact token count: 42_100 -> "42.1k". */
export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Proportions of a usage breakdown for a stacked bar, in fixed order. */
export function usageShares(usage: Usage): { label: string; share: number; tone: string }[] {
  const { totalTokens: total } = usage;
  if (total === 0) return [];
  return [
    { label: "cache read", share: usage.cacheReadTokens / total, tone: "bg-zinc-300" },
    { label: "cache write", share: usage.cacheCreationTokens / total, tone: "bg-zinc-400" },
    { label: "input", share: usage.inputTokens / total, tone: "bg-sky-400" },
    { label: "output", share: usage.outputTokens / total, tone: "bg-violet-400" },
  ].filter((s) => s.share > 0);
}
