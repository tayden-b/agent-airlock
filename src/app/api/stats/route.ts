import { getDashboardStats } from "@/server/storage/repository";
import { syncDevinIfStale } from "@/server/connectors/devin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // Opportunistic connector sync; throttled to once a minute internally.
  syncDevinIfStale();
  return Response.json(await getDashboardStats());
}
