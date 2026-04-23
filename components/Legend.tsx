"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUSES: { key: string; label: string; dot: string; what: string; doThis: string }[] = [
  {
    key: "clean",
    label: "CLEAN",
    dot: "bg-status-clean",
    what: "Everything you have locally matches GitHub, and you have no uncommitted changes.",
    doThis: "Nothing to do.",
  },
  {
    key: "dirty",
    label: "DIRTY",
    dot: "bg-status-dirty",
    what: "You have unsaved local changes — files you've edited, added, or deleted but haven't committed yet. (Think: unsaved changes in your working folder.)",
    doThis: "Either commit them (make a snapshot) in your terminal, or click Stash to set them aside temporarily.",
  },
  {
    key: "ahead",
    label: "AHEAD",
    dot: "bg-status-ahead",
    what: "You have committed changes locally, but GitHub doesn't have them yet.",
    doThis: "Click Push to upload your commits to GitHub.",
  },
  {
    key: "behind",
    label: "BEHIND",
    dot: "bg-status-behind",
    what: "GitHub has new commits that you don't have locally. Someone else (or another machine of yours) pushed them.",
    doThis: "Click Pull to download them.",
  },
  {
    key: "diverged",
    label: "DIVERGED",
    dot: "bg-status-diverged",
    what: "Both you and GitHub have new commits on this branch. History split into two lines.",
    doThis: "Click Merge to combine them. You may get conflicts to resolve.",
  },
  {
    key: "no-upstream",
    label: "NO UPSTREAM",
    dot: "bg-status-noupstream",
    what: "This branch isn't linked to a GitHub branch yet — gitdash can't tell if you're ahead or behind.",
    doThis: "Push from your terminal once with -u to set tracking, then this repo will show a real status.",
  },
  {
    key: "weird",
    label: "WEIRD",
    dot: "bg-status-weird",
    what: "Git is mid-operation: a merge, rebase, cherry-pick, or bisect is in progress. OR the working folder has 1000+ changed files / 500+ deletions (probably a half-finished rewrite).",
    doThis: "Open the folder in your editor and figure out what you were doing. Don't click Pull/Push until it's resolved.",
  },
];

const ACTIONS: { label: string; what: string }[] = [
  {
    label: "Fetch",
    what: "Ask GitHub 'what's new?' without changing any of your files. Safe to click anytime. Updates the AHEAD/BEHIND numbers.",
  },
  {
    label: "Pull",
    what: "Download new commits from GitHub into your local branch. Only works if your branch is a clean catch-up (no diverged history). If it would need to merge, Pull refuses — use Merge instead.",
  },
  {
    label: "Push",
    what: "Upload your local commits to GitHub. If you have 10+ commits ready to push, you'll get a confirmation first.",
  },
  {
    label: "Merge",
    what: "Combine GitHub's new commits with yours, creating a merge commit. Use this when status is DIVERGED. If there are conflicts, gitdash leaves the repo in the conflict state and tells you — you resolve in your editor.",
  },
  {
    label: "Stash",
    what: "Hide your uncommitted changes in a temporary 'pocket' (git stash). Use this when you want to Pull but have DIRTY changes in the way. You can restore them later from your terminal (git stash pop) or we'll add an Unstash button soon.",
  },
  {
    label: "GitHub",
    what: "Open this repo's page on github.com in a new browser tab.",
  },
  {
    label: "Editor",
    what: "Open this folder in VS Code (or whatever your $EDITOR is set to).",
  },
];

export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border bg-muted/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <HelpCircle className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wider">What do these words and buttons mean?</span>
      </button>

      {open && (
        <div className="grid gap-6 px-4 pb-5 pt-1 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">Status words</h3>
            <div className="space-y-3">
              {STATUSES.map((s) => (
                <div key={s.key} className="grid grid-cols-[90px_1fr] gap-3">
                  <div className="flex items-start gap-2">
                    <span className={cn("mt-1 h-2 w-2 rounded-full", s.dot)} />
                    <span className="text-xs font-semibold">{s.label}</span>
                  </div>
                  <div className="text-xs leading-relaxed text-muted-foreground">
                    <div>{s.what}</div>
                    <div className="mt-0.5 text-foreground/80">
                      <span className="text-muted-foreground">→ </span>
                      {s.doThis}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">Action buttons</h3>
            <div className="space-y-3">
              {ACTIONS.map((a) => (
                <div key={a.label} className="grid grid-cols-[90px_1fr] gap-3">
                  <div className="text-xs font-semibold">{a.label}</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{a.what}</div>
                </div>
              ))}
            </div>

            <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wider text-foreground">Column headers</h3>
            <dl className="space-y-1 text-xs text-muted-foreground">
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <dt className="font-semibold text-foreground/80">vs GITHUB</dt>
                <dd>How many commits your local branch is ahead ↑ or behind ↓ GitHub.</dd>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <dt className="font-semibold text-foreground/80">UNCOMMITTED</dt>
                <dd>Count of files you've changed but not committed yet. Number in parens is untracked (brand-new) files.</dd>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-3">
                <dt className="font-semibold text-foreground/80">LAST COMMIT</dt>
                <dd>How long ago you (or anyone) made the most recent commit on the current branch.</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
