import { execFile } from "node:child_process";
import { platform } from "node:os";

const NOTIFY_TIMEOUT_MS = 3000;

function notifyEnabled(): boolean {
  const v = (process.env.GITDASH_NOTIFY ?? "").toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}

function send(cmd: string, args: string[]): void {
  execFile(cmd, args, { timeout: NOTIFY_TIMEOUT_MS }, (err) => {
    if (err) {
      // notify-send / osascript missing or failed — log once at debug level, never throw
      if (process.env.GITDASH_NOTIFY_DEBUG) {
        console.error(`[notify] ${cmd} failed:`, err.message);
      }
    }
  });
}

export function notifyTransition(opts: {
  repoName: string;
  branch: string | null;
  upstream: string | null;
  behind: number;
  ahead: number;
  state: "behind" | "diverged";
}): void {
  if (!notifyEnabled()) return;

  const upstream = opts.upstream ?? "remote";
  const branch = opts.branch ?? "?";
  const title = "gitdash";
  let body: string;
  if (opts.state === "diverged") {
    body = `${opts.repoName}: diverged from ${upstream} (${opts.ahead} ahead, ${opts.behind} behind)`;
  } else {
    body = `${opts.repoName}: ${opts.behind} behind ${upstream} on ${branch}`;
  }

  const plat = platform();
  if (plat === "linux") {
    send("notify-send", ["--app-name=gitdash", "--icon=git", title, body]);
  } else if (plat === "darwin") {
    const escaped = body.replace(/"/g, '\\"');
    const escapedTitle = title.replace(/"/g, '\\"');
    send("osascript", ["-e", `display notification "${escaped}" with title "${escapedTitle}"`]);
  }
  // Other platforms: silent no-op.
}
