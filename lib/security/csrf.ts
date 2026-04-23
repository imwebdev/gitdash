import { randomBytes } from "node:crypto";

const ENV_KEY = "GITDASH_CSRF_TOKEN";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

let cached: string | null = null;

export function getCsrfToken(): string {
  if (cached) return cached;
  const existing = process.env[ENV_KEY];
  if (existing && existing.length >= 20) {
    cached = existing;
    return cached;
  }
  cached = generateToken();
  process.env[ENV_KEY] = cached;
  return cached;
}

export function validateCsrf(headerValue: string | null): boolean {
  const token = getCsrfToken();
  if (!headerValue) return false;
  if (headerValue.length !== token.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ headerValue.charCodeAt(i);
  }
  return diff === 0;
}
