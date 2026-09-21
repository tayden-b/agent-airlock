# Airlock — Architecture

```
Claude Code session
        │  type:"http" hooks (JSON POSTs, 5s timeout)
        ▼
POST /api/hooks/claude-code ──────────────────────────────┐
        │  normalize.ts: raw hook JSON → normalized events │
        ▼                                                 │
ingestEvent (src/server/ingestion)                        │
        │  action.proposed:                               │ always
        │    redact → summarize → upsert → publish        │ 200 {}
        │    → scheduleAssessment (fire-and-forget) ◄─────┘
        ▼
assessAction
        │  for each provider in config.classifier.providers:
        │    CLASSIFIERS[name].assess(actionCtx)   (Promise.allSettled —
        │    a failing provider is skipped, not fatal)
        ▼
buildAssessment (src/server/policy)
        │  combineProviders + decide → verdict + reason
        ▼
attachAssessment → republish
        │
        ▼
bus.ts (in-process pub/sub) ──► GET /api/stream (SSE, heartbeat)
        │
        ▼
Dashboard: / (runs list) · /runs/:id (agents + action feed + risk breakdown)

Storage: Drizzle + libsql at file:./data/airlock.db
         (getDb()/getConfig()/bus cached on globalThis — survives dev reloads)
```

## Layers

| Layer       | Path                          | Notes                                        |
| ----------- | ----------------------------- | -------------------------------------------- |
| Contracts   | `src/contracts/`              | Zod schemas = source of truth for all shapes |
| Adapters    | `src/adapters/`               | Vendor JSON → normalized events              |
| Ingestion   | `src/server/ingestion/`       | Redact → summarize → persist → assess        |
| Redaction   | `src/server/redaction/`       | 12 secret patterns + sensitive paths         |
| Classifiers | `src/server/classifiers/`     | `rules`, `jev` behind `Classifier` interface |
| Policy      | `src/server/policy/`          | Deterministic combine + verdict              |
| Storage     | `src/server/storage/`         | Drizzle sqlite, repository upserts           |
| Bus         | `src/server/bus.ts`           | In-process SSE fan-out                       |
| API         | `src/app/api/`                | hooks intake, SSE stream, runs endpoints     |
| UI          | `src/app/`, `src/components/` | Runs dashboard + run detail, live via SSE    |

## Identity

- `runIdFor(source, sessionId)` → `"claude-code:sess_…"` — one run per session.
- `agentIdFor(runId, agentId)` — subagents keyed inside their run; the main
  thread is the reserved id `main`.
- `actionIdFor(runId, toolUseId)` — Pre/Post payloads share `tool_use_id`, so a
  proposal and its outcome resolve to one action row. Missing ids get a
  deterministic `synth-` FNV-1a fallback.

## Assessment pipeline

Every `action.proposed` is persisted immediately (so the feed shows it even if
scoring is slow), then assessed asynchronously:

1. `rules` provider seeds per-`ToolKind` baselines and adds deltas for each
   fired rule (18 matchers across `shell.*`, `path.*`, `edit.*`, `web.*`,
   `mcp.*`), clamped to [0,1].
2. `jev` provider asks TypeSafe Jev four `score` questions — one per dimension —
   against a serialized context (action, agent, run) and maps each 0–4 level to
   a risk fraction. Skipped entirely when `TYPESAFE_API_KEY` is unset.
3. `combineProviders` merges provider scores; `decide` applies thresholds
   (`deny ≥ 0.80`, `review ≥ 0.50`, `minConfidenceForAllow = 0.6`) plus
   `forceDenyRules` (e.g. `shell.pipe_to_shell`).
4. The resulting `Assessment` (verdict, per-dimension scores, rule hits, reason,
   policy version, per-provider latency) is attached and republished.

Provider failures are isolated with `Promise.allSettled` — an action can carry a
rules-only assessment if Jev is unreachable.

## Ordering and idempotency

- Repository upserts are idempotent; replaying the same fixture twice is safe.
- A `completed`/`failed` event that arrives without a prior proposal inserts a
  reconstructed row so no outcome is lost.
- Assessments are attached once; an event that lands after an assessment does
  not retrigger scoring.
