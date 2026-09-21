import { NormalizedEventSchema } from "@/contracts";
import { ingestEvent } from "@/server/ingestion";
import { hooksAuthorized } from "@/server/hooks-auth";

export const dynamic = "force-dynamic";

/**
 * Source-agnostic intake: accepts an already-normalized event (the contract
 * adapters emit). Used by the usage reporter and any future agent source that
 * normalizes its own telemetry rather than sending raw hook payloads.
 */
export async function POST(request: Request): Promise<Response> {
  if (!hooksAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({});
  }

  const parsed = NormalizedEventSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[airlock] dropped event: ${parsed.error.message.slice(0, 300)}`);
    return Response.json({});
  }

  try {
    await ingestEvent(parsed.data);
  } catch (err) {
    console.error(`[airlock] ingest failed for ${parsed.data.kind}:`, err);
  }
  return Response.json({});
}
