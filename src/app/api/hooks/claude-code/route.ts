import { normalizeClaudeCodeEvent } from "@/adapters/claude-code/normalize";
import { ingestEvent } from "@/server/ingestion";
import { hooksAuthorized } from "@/server/hooks-auth";

export const dynamic = "force-dynamic";

/**
 * Claude Code `type: "http"` hook intake. Always 200 — Airlock is a passive
 * observer and must never block or fail the agent's hook call. Row writes are
 * awaited (they're milliseconds of sqlite work) so ordering is preserved;
 * risk assessment is scheduled asynchronously after the ack.
 */
export async function POST(request: Request): Promise<Response> {
  if (!hooksAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({});
  }

  const result = normalizeClaudeCodeEvent(raw, { receivedAt: new Date().toISOString() });
  if (result.error) {
    console.warn(
      `[airlock] dropped hook payload: ${result.error} :: ${JSON.stringify(raw).slice(0, 500)}`,
    );
    return Response.json({});
  }

  for (const event of result.events) {
    try {
      await ingestEvent(event);
    } catch (err) {
      console.error(`[airlock] ingest failed for ${event.kind}:`, err);
    }
  }

  return Response.json({});
}
