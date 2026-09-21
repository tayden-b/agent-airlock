import { z } from "zod";
import { ActionSchema, AgentSchema, RunSchema } from "./domain";

/**
 * Stream events: what the server pushes to the browser over SSE.
 * Each event carries the full current row, so clients only ever upsert.
 */

export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.upserted"), run: RunSchema }),
  z.object({ type: z.literal("agent.upserted"), agent: AgentSchema }),
  z.object({ type: z.literal("action.upserted"), action: ActionSchema }),
  z.object({ type: z.literal("heartbeat"), at: z.string() }),
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;
