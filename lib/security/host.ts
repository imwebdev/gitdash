const PORT = process.env.GITDASH_PORT || "7420";

const PRIVATE_HOST_RE = new RegExp(
  [
    "^(?:",
    "127\\.\\d+\\.\\d+\\.\\d+", // loopback
    "|localhost",
    "|192\\.168\\.\\d+\\.\\d+", // RFC1918
    "|10\\.\\d+\\.\\d+\\.\\d+",
    "|172\\.(?:1[6-9]|2\\d|3[0-1])\\.\\d+\\.\\d+",
    "|100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d+\\.\\d+", // 100.64/10 (CGNAT, tailscale)
    "|\\[::1\\]",
    "|\\[fe80:[0-9a-f:]+\\]",
    ")",
    `(?::${PORT})?$`,
  ].join(""),
  "i",
);

export function isAllowedHost(headerValue: string | null | undefined): boolean {
  if (!headerValue) return false;
  return PRIVATE_HOST_RE.test(headerValue.trim());
}
