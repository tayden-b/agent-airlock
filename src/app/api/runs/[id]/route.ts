import { getRunSnapshot } from "@/server/storage/repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id: rawId } = await ctx.params;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // keep raw value
  }
  const snapshot = await getRunSnapshot(id);
  if (!snapshot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(snapshot);
}
