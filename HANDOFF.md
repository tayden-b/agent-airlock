# Airlock — Handoff to Devin

Local-first shadow-mode safety console for multi-agent coding sessions (Claude Code now, Devin CLI later).
Hook events → redact → classify risk → deterministic shadow policy → live dashboard.

## Current stage: foundation scaffolded, ingestion/routes/UI not yet wired

### Done (verified, in `src/`)

- `src/contracts/` — domain, events, stream, claude-code Zod schemas (source of truth for all shapes)
- `src/server/config.ts` + `airlock.config.ts` — typed config, env overrides
- `src/server/redaction/` — secret-pattern redaction (12 pattern kinds) + sensitive-path detection
- `src/server/policy/` — `combineProviders` / `decide` / `buildAssessment` (deterministic shadow policy)
- `src/server/classifiers/tool-kind.ts` — Claude Code tool name → `ToolKind`
- `src/server/classifiers/types.ts` — `Classifier` / `ProviderAssessment` interfaces
- `src/server/ingestion/summarize.ts` — one-line human summary per tool call
- `src/server/storage/` — Drizzle sqlite schema, client (`getDb`/`createTestDb`), repository (upserts, `listRunSummaries`)
- `src/server/bus.ts` — in-process SSE pub/sub
- `src/adapters/claude-code/normalize.ts` + `normalize.test.ts` + 14 fixtures — Claude Code hook JSON → normalized events
- `docs/INTEGRATIONS.md`, `fixtures/sessions/research-fanout.jsonl`
- shadcn UI components installed (`src/components/ui/`), Next 16 app shell (`src/app/`)

### In progress — pick up here

- **`src/server/classifiers/rules/`** — rules-based risk classifier. `baselines.ts` (per-`ToolKind` starting risk) and `definitions.ts` (18 rule matchers: `shell.*`, `path.*`, `edit.*`, `web.*`, `mcp.*`) exist. **Still needed:** `index.ts` exporting `rulesClassifier: Classifier` that runs `RULES` against a `buildContext()`-built `RuleContext`, merges baseline + rule-hit deltas into `DimensionScores`, and returns a `ProviderAssessment`; plus `rules.test.ts`. This is the last piece the policy engine needs to run end-to-end.

### Not started

- Ingestion pipeline: wire `normalize.ts` → `redaction` → `summarize` → `repository` upserts → `bus.publishStream`, then run classifiers async and `attachAssessment`.
- API routes: `POST /api/hooks/claude-code` (fast ack), `GET /api/stream` (SSE), runs list/snapshot routes.
- `scripts/replay.ts` — replay a fixture session file through the pipeline (fallback demo path when no live Claude Code session is available).
- Minimal live-feed page under `src/app/`.
- Docs: PRD, SCOPE, ARCHITECTURE, UI-SPEC, BUILD-PLAN (suggested Devin PR breakdown), README, CI workflow, `.claude/settings.example.json`.
- Repo is not yet a git repository — no commits, no remote. `gh repo create tayden-b/agent-airlock --private` still needs to happen once `gh auth login` is done locally.

### Suggested PR breakdown for Devin

1. Finish `rules` classifier + tests, wire into `policy` (uses existing `Classifier` interface — no contract changes needed)
2. Ingestion pipeline + storage wiring
3. API routes (hooks intake, SSE stream, runs endpoints) + `scripts/replay.ts`
4. Live dashboard UI (runs list, run detail, live feed) using shadcn components already installed
5. Docs, CI, Claude Code hook config example, polish

### Key conventions already established

- Everything downstream of an adapter speaks `src/contracts/domain.ts` types; parse on every read (`Schema.parse`) at repository boundaries.
- Config is singleton-cached on `globalThis` to survive Next dev-mode reloads (see `config.ts`, `storage/client.ts`, `bus.ts`) — copy this pattern for any new module-level singleton.
- `ToolKind` (`read/search/edit/shell/web/agent/mcp/other`) is the coarse category everything branches on; see `classifiers/tool-kind.ts`.
- Redaction always runs before anything is persisted or classified — never store raw tool input.
