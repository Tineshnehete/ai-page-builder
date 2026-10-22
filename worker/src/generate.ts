/**
 * AI generation module.
 *
 * Standalone helpers for turning a user's natural-language edit request into
 * a prompt for Workers AI, extracting clean HTML from a model's response,
 * and streaming a model's output back to a caller as it arrives.
 *
 * This module has no dependency on the Durable Object or HTTP routing.
 * Callers pass in anything shaped like the Workers AI binding's `run`.
 */

/**
 * Workers AI instruction-following text-generation model used for edits.
 * Listed in `@cloudflare/workers-types`' `AiModels`; its input schema
 * accepts `{ prompt, stream, max_tokens }`.
 */
export const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Output budget per generation. The model returns a whole HTML document on
 * every turn, so this has to be well above a chat-reply-sized default.
 */
export const MAX_OUTPUT_TOKENS = 4096;

/** Minimal shape of the Workers AI binding this module depends on. */
export interface AiBinding {
  run: (model: string, inputs: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Builds the prompt sent to the model, instructing it to return only the
 * full raw HTML document for the page given the current HTML and the user's
 * requested change. Passed to the model as `inputs.prompt`.
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
 * Pulls the HTML document out of a model's output, tolerating the common
 * ways models disobey "respond with only HTML":
 *
 * 1. A fenced code block anywhere in the output (```html ... ```), possibly
 *    surrounded by prose: the first fenced block's content is used. An
 *    unterminated fence (e.g. output cut off by the token limit) runs to the
 *    end of the output.
 * 2. No fence: the slice from the first `<!doctype` / `<html` (any case)
 *    through the last `</html>` (or the end of output if there is none).
 * 3. No fence and no doctype/html tag, but the whole output is markup
 *    (starts with `<` and ends with `>`): used as-is.
 *
 * Returns `null` if no HTML can be found at all; the caller must treat that
 * as a failed generation and keep the page's previous HTML.
 */
export function extractHtml(modelOutput: string): string | null {
  const fence = modelOutput.match(/```[^\n`]*\r?\n([\s\S]*?)(?:```|$)/);
  if (fence) {
    const inner = fence[1].trim();
    return inner.length > 0 ? inner : null;
  }

  const start = modelOutput.search(/<!doctype|<html[\s>]/i);
  if (start !== -1) {
    const lower = modelOutput.toLowerCase();
    const endTag = lower.lastIndexOf("</html>");
    const end = endTag >= start ? endTag + "</html>".length : modelOutput.length;
    return modelOutput.slice(start, end).trim();
  }

  const trimmed = modelOutput.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed;
  }

  return null;
}

/**
 * Parses one Server-Sent-Events frame (the text between blank lines) and
 * returns its `data:` payload, or null if the frame has no data lines.
 */
function sseData(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

/**
 * Calls Workers AI with `stream: true` and converts its response into a
 * stream of plain generated text.
 *
 * With `stream: true` the binding resolves to a `ReadableStream` of
 * Server-Sent-Event bytes (`data: {"response":"..."}\n\n` frames, ending
 * with `data: [DONE]\n\n`). This decodes the SSE framing, extracts each
 * frame's `response` text, and pushes it (UTF-8 encoded) to the returned
 * `stream` as it arrives. `done` resolves with the full concatenated text
 * once `[DONE]` is seen or the source closes, and rejects (with `stream`
 * erroring) if `ai.run` rejects, the source errors, or a frame is not valid
 * JSON.
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
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const result = await ai.run(MODEL_ID, {
          prompt,
          stream: true,
          max_tokens: MAX_OUTPUT_TOKENS,
        });
        if (!(result instanceof ReadableStream)) {
          throw new Error("Workers AI did not return a stream");
        }
        reader = (result as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        const handleFrame = (frame: string) => {
          const data = sseData(frame);
          if (data === null) return;
          if (data.trim() === "[DONE]") {
            finished = true;
            return;
          }
          const parsed = JSON.parse(data) as { response?: unknown };
          const text = typeof parsed.response === "string" ? parsed.response : "";
          if (text) {
            full += text;
            controller.enqueue(encoder.encode(text));
          }
        };

        while (!finished) {
          const { done: sourceDone, value } = await reader.read();
          if (sourceDone) {
            buffer += decoder.decode();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let boundary: RegExpExecArray | null;
          while (!finished && (boundary = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            handleFrame(frame);
          }
        }
        // A final frame not followed by a blank line before the source closed.
        if (!finished && buffer.trim()) {
          handleFrame(buffer);
        }
        if (finished) {
          await reader.cancel().catch(() => {});
        }

        controller.close();
        resolveDone(full);
      } catch (err) {
        if (reader) {
          await reader.cancel(err).catch(() => {});
        }
        controller.error(err);
        rejectDone(err);
      }
    },
  });

  return { stream, done };
}
