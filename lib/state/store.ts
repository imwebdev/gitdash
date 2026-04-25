import { EventEmitter } from "node:events";
import { getAllSnapshots, listActiveRepos, type RepoRow, type SnapshotRow } from "@/lib/db/repos";

export interface RepoView {
  id: number;
  repoPath: string;
  displayName: string;
  isSystemRepo: boolean;
  githubOwner: string | null;
  githubName: string | null;
  snapshot: SnapshotRow | null;
  derivedState: DerivedState;
  pullAlertCount?: number;
}

export type DerivedState =
  | "clean"
  | "ahead"
  | "behind"
  | "diverged"
  | "dirty"
  | "read-only"
  | "no-upstream"
  | "weird"
  | "unknown"
  // Repo on GitHub is missing (deleted/renamed/private). User needs to fix
  // the remote URL or remove tracking. Surfaced in attention.
  | "gone"
  // Local branch isn't on the remote yet. Push button will publish it
  // with --set-upstream.
  | "unpushed-branch";

export function deriveState(row: RepoRow, snap: SnapshotRow | null): DerivedState {
  if (!snap) return "unknown";
  if (snap.weirdFlags.length > 0) return "weird";
  if (snap.detached) return "weird";
  if (snap.stagedDeletions > 500) return "weird";
  const dirty = snap.dirtyTracked + snap.staged + snap.untracked + snap.conflicted;
  if (dirty > 1000) return "weird";
  // Read-only takes precedence over actionable states (dirty / ahead / etc.)
  // — gitdash actions can't push to these repos, so showing them in
  // push/diverged/dirty would be a bait-and-switch. The row stays visible
  // but gets routed to its own bucket where action buttons are hidden.
  if (snap.canPush === false) return "read-only";
  // 'gone' beats dirty too — local edits don't matter if there's nowhere
  // to push them. User has to fix the remote first.
  if (snap.remoteState === "gone") return "gone";
  if (dirty > 0) return "dirty";
  if (snap.remoteState === "diverged") return "diverged";
  if (snap.remoteState === "ahead" || snap.ahead > 0) return "ahead";
  if (snap.remoteState === "behind" || snap.behind > 0) return "behind";
  if (snap.remoteState === "unpushed-branch") return "unpushed-branch";
  if (!snap.upstream && !snap.remoteState) return "no-upstream";
  if (snap.remoteState === "unknown") return "unknown";
  return "clean";
}

export function displayName(repoPath: string): string {
  const parts = repoPath.split("/").filter(Boolean);
  if (parts.length === 0) return repoPath;
  const last = parts[parts.length - 1]!;
  return last === "" ? repoPath : last;
}

class Store extends EventEmitter {
  snapshot(includeSystem: boolean): RepoView[] {
    const repos = listActiveRepos(includeSystem);
    const snaps = getAllSnapshots();
    return repos.map((row) => {
      const snap = snaps.get(row.id) ?? null;
      return {
        id: row.id,
        repoPath: row.repoPath,
        displayName: displayName(row.repoPath),
        isSystemRepo: row.isSystemRepo,
        githubOwner: row.githubOwner,
        githubName: row.githubName,
        snapshot: snap,
        derivedState: deriveState(row, snap),
      };
    });
  }

  emitUpdate(repoId: number): void {
    this.emit("update", repoId);
  }

  emitBulk(): void {
    this.emit("bulk");
  }
}

const globalKey = Symbol.for("gitdash.store");
type GlobalWithStore = typeof globalThis & { [globalKey]?: Store };
const globalObj = globalThis as GlobalWithStore;

export function getStore(): Store {
  if (!globalObj[globalKey]) {
    globalObj[globalKey] = new Store();
  }
  return globalObj[globalKey]!;
}
