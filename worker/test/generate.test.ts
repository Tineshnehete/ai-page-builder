import { describe, it, expect, vi } from "vitest";
import { buildPrompt, extractHtml, streamGeneration } from "../src/generate";

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
  });

  describe("streamGeneration", () => {
    it("forwards chunks from ai.run and resolves done with the full text", async () => {
      const fakeAi = {
        run: vi.fn().mockResolvedValue(
          (async function* () {
            yield { response: "<html>" };
            yield { response: "</html>" };
          })()
        ),
      };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      const reader = stream.getReader();
      const chunks: string[] = [];
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        chunks.push(new TextDecoder().decode(r.value));
      }
      expect(chunks.join("")).toBe("<html></html>");
      expect(await done).toBe("<html></html>");
    });

    it("calls ai.run with the prompt and stream:true", async () => {
      const fakeAi = {
        run: vi.fn().mockResolvedValue(
          (async function* () {
            yield { response: "ok" };
          })()
        ),
      };
      const { done } = streamGeneration(fakeAi, "a prompt");
      await done;

      expect(fakeAi.run).toHaveBeenCalledTimes(1);
      const [, options] = fakeAi.run.mock.calls[0];
      expect(options).toMatchObject({ stream: true });
    });

    it("resolves done with an empty string when the iterable yields nothing", async () => {
      const fakeAi = {
        run: vi.fn().mockResolvedValue(
          (async function* () {
            // no chunks
          })()
        ),
      };
      const { stream, done } = streamGeneration(fakeAi, "a prompt");
      await stream.getReader().read();
      expect(await done).toBe("");
    });
  });
});
