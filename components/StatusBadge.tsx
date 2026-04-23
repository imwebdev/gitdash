import { cn } from "@/lib/utils";
import type { DerivedState } from "@/lib/state/store";

const STYLES: Record<
  DerivedState,
  { label: string; className: string; tooltip: string }
> = {
  clean: {
    label: "clean",
    className: "border-status-clean/40 bg-status-clean/10 text-status-clean",
    tooltip: "Clean — local matches GitHub and no uncommitted changes.",
  },
  ahead: {
    label: "ahead",
    className: "border-status-ahead/40 bg-status-ahead/10 text-status-ahead",
    tooltip: "Ahead — you have commits not yet pushed to GitHub. Click Push.",
  },
  behind: {
    label: "behind",
    className: "border-status-behind/40 bg-status-behind/10 text-status-behind",
    tooltip: "Behind — GitHub has commits you don't have locally. Click Pull.",
  },
  diverged: {
    label: "diverged",
    className: "border-status-diverged/40 bg-status-diverged/10 text-status-diverged",
    tooltip: "Diverged — both you and GitHub have new commits. Click Merge.",
  },
  dirty: {
    label: "dirty",
    className: "border-status-dirty/40 bg-status-dirty/10 text-status-dirty",
    tooltip:
      "Dirty — you have unsaved local changes (files edited/added/deleted but not committed). Commit them in your terminal or click Stash.",
  },
  "no-upstream": {
    label: "no upstream",
    className:
      "border-status-noupstream/40 bg-status-noupstream/10 text-status-noupstream border-dashed",
    tooltip:
      "No upstream — this branch isn't linked to a GitHub branch yet. Push with -u once from your terminal to link it.",
  },
  weird: {
    label: "weird",
    className: "border-status-weird/40 bg-status-weird/10 text-status-weird",
    tooltip:
      "Weird — git is mid-operation (merge/rebase/cherry-pick in progress) or the working folder has 1000+ changes. Don't click Pull/Push — open in your editor and sort it out.",
  },
  unknown: {
    label: "…",
    className: "border-muted bg-muted/20 text-muted-foreground",
    tooltip: "Still checking…",
  },
};

export function StatusBadge({ state }: { state: DerivedState }) {
  const s = STYLES[state];
  return (
    <span
      title={s.tooltip}
      className={cn(
        "inline-flex cursor-help items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}
