# Airlock

Shadow-mode safety console for multi-agent coding sessions.

Airlock watches Claude Code sessions through their HTTP hooks, redacts secrets,
scores every tool action's risk (scope / exposure / impact / reversibility), and
shows a live console of what each agent is doing — labeled `allow`, `review`, or
`deny`. In v1 nothing is ever blocked: verdicts show what a policy _would_ have
done, so it can be tuned against real traffic.

## Quickstart

Requires Node ≥ 20.19 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. To see data without a live Claude Code session,
replay the bundled multi-agent fixture against the running server:

```bash
pnpm replay fixtures/sessions/research-fanout.jsonl
```

## Pointing Claude Code at it

Copy `.claude/settings.example.json` into your project's `.claude/settings.json`
(or merge the `hooks` block into `~/.claude/settings.json`). Claude Code then
POSTs every lifecycle event to `POST /api/hooks/claude-code`. The endpoint acks
in milliseconds and never blocks. See `docs/INTEGRATIONS.md` for the full
event-mapping table.

## Risk scoring

Two classifier providers run per action (`airlock.config.ts`):

- **`rules`** — deterministic: per-tool-kind baselines + 18 pattern rules
  (pipe-to-shell, credential paths, `.env` reads, force push, …). Always on.
- **`jev`** — TypeSafe Jev System One scoring, one question per risk dimension.
  Active when `TYPESAFE_API_KEY` is set in the environment; skipped otherwise.

Provider scores merge in `src/server/policy/` and are decided by fixed
thresholds — `deny ≥ 0.80`, `review ≥ 0.50`, `allow` only at confidence ≥ 0.6 —
plus force-deny rules. Every assessment records which providers ran, which rules
hit, and a human-readable reason.

## Development

```bash
pnpm check        # lint + typecheck + test + build
pnpm test         # vitest
pnpm replay …     # replay a fixture session
```

Data lives in `./data/airlock.db` (disposable sqlite; delete to reset). All
shapes are defined by Zod contracts in `src/contracts/`.

## Docs

- `docs/PRD.md` — what it is and why
- `docs/SCOPE.md` — what v1 does and deliberately doesn't
- `docs/ARCHITECTURE.md` — pipeline, layers, identity model
- `docs/UI-SPEC.md` — console layout and behavior
- `docs/INTEGRATIONS.md` — hook config + event mapping
- `docs/BUILD-PLAN.md` — how it was built, PR by PR
