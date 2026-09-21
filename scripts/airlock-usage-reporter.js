#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- runs standalone as CJS via `node`, outside this repo */
/**
 * Airlock token-usage reporter — Claude Code SessionEnd command hook.
 *
 * Reads the hook payload on stdin, sums the session transcript's token usage,
 * and POSTs a normalized `run.usage` event to Airlock's /api/events endpoint.
 * Copy to ~/.claude/airlock-usage.js and reference it from a SessionEnd hook:
 *
 *   { "type": "command", "command": "node \"$HOME/.claude/airlock-usage.js\"" }
 *
 * Environment:
 *   AIRLOCK_URL        base URL (default http://127.0.0.1:3000)
 *   AIRLOCK_HOOK_SECRET  shared secret, sent as x-airlock-key when set
 */

const fs = require("fs");
const http = require("http");
const https = require("https");

const BASE = process.env.AIRLOCK_URL || "http://127.0.0.1:3000";

let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(data);
    const transcript = event.transcript_path;
    if (!transcript || !event.session_id) return;

    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    for (const line of fs.readFileSync(transcript, "utf8").split("\n")) {
      try {
        const u = JSON.parse(line).message?.usage;
        if (!u) continue;
        usage.inputTokens += u.input_tokens || 0;
        usage.outputTokens += u.output_tokens || 0;
        usage.cacheReadTokens += u.cache_read_input_tokens || 0;
        usage.cacheCreationTokens += u.cache_creation_input_tokens || 0;
      } catch {
        // malformed line — skip
      }
    }
    usage.totalTokens =
      usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    if (usage.totalTokens === 0) return;

    const body = JSON.stringify({
      source: "claude-code",
      sessionId: event.session_id,
      at: new Date().toISOString(),
      kind: "run.usage",
      usage,
    });
    const url = new URL(`${BASE}/api/events`);
    const client = url.protocol === "https:" ? https : http;
    const headers = { "content-type": "application/json" };
    if (process.env.AIRLOCK_HOOK_SECRET) {
      headers["x-airlock-key"] = process.env.AIRLOCK_HOOK_SECRET;
    }
    const req = client.request(url, { method: "POST", headers, timeout: 5000 }, (res) =>
      res.resume(),
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.end(body);
  } catch {
    // never block the agent's hook pipeline
  }
});
