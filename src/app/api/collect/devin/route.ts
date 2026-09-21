import { hooksAuthorized } from "@/server/hooks-auth";
import { syncDevinSessions } from "@/server/connectors/devin";

export const dynamic = "force-dynamic";

/** Manual/scheduled trigger for the Devin session sync. */
export async function POST(request: Request): Promise<Response> {
  if (!hooksAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await syncDevinSessions());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 502 },
    );
  }
}
