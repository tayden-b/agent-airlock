import { getRunSnapshot } from "@/server/storage/repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const snapshot = await getRunSnapshot(id);
  if (!snapshot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(snapshot);
}
