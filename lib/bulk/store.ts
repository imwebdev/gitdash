import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Per-repo status within a bulk run
// ---------------------------------------------------------------------------
export type RepoRunStatus =
  | { phase: "queued" }
  | { phase: "pulling" }
  | { phase: "done" }
  | { phase: "failed"; message: string };

export interface BulkRun {
  repos: Array<{ id: number; name: string; path: string }>;
  statuses: Map<number, RepoRunStatus>;
  emitter: EventEmitter;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Singleton map on globalThis so it survives Next.js HMR
// ---------------------------------------------------------------------------
const bulkRunsKey = Symbol.for("gitdash.bulk.runs");
type GlobalWithBulkRuns = typeof globalThis & { [bulkRunsKey]?: Map<string, BulkRun> };
const g = globalThis as GlobalWithBulkRuns;

function getBulkRuns(): Map<string, BulkRun> {
  if (!g[bulkRunsKey]) {
    g[bulkRunsKey] = new Map();
  }
  return g[bulkRunsKey]!;
}

export function getBulkRun(runId: string): BulkRun | undefined {
  return getBulkRuns().get(runId);
}

export function setBulkRun(runId: string, run: BulkRun): void {
  getBulkRuns().set(runId, run);
}

/** Remove entries older than 5 minutes */
export function gcBulkRuns(): void {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, run] of getBulkRuns()) {
    if (run.startedAt < cutoff) {
      getBulkRuns().delete(id);
    }
  }
}
