import { listRunSummaries } from "@/server/storage/repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const summaries = await listRunSummaries();
  return Response.json(summaries);
}
