import { cn } from "@/lib/utils";
import type { DerivedState } from "@/lib/state/store";

const STYLES: Record<DerivedState, { label: string; className: string }> = {
  clean: { label: "clean", className: "border-status-clean/40 bg-status-clean/10 text-status-clean" },
  ahead: { label: "ahead", className: "border-status-ahead/40 bg-status-ahead/10 text-status-ahead" },
  behind: { label: "behind", className: "border-status-behind/40 bg-status-behind/10 text-status-behind" },
  diverged: { label: "diverged", className: "border-status-diverged/40 bg-status-diverged/10 text-status-diverged" },
  dirty: { label: "dirty", className: "border-status-dirty/40 bg-status-dirty/10 text-status-dirty" },
  "no-upstream": {
    label: "no upstream",
    className: "border-status-noupstream/40 bg-status-noupstream/10 text-status-noupstream border-dashed",
  },
  weird: { label: "weird", className: "border-status-weird/40 bg-status-weird/10 text-status-weird" },
  unknown: { label: "…", className: "border-muted bg-muted/20 text-muted-foreground" },
};

export function StatusBadge({ state }: { state: DerivedState }) {
  const s = STYLES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}
