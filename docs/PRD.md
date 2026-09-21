# Airlock — Product Requirements

## Problem

Multi-agent coding sessions (Claude Code subagents, future Devin CLI sessions) take
many tool actions per minute — reads, edits, shell commands, web fetches, MCP calls.
Today there is no way to watch what those agents are doing in aggregate, let alone
reason about which actions were risky. Audit trails are per-session transcripts;
nobody reads them.

## Product

Airlock is a **local-first, shadow-mode safety console**. It observes agent sessions
through the agent's own hook mechanism, and for every proposed tool action it:

1. **Normalizes** the raw hook payload into a vendor-neutral event.
2. **Redacts** secrets and sensitive values before anything is stored or scored.
3. **Scores risk** on four dimensions — scope, exposure, impact, reversibility —
   using pluggable classifier providers (deterministic rules, TypeSafe Jev).
4. **Applies a deterministic shadow policy** that combines provider scores into a
   verdict: `allow` / `review` / `deny`.
5. **Streams everything live** to a web console over SSE.

In shadow mode, verdicts are recorded and displayed but never enforced — the policy
says what _would_ have happened, so the policy can be tuned against real traffic
before any enforcement exists.

## Users

- A single developer running agent sessions on their own machine (v1).
- Later: a team lead auditing shared agent fleets (out of scope for v1).

## Requirements

### Functional

- Ingest Claude Code `type: "http"` hook events at `POST /api/hooks/claude-code`,
  acknowledging within milliseconds and never blocking the agent.
- Correlate Pre/Post tool-use payloads into a single action lifecycle
  (proposed → completed/failed), keyed by `tool_use_id`.
- Model subagents as first-class agents under a run, linked to the parent agent
  that spawned them.
- Persist runs, agents, actions, and assessments to a local sqlite database.
- Stream all state changes over `GET /api/stream` (SSE) so the dashboard updates
  live without polling.
- Serve a runs list (`/`) and a per-run detail view (`/runs/:id`) showing agents,
  the action feed, verdicts, per-dimension risk breakdowns, and the rules that hit.
- Provide a replay path (`pnpm replay <fixture>`) that POSTs a recorded session to
  the live HTTP endpoint, exercising the identical production code path.

### Non-functional

- **Passive**: the hook endpoint always returns `200 {}` — it can never break a
  session even if classification fails.
- **Local-first**: sqlite file under `./data/`, no external services required
  except the optional Jev API.
- **Redaction before persistence**: raw tool input is never stored; only redacted,
  truncated values are.
- **Deterministic policy**: given the same provider assessments, the verdict is
  always the same and the reason is explainable (`assessment.reason`).

## Success criteria

- Run `pnpm dev`, point Claude Code hooks at it (or `pnpm replay` a fixture), and
  watch a live feed of actions each labeled allow/review/deny within seconds.
- Dangerous patterns (`.env` reads, `curl | sh`, force pushes, credential paths)
  surface as `review` or `deny` with a human-readable reason and rule hits.
