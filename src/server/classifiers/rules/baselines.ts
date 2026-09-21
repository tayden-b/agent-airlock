import type { DimensionScores, ToolKind } from "@/contracts";

/**
 * Starting-point risk before any rule fires. Reads/search are near-zero;
 * shell and edit start higher because a single call can do a lot; mcp starts
 * moderate because we don't know the server's blast radius yet.
 */
function score(scope: number, exposure: number, impact: number, reversibility: number): DimensionScores {
  return {
    scope: { risk: scope, source: "rules" },
    exposure: { risk: exposure, source: "rules" },
    impact: { risk: impact, source: "rules" },
    reversibility: { risk: reversibility, source: "rules" },
  };
}

export const BASELINES: Record<ToolKind, DimensionScores> = {
  read: score(0.03, 0.05, 0.02, 0.0),
  search: score(0.02, 0.03, 0.02, 0.0),
  edit: score(0.15, 0.05, 0.25, 0.3),
  shell: score(0.2, 0.1, 0.3, 0.3),
  web: score(0.1, 0.2, 0.1, 0.05),
  agent: score(0.1, 0.05, 0.1, 0.05),
  mcp: score(0.15, 0.15, 0.15, 0.15),
  other: score(0.1, 0.1, 0.1, 0.1),
};
