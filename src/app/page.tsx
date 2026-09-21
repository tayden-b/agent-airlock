import { listRunSummaries } from "@/server/storage/repository";
import { RunsDashboard } from "@/components/runs-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const summaries = await listRunSummaries();
  return (
    <main className="min-h-screen bg-zinc-50">
      <RunsDashboard initial={summaries} />
    </main>
  );
}
