# Airlock — Build Plan

Execution order used to build v1 (stacked PRs, bottom-up). Each PR is
self-contained: `pnpm check` passes at every layer.

## PR 1 — rules classifier (#1)

- `src/server/classifiers/rules/index.ts` — `rulesClassifier` implementing the
  `Classifier` interface: builds a `RuleContext`, seeds `ToolKind` baselines,
  applies fired-rule deltas clamped to [0,1].
- `rules.test.ts` — matcher coverage plus end-to-end verdicts through
  `buildAssessment` (curl|sh → deny, `.env` read → review, plain read → allow).
- Repo-wide prettier pass as a separate commit.

## PR 2 — Jev provider (#2)

- `src/server/classifiers/jev/index.ts` — `@typesafe-ai/sdk` `TypeSafeClient`,
  four `score` questions (one per dimension, run in parallel on the same state),
  0–4 level → risk fraction mapping. Client lazy-cached on `globalThis`; missing
  `TYPESAFE_API_KEY` throws at construction, which ingestion treats as a skipped
  provider.
- `jev.test.ts` — injects a fake `fetch`; verifies payload shape, mapping,
  error propagation.
- `classifiers/index.ts` registry; `airlock.config.ts` providers `["rules","jev"]`.

## PR 3 — ingestion + API + replay (#3)

- `src/server/ingestion/index.ts` — `ingestEvent` switch over all 9 normalized
  event kinds; `assessAction` runs providers via `Promise.allSettled` and
  `attachAssessment`; `scheduleAssessment` is fire-and-forget after the ack.
- `POST /api/hooks/claude-code` — always `200 {}`, errors logged only.
- `GET /api/stream` — SSE with heartbeat + abort cleanup.
- `GET /api/runs`, `GET /api/runs/[id]` — list + snapshot JSON.
- `scripts/replay.ts` — JSONL fixture → POST to the live endpoint (`--delay`,
  `--url` flags).
- `ingestion.test.ts` — replays the fanout fixture into a test db; asserts
  run/agent/action state, verdicts, and redaction.

## PR 4 — dashboard UI (#4)

- `src/lib/stream.ts` (`useStreamEvents` EventSource hook), `src/lib/display.ts`
  (verdict styles, time/risk formatting).
- `src/components/runs-dashboard.tsx`, `src/components/run-detail.tsx`.
- `src/app/page.tsx`, `src/app/runs/[id]/page.tsx`, layout metadata.
- Fix included: percent-decoding of dynamic route params (`:` in run ids).

## PR 5 — docs + CI (this PR)

- `docs/PRD.md`, `SCOPE.md`, `ARCHITECTURE.md`, `UI-SPEC.md`, `BUILD-PLAN.md`
- README rewrite (quickstart, replay, hook setup, config)
- `.github/workflows/ci.yml` — lint, typecheck, test, build
- `.claude/settings.example.json` — copy-paste hook config
- HANDOFF.md marked complete

## Conventions to keep

- Contracts (`src/contracts/domain.ts`) are the only cross-layer vocabulary;
  `Schema.parse` at every storage read.
- Module singletons cached on `globalThis` (config, db, bus, Jev client).
- Redact before persist, always.
- Hook endpoint stays passive — every change that would make it respond with a
  decision is a v2 discussion.
