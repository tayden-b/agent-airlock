import type { StreamEvent } from "@/contracts";

/**
 * In-process pub/sub for stream events. The SSE route subscribes; ingestion
 * and the assessment runner publish. Cached on globalThis so Next.js dev-mode
 * module reloads share one bus across route bundles.
 */

export type StreamSubscriber = (event: StreamEvent) => void;

interface BusState {
  nextId: number;
  subscribers: Map<number, StreamSubscriber>;
}

const MAX_SUBSCRIBERS = 100;

const globalKey = "__airlockBus" as const;
type BusGlobal = typeof globalThis & { [globalKey]?: BusState };

function state(): BusState {
  const g = globalThis as BusGlobal;
  if (!g[globalKey]) {
    g[globalKey] = { nextId: 1, subscribers: new Map() };
  }
  return g[globalKey];
}

/** Returns an unsubscribe function. */
export function subscribeStream(subscriber: StreamSubscriber): () => void {
  const s = state();
  const id = s.nextId++;
  if (s.subscribers.size >= MAX_SUBSCRIBERS) {
    // Local-first tool: evicting the oldest subscriber is better than leaking.
    const oldest = s.subscribers.keys().next().value;
    if (oldest !== undefined) s.subscribers.delete(oldest);
  }
  s.subscribers.set(id, subscriber);
  return () => {
    s.subscribers.delete(id);
  };
}

export function publishStream(event: StreamEvent): void {
  const s = state();
  for (const subscriber of [...s.subscribers.values()]) {
    try {
      subscriber(event);
    } catch {
      s.subscribers.delete([...s.subscribers.entries()].find(([, fn]) => fn === subscriber)?.[0] ?? -1);
    }
  }
}

/** Test helper: number of live subscribers. */
export function subscriberCount(): number {
  return state().subscribers.size;
}
