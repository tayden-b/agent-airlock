# Airlock — UI Spec

Aesthetic: quiet, dense, technical. Near-white `zinc-50` background, black text,
muted `zinc-500` secondary text, thin `zinc-200` borders. Verdict color is the
only saturated color on the page — emerald (allow), amber (review), rose (deny).
Monospace for ids, tool inputs, timestamps, and dimension values.

## `/` — Runs list

Header: `Airlock` wordmark + one-line tagline + live indicator
(green pulsing dot "live" / amber "connecting" when the SSE stream is down).

Each run is a row (link to `/runs/:id`):

- source badge (`claude-code`), status dot (active = green pulse, ended = zinc)
- mission text (truncated) or `session_id` fallback
- `N agents · N actions`, verdict tally pills (`2 deny · 6 review · 7 allow`)
- started time (HH:MM:SS)

Empty state: points at `pnpm replay fixtures/sessions/research-fanout.jsonl`.

Live behavior: any non-heartbeat stream event triggers a debounced (200 ms)
refetch of `/api/runs`, so tallies stay exact.

## `/runs/:id` — Run detail

Header: back link, mission as the title, run id + cwd, `ended`/`connecting`
status, agent/action counts, verdict tally.

Two stacked sections:

**Agents** — one row per agent: status pulse, `agentId` (mono), type badge,
description/mission line, status right-aligned. The `main` thread is always
listed.

**Actions** — chronological feed, newest at bottom. Each row is a button:

- `HH:MM:SS` timestamp, agent id, one-line input summary (mono, truncated)
- `failed` tag when the outcome was a failure
- verdict badge, or `pending` (zinc) until the assessment lands

Expanding a row reveals:

- `assessment.reason` — the explainable verdict line
- four dimension bars (scope / exposure / impact / reversibility) filled to
  their score, colored by risk tone (rose ≥ 0.8, amber ≥ 0.5, zinc otherwise)
- provenance line: `providers · latency · policy version`
- rule hits (`ruleId — message`) when rules fired
- error text on failures; `resultPreview` (3-line clamp) on successes

Live behavior: `run`/`agent`/`action` stream events are merged into the snapshot
in place — no refetch needed for detail pages.

## Data flow

`/api/stream` → `useStreamEvents` hook → per-page reducer. Pages are server
components fetching `listRunSummaries` / `getRunSnapshot` for the initial paint;
client components own only the live-update merge.
