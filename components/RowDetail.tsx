"use client";

import { useEffect, useState } from "react";
import { Check, X as XIcon, Loader2, ExternalLink } from "lucide-react";

interface Commit {
  sha: string;
  subject: string;
  author: string;
  unixTimestamp: number;
}

interface Action {
  id: number;
  action: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
}

interface Metadata {
  fullPath: string;
  defaultBranch: string | null;
  remoteUrl: string | null;
  githubOwner: string | null;
  githubName: string | null;
  totalCommits: number | null;
}

interface Details {
  recentCommits: Commit[];
  recentActions: Action[];
  metadata: Metadata;
}

function relativeTime(unix: number | null | undefined): string {
  if (!unix) return "—";
  const deltaSec = Math.floor(Date.now() / 1000 - unix);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 30) return `${Math.floor(deltaSec / 86400)}d ago`;
  if (deltaSec < 86400 * 365) return `${Math.floor(deltaSec / (86400 * 30))}mo ago`;
  return `${Math.floor(deltaSec / (86400 * 365))}y ago`;
}

export function RowDetail({ repoId, open }: { repoId: number; open: boolean }) {
  const [data, setData] = useState<Details | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/repos/${repoId}/details`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d: Details) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoId]);

  if (!open) return null;

  return (
    <div
      className="border-t border-border-subtle bg-bg/30 px-4 py-5 sm:px-6"
      onClick={(e) => e.stopPropagation()}
    >
      {loading && !data && (
        <div className="flex items-center gap-2 text-[12px] text-fg-dim">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading details…
        </div>
      )}

      {error && !data && (
        <div className="text-[12px] text-accent-attention">
          Couldn't load details: {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <CommitsPanel commits={data.recentCommits} ghBase={ghBaseUrl(data.metadata)} />
          <ActionsPanel actions={data.recentActions} />
          <MetadataPanel meta={data.metadata} />
        </div>
      )}
    </div>
  );
}

function ghBaseUrl(m: Metadata): string | null {
  if (m.githubOwner && m.githubName) {
    return `https://github.com/${m.githubOwner}/${m.githubName}`;
  }
  return null;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-dim">
      {children}
    </h4>
  );
}

function CommitsPanel({ commits, ghBase }: { commits: Commit[]; ghBase: string | null }) {
  return (
    <div>
      <SectionHeading>Recent commits</SectionHeading>
      {commits.length === 0 ? (
        <p className="text-[12px] italic text-fg-dim">No commits yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {commits.map((c) => {
            const short = c.sha.slice(0, 7);
            const href = ghBase ? `${ghBase}/commit/${c.sha}` : null;
            const rowInner = (
              <>
                <span className="mono shrink-0 text-[11px] text-fg-dim">{short}</span>
                <span className="truncate text-[12px] text-fg" title={c.subject}>
                  {c.subject || "(no subject)"}
                </span>
                <span className="shrink-0 text-[11px] text-fg-dim" title={c.author}>
                  {c.author}
                </span>
                <span className="mono shrink-0 text-[11px] text-fg-dim tabular-nums">
                  {relativeTime(c.unixTimestamp)}
                </span>
              </>
            );
            return (
              <li key={c.sha}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid grid-cols-[52px_1fr_auto_auto] items-baseline gap-2 rounded px-1 py-0.5 hover:bg-bg-hover"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowInner}
                  </a>
                ) : (
                  <div className="grid grid-cols-[52px_1fr_auto_auto] items-baseline gap-2 px-1 py-0.5">
                    {rowInner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActionsPanel({ actions }: { actions: Action[] }) {
  return (
    <div>
      <SectionHeading>Recent gitdash actions</SectionHeading>
      {actions.length === 0 ? (
        <p className="text-[12px] italic text-fg-dim">
          No actions yet. Use Push / Pull / Commit &amp; push and they'll log here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {actions.map((a) => {
            const ok = a.exitCode === 0;
            const failed = a.exitCode !== null && a.exitCode !== 0;
            const running = a.finishedAt === null;
            return (
              <li
                key={a.id}
                className="grid grid-cols-[16px_1fr_auto] items-baseline gap-2 px-1 py-0.5"
              >
                <span className="flex h-4 items-center">
                  {running ? (
                    <Loader2 className="h-3 w-3 animate-spin text-fg-dim" />
                  ) : ok ? (
                    <Check className="h-3 w-3 text-accent-clean" />
                  ) : (
                    <XIcon className="h-3 w-3 text-accent-attention" />
                  )}
                </span>
                <span className="truncate text-[12px] text-fg">{a.action}</span>
                <span className="mono shrink-0 text-[11px] text-fg-dim tabular-nums">
                  {relativeTime(a.startedAt)}
                  {failed && ` · exit ${a.exitCode}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MetadataPanel({ meta }: { meta: Metadata }) {
  return (
    <div>
      <SectionHeading>Metadata</SectionHeading>
      <dl className="flex flex-col gap-2 text-[12px]">
        <Field label="Path">
          <span className="mono break-all text-fg-muted" style={{ userSelect: "text" }}>
            {meta.fullPath}
          </span>
        </Field>
        <Field label="Default branch">
          <span className="mono text-fg-muted">{meta.defaultBranch ?? "—"}</span>
        </Field>
        <Field label="Remote">
          {meta.githubOwner && meta.githubName ? (
            <a
              href={`https://github.com/${meta.githubOwner}/${meta.githubName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-fg-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {meta.githubOwner}/{meta.githubName}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="break-all text-fg-muted">{meta.remoteUrl ?? "—"}</span>
          )}
        </Field>
        <Field label="Total commits">
          <span className="mono tabular-nums text-fg-muted">
            {meta.totalCommits === null ? "—" : meta.totalCommits.toLocaleString()}
          </span>
        </Field>
      </dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-3">
      <dt className="text-[11px] uppercase tracking-[0.08em] text-fg-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
