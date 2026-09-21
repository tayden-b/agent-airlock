# Airlock — Scope

## v1 (this codebase)

**In scope**

- Single adapter: Claude Code `type: "http"` hooks.
- Single operator, single machine, local sqlite storage.
- Shadow mode only: observe, score, record, display. Verdicts are advisory.
- Two classifier providers behind the `Classifier` interface:
  - `rules` — deterministic pattern/baseline scoring, always available.
  - `jev` — TypeSafe Jev System One scoring, active when `TYPESAFE_API_KEY` is set.
- Live console: runs list, run detail, SSE-driven updates.
- Replay tooling for demos and tests (`scripts/replay.ts`, `fixtures/`).

**Explicitly out of scope**

- **Enforcement.** No action is ever blocked, delayed, or altered. `PreToolUse`
  responses carry no permission decision.
- **Auth / multi-user.** The console and endpoints assume localhost trust. Do not
  expose them on a network.
- **Non-Claude-Code adapters** (Devin CLI, Cursor, etc.). `SourceSchema` already
  enumerates them; the adapter interface exists, the adapters do not.
- **Historical analysis, retention policies, exports.** Storage grows unbounded;
  `data/airlock.db` is disposable.
- **Alerting / notifications.** The console is the only surface.
- **Remote/multi-tenant deployment.** "Local-first" is a requirement, not a
  phase-one limitation.

## Likely v2 candidates (not committed)

- Flip `deny` verdicts into real `PreToolUse` denials (hooks already run
  synchronously; the response shape is the only change).
- Additional adapters via the same `contracts/events.ts` normalized events.
- Configurable policy thresholds in the UI (currently `airlock.config.ts` only).
