import { readFileSync } from "node:fs";

/**
 * Replays a recorded hook session (one raw Claude Code payload per line)
 * through the live endpoint, so the full path — normalize, redact, classify,
 * persist, stream — runs inside the dev server and the dashboard updates in
 * real time.
 *
 *   pnpm replay fixtures/sessions/research-fanout.jsonl [--delay 150] [--url http://127.0.0.1:3000]
 */

function parseArgs(argv: string[]): { file: string; delay: number; url: string } {
  const args = { file: "", delay: 150, url: "http://127.0.0.1:3000" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--delay") args.delay = Number(argv[++i] ?? 150);
    else if (arg === "--url") args.url = argv[++i] ?? args.url;
    else if (!arg.startsWith("--")) args.file = arg;
  }
  if (!args.file) {
    console.error("usage: pnpm replay <file.jsonl> [--delay ms] [--url base]");
    process.exit(1);
  }
  return args;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const { file, delay, url } = parseArgs(process.argv.slice(2));
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  const endpoint = `${url.replace(/\/$/, "")}/api/hooks/claude-code`;

  console.log(`Replaying ${lines.length} hook events from ${file} -> ${endpoint}`);
  for (const [i, line] of lines.entries()) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: line,
    });
    const name = (JSON.parse(line) as { hook_event_name?: string }).hook_event_name ?? "?";
    if (!res.ok) {
      console.error(`[${i + 1}/${lines.length}] ${name} -> HTTP ${res.status}`);
    } else {
      console.log(`[${i + 1}/${lines.length}] ${name}`);
    }
    if (delay > 0) await sleep(delay);
  }
  console.log("Done. Assessments complete asynchronously — the dashboard updates over SSE.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
