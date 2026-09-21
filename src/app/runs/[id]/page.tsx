import { notFound } from "next/navigation";
import { getRunSnapshot } from "@/server/storage/repository";
import { RunDetail } from "@/components/run-detail";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id: rawId } = await params;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // keep raw value
  }
  const snapshot = await getRunSnapshot(id);
  if (!snapshot) notFound();
  return (
    <main className="min-h-screen bg-zinc-50">
      <RunDetail initial={snapshot} />
    </main>
  );
}
