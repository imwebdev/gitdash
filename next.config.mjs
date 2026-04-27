import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let commit = "";
let builtAt = String(Date.now());
try {
  commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {}
let version = "";
try {
  const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
  version = pkg.version ?? "";
} catch {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["better-sqlite3", "chokidar"],
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  // Self-hosted, LAN-only tool — minified stack traces are useless when
  // debugging a beginner's "Application error" report. Adds ~20% to bundle
  // size; worth it for the diagnostic value.
  productionBrowserSourceMaps: true,
  // Pin BUILD_ID to the commit + buildAt timestamp so chunk hashes stay
  // stable for a given commit (deterministic) but change when the build
  // changes. Combined with the UpdateBanner version poll, this lets stale
  // tabs auto-reload onto the new build instead of crashing on missing
  // chunks. Falls back to Next's default when no commit is available
  // (tarball install, dirty checkout, etc.).
  generateBuildId: async () => (commit ? `${commit}-${builtAt}` : null),
  env: {
    NEXT_PUBLIC_GITDASH_VERSION: version,
    NEXT_PUBLIC_GITDASH_COMMIT: commit,
    NEXT_PUBLIC_GITDASH_BUILT_AT: builtAt,
  },
};

export default nextConfig;
