import { describe, it, expect, vi } from "vitest";
import {
  buildPrompt,
  extractHtml,
  extractSummary,
  SUMMARY_FALLBACK,
  streamGeneration,
  MODEL_ID,
  MAX_OUTPUT_TOKENS,
} from "../src/generate";

/**
 * Builds what the real Workers AI binding resolves to for `stream: true`: a
 * ReadableStream of SSE-framed bytes. Each entry in `rawChunks` is emitted as
 * one byte chunk, so tests can split frames across chunk boundaries.
 */
function sseStream(rawChunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of rawChunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function frame(response: string): string {
  return `data: ${JSON.stringify({ response })}\n\n`;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    out += decoder.decode(r.value, { stream: true });
  }
  return out;
}

describe("AI generation module", () => {
  describe("buildPrompt", () => {
    it("interpolates the current html and message into the prompt", () => {
      const prompt = buildPrompt("<html><body>Hi</body></html>", "make the background blue");

      expect(prompt).toContain("<html><body>Hi</body></html>");
      expect(prompt).toContain("make the background blue");
    });

    it("instructs the model to return only the full raw HTML document", () => {
      const prompt = buildPrompt("<html></html>", "add a footer");

      expect(prompt.toLowerCase()).toContain("html");
    });
  });

  describe("extractHtml", () => {
    it("strips a markdown code fence if present", () => {
      expect(extractHtml("```html\n<html></html>\n```")).toBe("<html></html>");
    });

    it("returns the input unchanged when there's no fence", () => {
      expect(extractHtml("<html></html>")).toBe("<html></html>");
    });

    it("strips a plain (no language) code fence", () => {
      expect(extractHtml("```\n<html></html>\n```")).toBe("<html></html>");
    });

    it("trims surrounding whitespace when no fence is present", () => {
      expect(extractHtml("  <html></html>  \n")).toBe("<html></html>");
    });

    it("extracts a fenced block surrounded by explanatory prose", () => {
      const output =
        "Sure! Here's your updated page:\n\n```html\n<!DOCTYPE html>\n<html><body>new</body></html>\n```\n\nI made the background blue.";
      expect(extractHtml(output)).toBe("<!DOCTYPE html>\n<html><body>new</body></html>");
    });

    it("extracts an unterminated fence (output cut off) through the end", () => {
      expect(extractHtml("Here:\n```html\n<html><body>partial")).toBe("<html><body>partial");
    });

    it("extracts raw unfenced <html>...</html> (no doctype) from surrounding prose", () => {
      const output = "Here is the page: <html><body>x</body></html> Hope that helps!";
      expect(extractHtml(output)).toBe("<html><body>x</body></html>");
    });

    it("extracts from <!doctype through the last </html>, case-insensitively", () => {
      const output = "Updated:\n<!doctype html><HTML><body>y</body></HTML>\nDone.";
      expect(extractHtml(output)).toBe("<!doctype html><HTML><body>y</body></HTML>");
    });

    it("returns null when no HTML is found at all", () => {
      expect(extractHtml("I'm sorry, I can't help with that request.")).toBeNull();
      expect(extractHtml("")).toBeNull();
    });
  });

  describe("extractSummary", () => {
    it("extracts the SUMMARY line, trimmed", () => {
      const output = "SUMMARY: Made the button blue.\n```html\n<html></html>\n```";
      expect(extractSummary(output)).toBe("Made the button blue.");
    });

    it("is case-insensitive on the SUMMARY label", () => {
      expect(extractSummary("summary:   added a footer  \n```html\n<html></html>\n```")).toBe(
        "added a footer"
      );
    });

    it("finds the SUMMARY line even if it's not the first line", () => {
      const output = "Sure!\nSUMMARY: Added a footer.\n```html\n<html></html>\n```";
      expect(extractSummary(output)).toBe("Added a footer.");
    });

    it("falls back to a generic message when there's no SUMMARY line", () => {
      expect(extractSummary("```html\n<html></html>\n```")).toBe(SUMMARY_FALLBACK);
    });

    it("falls back when the SUMMARY line is present but empty", () => {
      expect(extractSummary("SUMMARY:   \n```html\n<html></html>\n```")).toBe(SUMMARY_FALLBACK);
    });
  });

  describe("streamGeneration", () => {
    it("parses SSE frames, forwards response text, and resolves done with the full text", async () => {
      const fakeAi = {
        run: vi
          .fn()
          .mockResolvedValue(sseStream([frame("<html>"), frame("</html>"), "data: [DONE]\n\n"])),
      };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      expect(await readAll(stream)).toBe("<html></html>");
      expect(await done).toBe("<html></html>");
    });

    it("handles SSE frames split across byte-chunk boundaries and multi-byte characters", async () => {
      const raw = frame("<p>héllo ✓</p>") + frame("<p>2</p>") + "data: [DONE]\n\n";
      const bytes = new TextEncoder().encode(raw);
      // Emit one byte at a time so frames AND UTF-8 sequences straddle chunks.
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const b of bytes) controller.enqueue(new Uint8Array([b]));
          controller.close();
        },
      });
      const fakeAi = { run: vi.fn().mockResolvedValue(source) };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      expect(await readAll(stream)).toBe("<p>héllo ✓</p><p>2</p>");
      expect(await done).toBe("<p>héllo ✓</p><p>2</p>");
    });

    it("stops at [DONE] and ignores frames after it", async () => {
      const fakeAi = {
        run: vi
          .fn()
          .mockResolvedValue(sseStream([frame("a"), "data: [DONE]\n\n", frame("ignored")])),
      };
      const { done } = streamGeneration(fakeAi, "a prompt");
      expect(await done).toBe("a");
    });

    it("resolves with the text so far if the source closes without [DONE]", async () => {
      const fakeAi = { run: vi.fn().mockResolvedValue(sseStream([frame("a"), frame("b")])) };
      const { done } = streamGeneration(fakeAi, "a prompt");
      expect(await done).toBe("ab");
    });

    it("calls ai.run with the model id, then { prompt, stream: true, max_tokens }", async () => {
      const fakeAi = {
        run: vi.fn().mockResolvedValue(sseStream([frame("ok"), "data: [DONE]\n\n"])),
      };
      const prompt = buildPrompt("<html></html>", "add a footer");
      const { done } = streamGeneration(fakeAi, prompt);
      await done;

      expect(fakeAi.run).toHaveBeenCalledTimes(1);
      const [model, inputs] = fakeAi.run.mock.calls[0];
      expect(model).toBe(MODEL_ID);
      expect(model).toMatch(/^@cf\//);
      expect(inputs).toEqual({ prompt, stream: true, max_tokens: MAX_OUTPUT_TOKENS });
      expect(MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(4096);
    });

    it("resolves done with an empty string when the stream has only [DONE]", async () => {
      const fakeAi = { run: vi.fn().mockResolvedValue(sseStream(["data: [DONE]\n\n"])) };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      expect(await readAll(stream)).toBe("");
      expect(await done).toBe("");
    });

    it("errors the stream and rejects done when ai.run rejects", async () => {
      const fakeAi = { run: vi.fn().mockRejectedValue(new Error("AI unavailable")) };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      await expect(done).rejects.toThrow("AI unavailable");
      await expect(readAll(stream)).rejects.toThrow("AI unavailable");
    });

    it("errors the stream and rejects done when the source stream errors mid-iteration", async () => {
      const encoder = new TextEncoder();
      let pulls = 0;
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          if (pulls === 1) {
            controller.enqueue(encoder.encode(frame("<html>")));
          } else {
            controller.error(new Error("connection reset"));
          }
        },
      });
      const fakeAi = { run: vi.fn().mockResolvedValue(source) };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      await expect(done).rejects.toThrow("connection reset");
      await expect(readAll(stream)).rejects.toThrow("connection reset");
    });

    it("errors the stream and rejects done on a malformed SSE data payload", async () => {
      const fakeAi = { run: vi.fn().mockResolvedValue(sseStream(["data: {not json\n\n"])) };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      await expect(done).rejects.toThrow();
      await expect(readAll(stream)).rejects.toThrow();
    });
  });
});
