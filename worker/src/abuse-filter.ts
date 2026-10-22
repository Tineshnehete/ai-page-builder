/**
 * Checks HTML content for signs of abuse/credential harvesting attacks.
 *
 * Blocks when the HTML contains a form with an absolute URL (http/https)
 * AND the document text matches at least one credential-harvesting keyword.
 */
export function checkHtmlForAbuse(html: string): {
  blocked: boolean;
  reason?: string;
} {
  // Keywords that indicate credential harvesting
  const abuseKeywords = [
    "password",
    "verify your account",
    "bank",
    "credit card",
    "social security",
  ];

  // Check if there's a form with an external action URL
  const formWithExternalUrl = /<form\s+[^>]*action="(https?:\/\/[^"]+)"[^>]*>/gi;
  const hasExternalForm = formWithExternalUrl.test(html);

  if (!hasExternalForm) {
    return { blocked: false };
  }

  // Check if the HTML contains any abuse keywords (case-insensitive)
  const htmlLower = html.toLowerCase();
  const hasAbuseKeyword = abuseKeywords.some((keyword) =>
    htmlLower.includes(keyword.toLowerCase())
  );

  if (hasAbuseKeyword) {
    return {
      blocked: true,
      reason: "Form posts to external domain alongside credential-harvesting language",
    };
  }

  return { blocked: false };
}
