// sdk-node/tests/stream.test.ts
import { describe, it, expect } from "vitest";
import { parseSSE } from "../src/stream.js";
import { GateCtrStreamError } from "../src/errors.js";

/** Helper: create a ReadableStream from an array of SSE strings */
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Helper: collect all chunks from an async generator */
async function collectChunks(
  gen: AsyncGenerator<{ id: string; delta: string | null; finishReason: string | null }>,
): Promise<Array<{ id: string; delta: string | null; finishReason: string | null }>> {
  const results = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

describe("parseSSE", () => {
  it("parses a single data line and yields a StreamChunk", async () => {
    const sseData = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: "Hello" }, finish_reason: null }],
    });
    const stream = makeStream([`data: ${sseData}\n\n`]);
    const chunks = await collectChunks(parseSSE(stream));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      id: "chatcmpl-1",
      delta: "Hello",
      finishReason: null,
    });
  });

  it("parses multiple data lines and yields multiple StreamChunks", async () => {
    const chunk1 = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: "Hello" }, finish_reason: null }],
    });
    const chunk2 = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: " world" }, finish_reason: null }],
    });
    const chunk3 = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: "" }, finish_reason: "stop" }],
    });

    const stream = makeStream([
      `data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: ${chunk3}\n\ndata: [DONE]\n\n`,
    ]);
    const chunks = await collectChunks(parseSSE(stream));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.delta).toBe("Hello");
    expect(chunks[1]?.delta).toBe(" world");
    expect(chunks[2]?.finishReason).toBe("stop");
  });

  it("stops cleanly on [DONE] sentinel without throwing", async () => {
    const sseData = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: "Hi" }, finish_reason: null }],
    });
    const stream = makeStream([
      `data: ${sseData}\n\ndata: [DONE]\n\n`,
    ]);

    // Should not throw
    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta).toBe("Hi");
  });

  it("skips empty lines and comment lines", async () => {
    const sseData = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: "Test" }, finish_reason: null }],
    });
    const stream = makeStream([
      `: this is a comment\n\n\ndata: ${sseData}\n\ndata: [DONE]\n\n`,
    ]);
    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta).toBe("Test");
  });

  it("handles multi-chunk delivery (data split across network packets)", async () => {
    const sseData = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: { content: "Split" }, finish_reason: null }],
    });
    const full = `data: ${sseData}\n\ndata: [DONE]\n\n`;
    // Split the SSE data across multiple network chunks
    const mid = Math.floor(full.length / 2);
    const stream = makeStream([full.slice(0, mid), full.slice(mid)]);

    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta).toBe("Split");
  });

  it("propagates GateCtrStreamError on invalid JSON", async () => {
    const stream = makeStream(["data: {invalid json}\n\n"]);
    await expect(collectChunks(parseSSE(stream))).rejects.toThrow(GateCtrStreamError);
  });

  it("cancels via AbortSignal", async () => {
    const encoder = new TextEncoder();
    const controller = new AbortController();

    // Stream that emits one chunk then hangs indefinitely
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ id: "1", choices: [{ delta: { content: "a" }, finish_reason: null }] })}\n\n`,
          ),
        );
        // Never close — simulates a hanging stream
      },
    });

    const gen = parseSSE(stream, controller.signal);

    // Consume the first chunk successfully
    const first = await gen.next();
    expect(first.value?.delta).toBe("a");

    // Abort the signal, then the next iteration should throw GateCtrStreamError
    controller.abort();
    await expect(gen.next()).rejects.toThrow(GateCtrStreamError);
  });

  it("yields null delta when content is absent", async () => {
    const sseData = JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ delta: {}, finish_reason: "stop" }],
    });
    const stream = makeStream([`data: ${sseData}\n\ndata: [DONE]\n\n`]);
    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks[0]?.delta).toBeNull();
    expect(chunks[0]?.finishReason).toBe("stop");
  });
});

describe("parseSSE — stream read error", () => {
  it("throws GateCtrStreamError when the reader throws mid-stream", async () => {
    // Build a stream that errors on the second read
    let readCount = 0;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        readCount++;
        if (readCount === 1) {
          controller.enqueue(encoder.encode("data: "));
        } else {
          controller.error(new Error("connection reset"));
        }
      },
    });

    const gen = parseSSE(stream);
    await expect(async () => {
      for await (const _ of gen) { /* consume */ }
    }).rejects.toThrow(GateCtrStreamError);
  });
});

describe("parseSSE — buffer flush (no trailing newline)", () => {
  it("yields a chunk from data not followed by a newline at end of stream", async () => {
    const encoder = new TextEncoder();
    const chunkData = JSON.stringify({
      id: "chatcmpl-flush",
      choices: [{ delta: { content: "flushed" }, finish_reason: null }],
    });

    // Deliberately omit the trailing \n\n so the data ends up in the flush path
    const raw = `data: ${chunkData}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(raw));
        controller.close();
      },
    });

    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.delta).toBe("flushed");
  });

  it("ignores [DONE] sentinel in the flush buffer", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]"));
        controller.close();
      },
    });

    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks.length).toBe(0);
  });
});

describe("parseSSE — flush buffer with invalid JSON", () => {
  it("silently ignores invalid JSON in the flush buffer (no trailing newline)", async () => {
    const encoder = new TextEncoder();
    // Incomplete/invalid JSON in the buffer — should be swallowed by the catch
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid json"));
        controller.close();
      },
    });

    // Should not throw — the catch block swallows the parse error
    const chunks = await collectChunks(parseSSE(stream));
    expect(chunks).toHaveLength(0);
  });
});
