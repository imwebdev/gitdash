"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const VERSION = process.env.NEXT_PUBLIC_GITDASH_VERSION ?? "";
const COMMIT = process.env.NEXT_PUBLIC_GITDASH_COMMIT ?? "";
const BUILT_AT = process.env.NEXT_PUBLIC_GITDASH_BUILT_AT ?? "";

export function VersionBadge() {
  const [copied, setCopied] = useState(false);
  if (!VERSION && !COMMIT) return null;

  const display = [VERSION && `v${VERSION}`, COMMIT].filter(Boolean).join(" · ");
  const copyText = `gitdash ${display.replaceAll(" · ", " (")}${COMMIT ? ")" : ""}`;
  const builtAtTooltip = BUILT_AT
    ? `Built ${new Date(Number(BUILT_AT)).toLocaleString()}`
    : "";

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable on http (non-localhost) — just no-op
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={builtAtTooltip || "Click to copy version"}
      className={cn(
        "fixed bottom-2 right-2 z-50 select-none rounded-md px-2 py-0.5 text-xs",
        "text-fg-dim opacity-70 transition-opacity hover:opacity-100",
        "font-mono tracking-tight",
      )}
      aria-label="gitdash version"
    >
      {copied ? "copied!" : display}
    </button>
  );
}
