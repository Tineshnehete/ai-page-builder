import { describe, it, expect } from "vitest";
import { renderPreview } from "./preview.js";

describe("preview.js", () => {
  it("sets a restrictive sandbox with no allow-same-origin, and the given html as srcdoc", () => {
    const iframe = document.createElement("iframe");
    renderPreview(iframe, "<html><body>hi</body></html>");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.srcdoc).toBe("<html><body>hi</body></html>");
  });
});
