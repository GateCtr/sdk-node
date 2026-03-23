// sdk-node/src/stream.ts
import { GateCtrStreamError } from "./errors.js";
import type { StreamChunk } from "./types.js";

/**
 * Parses a Server-Sent Events (SSE) stream from a ReadableStream body.
 * Yields StreamChunk for each data line, stops cleanly on [DONE] sentinel.
 * Propagates GateCtrStreamError on connection abort or parse error.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      // Check for cancellation before each read

      if (signal !== undefined && signal.aborted) {
        throw new GateCtrStreamError("Stream cancelled by caller");
      }

      let done: boolean;
      let value: Uint8Array | undefined;

      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        throw new GateCtrStreamError(
          `Stream read error: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }

      if (done) break;

      if (value !== undefined) {
        buffer += decoder.decode(value, { stream: true });
      }

      // Process all complete lines in the buffer
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comment lines
        if (trimmed === "" || trimmed.startsWith(":")) continue;

        // Parse data lines
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();

          // [DONE] sentinel — stream is complete
          if (data === "[DONE]") {
            return;
          }

          // Parse JSON payload
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch (err) {
            throw new GateCtrStreamError(`Failed to parse SSE data as JSON: ${data}`, err);
          }

          const chunk = parsed as Record<string, unknown>;
          const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
          const firstChoice = choices?.[0];
          const delta = firstChoice?.["delta"] as Record<string, unknown> | undefined;
          const content = delta?.["content"];
          const finishReason = firstChoice?.["finish_reason"];

          yield {
            id: typeof chunk["id"] === "string" ? chunk["id"] : "",
            delta: typeof content === "string" ? content : null,
            finishReason: typeof finishReason === "string" ? finishReason : null,
          };
        }
      }
    }

    // Flush any remaining buffer content
    if (buffer.trim().startsWith("data:")) {
      const data = buffer.trim().slice(5).trim();
      if (data !== "[DONE]" && data !== "") {
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
          const firstChoice = choices?.[0];
          const delta = firstChoice?.["delta"] as Record<string, unknown> | undefined;
          const content = delta?.["content"];
          const finishReason = firstChoice?.["finish_reason"];

          yield {
            id: typeof parsed["id"] === "string" ? parsed["id"] : "",
            delta: typeof content === "string" ? content : null,
            finishReason: typeof finishReason === "string" ? finishReason : null,
          };
        } catch {
          // ignore incomplete final chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
