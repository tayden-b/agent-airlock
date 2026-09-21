import { devinSessionToEvents } from "@/adapters/devin";
import { ingestEvent } from "@/server/ingestion";
import { getMeta, setMeta } from "@/server/storage/repository";

/**
 * Devin connector: pulls the org's recent sessions from the Devin REST API and
 * ingests them as `source: "devin"` runs. Enabled when DEVIN_API_KEY is set;
 * a no-op otherwise.
 *
 * `syncDevinIfStale` is called opportunistically by the stats endpoint (and can
 * be triggered directly via POST /api/collect/devin), so no cron is needed.
 */

const SYNC_KEY = "devin.lastSync";
const MIN_INTERVAL_MS = 60_000;
const API_BASE = "https://api.devin.ai";

export function devinConfigured(): boolean {
  return Boolean(process.env.DEVIN_API_KEY && process.env.DEVIN_ORG_ID);
}

interface SyncGlobal {
  __airlockDevinSync?: Promise<unknown>;
}

async function fetchSessions(apiKey: string, orgId: string): Promise<unknown[]> {
  const res = await fetch(`${API_BASE}/v3/organizations/${orgId}/sessions?limit=50`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`devin api ${res.status}`);
  return sessionsOf(await res.json());
}

function sessionsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const b = body as { items?: unknown[]; sessions?: unknown[]; data?: unknown[] };
  return b.items ?? b.sessions ?? b.data ?? [];
}

export async function syncDevinSessions(): Promise<{ sessions: number; ingested: number }> {
  const apiKey = process.env.DEVIN_API_KEY;
  const orgId = process.env.DEVIN_ORG_ID;
  if (!apiKey || !orgId) return { sessions: 0, ingested: 0 };

  const sessions = await fetchSessions(apiKey, orgId);
  let ingested = 0;
  for (const session of sessions) {
    for (const event of devinSessionToEvents(session)) {
      await ingestEvent(event);
      ingested++;
    }
  }
  await setMeta(SYNC_KEY, new Date().toISOString());
  return { sessions: sessions.length, ingested };
}

/** Fire-and-forget sync when the last one is older than the interval. */
export function syncDevinIfStale(): void {
  if (!devinConfigured()) return;
  const g = globalThis as SyncGlobal;
  if (g.__airlockDevinSync) return;
  g.__airlockDevinSync = (async () => {
    const last = await getMeta(SYNC_KEY);
    if (last && Date.now() - Date.parse(last) < MIN_INTERVAL_MS) return;
    await syncDevinSessions();
  })()
    .catch(() => {})
    .finally(() => {
      g.__airlockDevinSync = undefined;
    });
}
