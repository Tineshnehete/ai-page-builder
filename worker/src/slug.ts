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
 * Builds a Cloudflare Pages project name from a username, project name, and attempt number.
 * If attempt is 0, returns "username-slugified-project-name".
 * If attempt > 0, returns "username-slugified-project-name-attempt".
 */
export function buildPagesProjectName(
  username: string,
  projectName: string,
  attempt: number
): string {
  const projectSlug = slugify(projectName);
  const baseSlug = slugify(username) + "-" + projectSlug;
  return attempt > 0 ? baseSlug + "-" + attempt : baseSlug;
}
