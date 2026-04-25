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
  env: {
    NEXT_PUBLIC_GITDASH_VERSION: version,
    NEXT_PUBLIC_GITDASH_COMMIT: commit,
    NEXT_PUBLIC_GITDASH_BUILT_AT: builtAt,
  },
};

export default nextConfig;
