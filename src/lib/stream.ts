"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamEvent } from "@/contracts";

/**
 * Subscribes to /api/stream for the life of the component. Returns whether
 * the EventSource is currently open so callers can show a live indicator.
 */
export function useStreamEvents(onEvent: (event: StreamEvent) => void): boolean {
  const [live, setLive] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.onmessage = (message) => {
      try {
        handler.current(JSON.parse(message.data) as StreamEvent);
      } catch {
        // malformed events are ignored; the stream stays open
      }
    };
    return () => source.close();
  }, []);

  return live;
}
