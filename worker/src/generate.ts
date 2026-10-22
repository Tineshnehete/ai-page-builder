/**
 * AI generation module.
 *
 * Standalone helpers for turning a user's natural-language edit request into
 * a prompt for Workers AI, extracting clean HTML from a model's response,
 * and streaming a model's output back to a caller as it arrives.
 *
 * This module has no dependency on the Durable Object, HTTP routing, or the
 * real Workers AI binding — callers pass in anything shaped like
 * `{ run: Function }`.
 */

/** Minimal shape of the Workers AI binding this module depends on. */
export interface AiBinding {
  run: (...args: unknown[]) => unknown;
}

/** A single streamed chunk, as produced by a Workers AI text-generation model. */
interface AiStreamChunk {
  response?: string;
}

/**
 * Builds the prompt sent to the model, instructing it to return only the
 * full raw HTML document for the page given the current HTML and the user's
 * requested change.
 */
export function buildPrompt(currentHtml: string, message: string): string {
  return `You are editing the HTML source of a single web page.

Current HTML:
${currentHtml}

The user has requested the following change:
${message}

Apply the requested change to the HTML above. Respond with ONLY the full, complete, raw HTML document for the updated page. Do not include any explanation, commentary, or markdown code fences — your entire response must be valid HTML starting with <!DOCTYPE html> or <html> and nothing else.`;
}

/**
 * Strips a markdown code fence (e.g. ```html ... ``` or ``` ... ```) from
 * model output if present, otherwise returns the input trimmed and
 * unchanged.
 */
export function extractHtml(modelOutput: string): string {
  const trimmed = modelOutput.trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9]*)\n([\s\S]*?)\n?```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/**
 * Calls `ai.run(prompt, { stream: true })` and wraps the resulting async
 * iterable of chunks into a `ReadableStream<Uint8Array>`. Each chunk's
 * `response` text is UTF-8 encoded and pushed to the stream as it arrives.
 * `done` resolves with the full concatenated text once the iterable ends.
 */
export function streamGeneration(
  ai: AiBinding,
  prompt: string
): { stream: ReadableStream<Uint8Array>; done: Promise<string> } {
  let resolveDone!: (value: string) => void;
  let rejectDone!: (reason: unknown) => void;
  const done = new Promise<string>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        const result = await ai.run(prompt, { stream: true });
        const iterable = result as AsyncIterable<AiStreamChunk>;
        for await (const chunk of iterable) {
          const text = chunk?.response ?? "";
          if (text) {
            full += text;
            controller.enqueue(encoder.encode(text));
          }
        }
        controller.close();
        resolveDone(full);
      } catch (err) {
        controller.error(err);
        rejectDone(err);
      }
    },
  });

  return { stream, done };
}
