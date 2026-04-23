import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { listActiveRepos } from "@/lib/db/repos";
import { getScheduler } from "./scheduler";

class WatcherPool {
  private watchers = new Map<number, FSWatcher>();
  private debounceTimers = new Map<number, NodeJS.Timeout>();
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.refresh();
    setInterval(() => {
      this.refresh().catch((e) => console.error("[watcher] refresh failed", e));
    }, 60_000);
  }

  stop(): void {
    for (const w of this.watchers.values()) w.close().catch(() => {});
    this.watchers.clear();
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.started = false;
  }

  async refresh(): Promise<void> {
    const active = listActiveRepos(true);
    const activeIds = new Set(active.map((r) => r.id));
    for (const [id, w] of this.watchers) {
      if (!activeIds.has(id)) {
        w.close().catch(() => {});
        this.watchers.delete(id);
      }
    }
    for (const row of active) {
      if (this.watchers.has(row.id)) continue;
      const gitDir = row.gitDirPath;
      const targets = [
        path.join(gitDir, "HEAD"),
        path.join(gitDir, "index"),
        path.join(gitDir, "FETCH_HEAD"),
        path.join(gitDir, "packed-refs"),
        path.join(gitDir, "refs"),
      ];
      const watcher = chokidar.watch(targets, {
        ignoreInitial: true,
        persistent: true,
        depth: 3,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      });
      watcher.on("all", () => this.scheduleCollect(row.id));
      watcher.on("error", (err) => console.error(`[watcher] ${row.repoPath}`, err));
      this.watchers.set(row.id, watcher);
    }
  }

  private scheduleCollect(repoId: number): void {
    const existing = this.debounceTimers.get(repoId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(repoId);
      const scheduler = getScheduler();
      if (!scheduler) return;
      scheduler.collectOne(repoId).catch((e) => console.error("[watcher] collectOne failed", e));
    }, 300);
    this.debounceTimers.set(repoId, timer);
  }
}

const globalKey = Symbol.for("gitdash.watcher");
type GlobalWithWatcher = typeof globalThis & { [globalKey]?: WatcherPool };
const g = globalThis as GlobalWithWatcher;

export async function ensureWatcherStarted(): Promise<WatcherPool> {
  if (!g[globalKey]) {
    g[globalKey] = new WatcherPool();
    await g[globalKey]!.start();
  }
  return g[globalKey]!;
}
