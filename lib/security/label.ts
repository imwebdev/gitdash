/**
 * Sanitization helpers for machine labels.
 *
 * sanitizeLabel  — produces a branch-safe string (lowercase alnum + dash, max 40 chars).
 * displayLabel   — returns the effective display label, falling back to a sanitized hostname.
 */

/**
 * Convert an arbitrary string into a branch-name-safe slug.
 * Rules:
 *   - Lowercase
 *   - Keep ASCII alphanumerics and hyphens; strip everything else
 *   - Collapse consecutive hyphens into one
 *   - Strip leading/trailing hyphens
 *   - Truncate to 40 characters
 */
export function sanitizeLabel(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-") // non-alnum → hyphen
    .replace(/-{2,}/g, "-")        // collapse runs
    .replace(/^-+|-+$/g, "")       // trim edges
    .slice(0, 40)
    .replace(/-+$/g, "");          // re-trim after truncation
}

/**
 * Return the display label for this machine.
 * If `input` is a non-empty string after trimming, return it as-is (not sanitized —
 * the user may have set a pretty name like "Chirag's Laptop").
 * Otherwise fall back to a sanitized version of `hostnameFallback`.
 */
export function displayLabel(
  input: string | null | undefined,
  hostnameFallback: string,
): string {
  const trimmed = (input ?? "").trim();
  if (trimmed.length > 0) return trimmed;
  return sanitizeLabel(hostnameFallback) || hostnameFallback;
}
