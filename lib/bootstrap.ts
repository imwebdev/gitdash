import { ensureSchedulerStarted } from "@/lib/scan/scheduler";
import { ensureWatcherStarted } from "@/lib/scan/watcher";
import { DEFAULT_CONFIG, type DiscoveryConfig } from "@/lib/scan/discover";
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

export async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  const config = await loadConfig();
  await ensureSchedulerStarted({ config });
  await ensureWatcherStarted();
}
