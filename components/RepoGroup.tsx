"use client";

import { useState } from "react";
import type { RepoView } from "@/lib/state/store";
import { RepoCard, ROW_GRID, type GroupKind } from "./RepoCard";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  kind: GroupKind;
  headline: string;
  body: string;
  repos: RepoView[];
  csrfToken: string;
  defaultCollapsed?: boolean;
}

const TINT: Record<GroupKind, string> = {
  push: "tint-push",
  pull: "tint-pull",
  diverged: "tint-diverged",
  attention: "tint-attention",
  dirty: "tint-dirty",
  untracked: "bg-bg-elevated/40",
  clean: "tint-clean",
};

const ACCENT: Record<GroupKind, string> = {
  push: "text-accent-push",
  pull: "text-accent-pull",
  diverged: "text-accent-diverged",
  attention: "text-accent-attention",
  dirty: "text-accent-dirty",
  untracked: "text-fg-dim",
  clean: "text-accent-clean",
};

const EMPTY_COPY: Partial<Record<GroupKind, string>> = {
  clean: "Nothing in sync yet. Push or commit something to land a repo here.",
};

export function RepoGroup({
  kind,
  headline,
  body,
  repos,
  csrfToken,
  defaultCollapsed = false,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const isEmpty = repos.length === 0;
  const emptyCopy = EMPTY_COPY[kind];

  // Hide empty sections unless we have explicit empty-state copy for this kind.
  if (isEmpty && !emptyCopy) return null;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border-subtle",
        TINT[kind],
      )}
    >
      <header
        className={cn(
          "flex items-start gap-5 px-6 pb-4 pt-6",
          !isEmpty && "cursor-pointer",
        )}
        onClick={isEmpty ? undefined : () => setCollapsed((v) => !v)}
        role={isEmpty ? undefined : "button"}
        tabIndex={isEmpty ? undefined : 0}
        onKeyDown={
          isEmpty
            ? undefined
            : (e) => (e.key === "Enter" || e.key === " ") && setCollapsed((v) => !v)
        }
      >
        <div
          className={cn(
            "display shrink-0 text-[64px] leading-none tracking-display-tight",
            ACCENT[kind],
          )}
        >
          {repos.length}
        </div>

        <div className="flex flex-1 flex-col pt-2">
          <h2 className="display text-[22px] leading-tight text-fg">{headline}</h2>
          <p className="mt-1 text-[13px] text-fg-muted">{body}</p>
        </div>

        {!isEmpty && (
          <ChevronRight
            className={cn(
              "mt-3 h-4 w-4 shrink-0 text-fg-dim transition-transform",
              !collapsed && "rotate-90",
            )}
          />
        )}
      </header>

      {isEmpty && emptyCopy && (
        <div className="border-t border-border-subtle px-6 py-5 text-[13px] italic text-fg-dim">
          {emptyCopy}
        </div>
      )}

      {!isEmpty && !collapsed && (
        <div className="border-t border-border-subtle">
          <div
            className={cn(
              "grid items-center gap-x-4 border-b border-border-subtle bg-bg/30 px-6 py-2 text-[10px] uppercase tracking-[0.12em] text-fg-dim",
              ROW_GRID,
            )}
          >
            <span>Repo · branch</span>
            <span>Sync</span>
            <span>Local</span>
            <span>Last commit</span>
            <span>PRs</span>
            <span>Action</span>
            <span />
          </div>
          <div className="divide-y divide-border-subtle">
            {repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                kind={kind}
                csrfToken={csrfToken}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
