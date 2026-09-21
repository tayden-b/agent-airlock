# Integrations

## How Airlock attaches

Airlock observes AI coding agents through their native hook mechanisms. For Claude Code, that means `type: "http"` hooks: Claude Code POSTs each lifecycle event's JSON payload to an Airlock endpoint as the session runs.

The endpoint is:

```
POST /api/hooks/claude-code
```

In v1, Airlock is a **passive observer**. The endpoint always responds `200` with `{}`, so it never makes a permission decision and never blocks or alters the agent's behavior. HTTP hooks are synchronous from Claude Code's perspective, so the endpoint acknowledges within milliseconds; assessment of the observed action happens asynchronously, after the ack. If Airlock is unreachable or times out, Claude Code treats the hook failure as non-blocking and continues.

## Claude Code setup

Add the following to `.claude/settings.json` (project-scoped) or `~/.claude/settings.json` (applies to all sessions for your user):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "http", "url": "http://127.0.0.1:3000/api/hooks/claude-code", "timeout": 5 }
        ]
      }
    ]
  }
}
```

Notes:

- If your settings define `allowedHttpHookUrls`, the Airlock URL must be included in that allowlist or the hooks will not fire.
- Hooks configured in settings also run inside subagents, so subagent tool calls are observed without extra configuration.

## Event mapping

Each raw hook payload is normalized into zero or more internal events (`src/adapters/claude-code/normalize.ts`):

| Hook event                           | Normalized event(s)                                                                                            | Effect                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `SessionStart`                       | `run.started`                                                                                                  | Upsert run (status active)                                      |
| `UserPromptSubmit` (main thread)     | `run.mission`                                                                                                  | Attach the mission text to the run                              |
| `UserPromptSubmit` (inside subagent) | `agent.mission`                                                                                                | Upsert the agent with its mission                               |
| `SubagentStart`                      | `agent.started`                                                                                                | Upsert agent (running), parented to `main`                      |
| `SubagentStop`                       | `agent.stopped`                                                                                                | Mark agent completed; keep last message preview                 |
| `PreToolUse`                         | `action.proposed`                                                                                              | Upsert action                                                   |
| `PostToolUse`                        | `action.completed`; plus `agent.mission` when the tool is `Agent`/`Task` and the response carries an `agentId` | Mark action succeeded; link the spawned subagent to its mission |
| `PostToolUseFailure`                 | `action.failed`                                                                                                | Mark action failed with the error                               |
| `SessionEnd`                         | `run.ended`                                                                                                    | Mark run ended with the reason                                  |
| Anything else (e.g. `Notification`)  | none                                                                                                           | Ignored; endpoint still acks `200`                              |

Payloads that fail schema validation are dropped with an error logged server-side; the hook still gets a `200`.

## Identity model

- `session_id` → **run**. The session id is stable for the whole Claude Code session, including inside subagents.
- `agent_id` → **agent**. Absent on the main thread, which is modeled as the reserved agent id `main`.
- `tool_use_id` → **action**. `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` for one tool call share the same `tool_use_id`, which correlates the proposal with its outcome.
- The `Agent`/`Task` tool's `PostToolUse` response carries `tool_response.agentId`, equal to the `agent_id` the spawned subagent later reports in `SubagentStart` and its own tool events. This is what links a subagent back to the mission text its parent gave it.
- When `tool_use_id` is absent, the adapter synthesizes a deterministic id (`synth-` + FNV-1a hash of agent id, tool name, and the key-sorted tool input) so Pre and Post payloads for the same call still correlate. Caveat: two identical calls (same tool, same input) without a `tool_use_id` collide on the same synthesized id and are indistinguishable.

## Simulator and replay

You do not need Claude Code installed to exercise the full pipeline. The built-in simulator emits the same raw Claude-shaped payloads this adapter consumes (see `src/adapters/claude-code/fixtures/`). To replay a recorded multi-agent session end to end:

```
pnpm replay fixtures/sessions/research-fanout.jsonl
```

`research-fanout.jsonl` is one raw hook payload per line: a session that fans out three Explore subagents, including sensitive reads, an exfiltration-shaped `curl`, an out-of-role `Edit`, and a force push.

## Generic event intake

`POST /api/events` accepts an already-normalized event (the `NormalizedEvent`
contract that adapters emit). Anything that can produce those shapes — a
transcript watcher, another agent's hook system, a shim — can report without
going through the Claude Code normalizer. The usage reporter
(`scripts/airlock-usage-reporter.js`) uses it for `run.usage` events.

## Authentication

Set `AIRLOCK_HOOK_SECRET` on the server to require a shared secret on both
intake endpoints; clients send it as the `x-airlock-key` header or `?key=`
query param. For Claude Code http hooks, append `?key=…` to each hook URL. The
usage reporter reads it from the `AIRLOCK_HOOK_SECRET` env var.

## Limitations

- Passive observation only. Airlock never blocks, approves, or denies anything; there is no enforcement in v1.
- One level of agent hierarchy is modeled: every subagent's parent is `main`. Agent teams and nested subagents (a subagent spawning its own subagents) are not modeled.
- A Devin CLI adapter is planned. Devin CLI supports `PreToolUse`/`PostToolUse` hooks carrying `session_id`/`prompt_id`; it will emit the same normalized events.
