/**
 * Renders HTML in a sandboxed iframe.
 *
 * @param {HTMLIFrameElement} iframeEl - The iframe element to render into
 * @param {string} html - The HTML content to render
 *
 * Sets the sandbox attribute to "allow-scripts" (deliberately omitting
 * allow-same-origin) to prevent the iframe from accessing the parent page's
 * cookies and session data.
 */
export function renderPreview(iframeEl, html) {
  iframeEl.setAttribute("sandbox", "allow-scripts");
  iframeEl.srcdoc = html;
}
