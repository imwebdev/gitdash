import { ensureSchedulerStarted, getScheduler } from "@/lib/scan/scheduler";
import { ensureWatcherStarted, getWatcher } from "@/lib/scan/watcher";
import { DEFAULT_CONFIG, type DiscoveryConfig } from "@/lib/scan/discover";
import { closeDb } from "@/lib/db/schema";
import { readFile } from "node:fs/promises";
import path from "node:path";

let bootstrapped = false;

async function loadConfig(): Promise<DiscoveryConfig> {
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? ".", ".config");
  const configPath = path.join(xdg, "gitdash", "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DiscoveryConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const shutdownKey = Symbol.for("gitdash.shutdown.registered");
type GlobalWithShutdown = typeof globalThis & { [shutdownKey]?: boolean };

function registerShutdownHandlers(): void {
  const g = globalThis as GlobalWithShutdown;
  if (g[shutdownKey]) return;
  g[shutdownKey] = true;

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[gitdash] ${signal} received, shutting down`);
    // Stop producers first so in-flight writes drain against a live DB.
    try {
      getScheduler()?.stop();
    } catch (err) {
      console.error("[gitdash] scheduler stop failed", err);
    }
    try {
      getWatcher()?.stop();
    } catch (err) {
      console.error("[gitdash] watcher stop failed", err);
    }
    // Give chokidar a tick to release fd handles before closing the DB.
    setTimeout(() => {
      try {
        closeDb();
      } catch (err) {
        console.error("[gitdash] db close failed", err);
      }
      process.exit(0);
    }, 150);
    // Hard safety net if something hangs.
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

export async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const config = await loadConfig();
  await ensureSchedulerStarted({ config });
  await ensureWatcherStarted();
  registerShutdownHandlers();
}
