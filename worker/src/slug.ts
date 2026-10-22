/**
 * Converts a string to a slug by lowercasing and replacing non-alphanumeric characters with hyphens.
 * Consecutive hyphens are collapsed into single hyphens, and leading/trailing hyphens are trimmed.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric characters with hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Maximum length of the username+project part of a Pages project name.
 * Cloudflare caps Pages project names at 58 characters; this leaves room
 * for a "-N" collision suffix.
 */
export const MAX_BASE_SLUG_LENGTH = 50;

function normalizeHyphens(input: string): string {
  // Collapse consecutive hyphens BEFORE trimming, so multiple leading/trailing hyphens are handled
  return input.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Builds a Cloudflare Pages project name from a username, project name, and attempt number.
 * If attempt is 0, returns "username-slugified-project-name".
 * If attempt > 0, returns "username-slugified-project-name-attempt".
 * The username+project part is truncated to MAX_BASE_SLUG_LENGTH characters
 * (with any trailing hyphen trimmed) before the suffix is added, and the
 * result is normalized to remove leading/trailing hyphens and collapse
 * consecutive hyphens.
 */
export function buildPagesProjectName(
  username: string,
  projectName: string,
  attempt: number
): string {
  const baseSlug = normalizeHyphens(slugify(username) + "-" + slugify(projectName))
    .slice(0, MAX_BASE_SLUG_LENGTH)
    .replace(/-+$/, "");
  const result = attempt > 0 ? baseSlug + "-" + attempt : baseSlug;
  return normalizeHyphens(result);
}
