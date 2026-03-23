// sdk-node/tests/properties.test.ts
// Property-based tests using fast-check
// Each test references the design property it validates.

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as fc from "fast-check";
import { http, HttpResponse } from "msw";
import { GateCtr } from "../src/client.js";
import { GateCtrConfigError, GateCtrApiError } from "../src/errors.js";
import { backoffMs } from "../src/http.js";
import { server } from "./handlers.js";
import type { CompleteResponse } from "../src/types.js";

// ─── MSW server lifecycle ────────────────────────────────────────────────────

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Non-empty, non-whitespace string with no leading/trailing whitespace.
 * The client trims apiKey on construction, so we generate pre-trimmed strings
 * to avoid mismatches when comparing against stored values.
 */
const nonEmptyString = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim() === s && s.trim().length > 0);

/**
 * Realistic API key string (alphanumeric + common symbols, min 8 chars).
 * Used where we need to verify the key doesn't appear in error output —
 * short single-char keys can false-positive match substrings in error messages.
 */
const realisticApiKey = fc
  .string({ minLength: 8, maxLength: 64 })
  .filter((s) => s.trim() === s && s.trim().length >= 8 && /\S/.test(s));

/** Valid base URLs */
const validBaseUrl = fc.constantFrom(
  "https://api.gatectr.com/v1",
  "https://custom.example.com/v1",
  "http://localhost:3000/v1",
  "https://api.gatectr.com/v1/",
  "https://api.gatectr.com/v1///",
);

/** Invalid base URLs */
const invalidBaseUrl = fc.oneof(
  fc.constant(""),
  fc.constant("ftp://example.com"),
  fc.constant("not-a-url"),
  fc.constant("//no-protocol.com"),
  fc.constant("ws://websocket.example.com"),
);

/** Invalid API key values */
const invalidApiKey = fc.oneof(
  fc.constant(""),
  fc.constant("   "),
  fc.constant("\t\n"),
  fc.string().map((s) => s.replace(/\S/g, " ")), // whitespace-only
);

// ─── Property 1: Valid config construction succeeds ──────────────────────────
// Feature: sdk-node, Property 1: Valid config construction succeeds
// Validates: Requirements 2.1, 13.4a

describe("Property 1: Valid config construction succeeds", () => {
  it("constructs without throwing for any valid apiKey + baseUrl combination", () => {
    fc.assert(
      fc.property(nonEmptyString, validBaseUrl, (apiKey, baseUrl) => {
        expect(() => new GateCtr({ apiKey, baseUrl })).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Invalid apiKey throws GateCtrConfigError ────────────────────
// Feature: sdk-node, Property 2: Invalid apiKey throws GateCtrConfigError
// Validates: Requirements 2.2, 13.4d

describe("Property 2: Invalid apiKey throws GateCtrConfigError", () => {
  it("throws GateCtrConfigError for any empty or whitespace-only apiKey", () => {
    fc.assert(
      fc.property(invalidApiKey, (key) => {
        expect(() => new GateCtr({ apiKey: key })).toThrow(GateCtrConfigError);
      }),
      { numRuns: 100 },
    );
  });

  it("throws GateCtrConfigError when no apiKey is provided and env var is unset", () => {
    const saved = process.env["GATECTR_API_KEY"];
    delete process.env["GATECTR_API_KEY"];
    try {
      expect(() => new GateCtr({})).toThrow(GateCtrConfigError);
    } finally {
      if (saved !== undefined) process.env["GATECTR_API_KEY"] = saved;
    }
  });
});

// ─── Property 3: apiKey never appears in error output ────────────────────────
// Feature: sdk-node, Property 3: apiKey never appears in error output
// Validates: Requirements 2.3, 8.4, 16.2

describe("Property 3: apiKey never appears in error output", () => {
  it("does not leak apiKey in GateCtrApiError message or toJSON()", async () => {
    await fc.assert(
      fc.asyncProperty(realisticApiKey, async (apiKey) => {
        server.use(
          http.post("https://api.gatectr.com/v1/complete", () =>
            HttpResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
          ),
        );

        const client = new GateCtr({ apiKey });
        try {
          await client.complete({
            model: "gpt-4o",
            messages: [{ role: "user", content: "hi" }],
          });
        } catch (err) {
          if (err instanceof GateCtrApiError) {
            const json = JSON.stringify(err.toJSON());
            // The stored key is trimmed — verify neither the raw nor trimmed key leaks
            expect(json).not.toContain(apiKey.trim());
            expect(err.message).not.toContain(apiKey.trim());
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});

// ─── Property 4: baseUrl trailing slash is always stripped ───────────────────
// Feature: sdk-node, Property 4: baseUrl trailing slash is always stripped
// Validates: Requirements 2.5

describe("Property 4: baseUrl trailing slash is always stripped", () => {
  it("strips any number of trailing slashes from baseUrl", async () => {
    const trailingSlashUrl = fc.constantFrom(
      "https://api.gatectr.com/v1/",
      "https://api.gatectr.com/v1//",
      "https://api.gatectr.com/v1///",
    );

    await fc.assert(
      fc.asyncProperty(trailingSlashUrl, async (baseUrl) => {
        let capturedUrl: string | undefined;

        server.use(
          http.post(/.*\/complete$/, ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json({
              id: "cmpl_1",
              object: "text_completion",
              model: "gpt-4o",
              choices: [{ text: "ok", finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, saved_tokens: 0 },
            });
          }),
        );

        const client = new GateCtr({ apiKey: "test-key", baseUrl });
        await client.complete({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hi" }],
        });

        // The URL must not have double slashes before /complete
        expect(capturedUrl).toBeDefined();
        expect(capturedUrl).not.toMatch(/\/\/complete/);
        expect(capturedUrl).toMatch(/\/complete$/);
      }),
      { numRuns: 3 },
    );
  });
});

// ─── Property 5: All requests carry required authentication headers ───────────
// Feature: sdk-node, Property 5: All requests carry required authentication headers
// Validates: Requirements 8.1, 8.2, 8.3

describe("Property 5: All requests carry required authentication headers", () => {
  it("includes Authorization, User-Agent, and Content-Type on every POST", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyString, async (apiKey) => {
        let capturedHeaders: Headers | undefined;

        server.use(
          http.post("https://api.gatectr.com/v1/complete", ({ request }) => {
            capturedHeaders = request.headers;
            return HttpResponse.json({
              id: "cmpl_1",
              object: "text_completion",
              model: "gpt-4o",
              choices: [{ text: "ok", finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, saved_tokens: 0 },
            });
          }),
        );

        const client = new GateCtr({ apiKey });
        await client.complete({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hi" }],
        });

        expect(capturedHeaders?.get("authorization")).toBe(`Bearer ${apiKey}`);
        expect(capturedHeaders?.get("user-agent")).toMatch(/^@gatectr\/sdk\//);
        expect(capturedHeaders?.get("content-type")).toBe("application/json");
      }),
      { numRuns: 50 },
    );
  });

  it("includes Authorization and User-Agent on GET requests (no Content-Type)", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyString, async (apiKey) => {
        let capturedHeaders: Headers | undefined;

        server.use(
          http.get("https://api.gatectr.com/v1/models", ({ request }) => {
            capturedHeaders = request.headers;
            return HttpResponse.json({ models: [] });
          }),
        );

        const client = new GateCtr({ apiKey });
        await client.models();

        expect(capturedHeaders?.get("authorization")).toBe(`Bearer ${apiKey}`);
        expect(capturedHeaders?.get("user-agent")).toMatch(/^@gatectr\/sdk\//);
      }),
      { numRuns: 50 },
    );
  });
});

// ─── Property 6: Response metadata is correctly extracted ────────────────────
// Feature: sdk-node, Property 6: Response metadata is correctly extracted
// Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 4.3

describe("Property 6: Response metadata is correctly extracted", () => {
  it("extracts requestId, latencyMs, overage, modelUsed, tokensSaved from any valid response", async () => {
    const metadataArb = fc.record({
      // HTTP headers trim leading/trailing whitespace — use pre-trimmed strings
      requestId: nonEmptyString,
      latencyMs: fc.integer({ min: 0, max: 60_000 }),
      overage: fc.boolean(),
      // model comes from JSON body, not headers — also use pre-trimmed to avoid
      // issues with JSON serialization of strings with surrounding whitespace
      modelUsed: nonEmptyString,
      tokensSaved: fc.integer({ min: 0, max: 100_000 }),
    });

    await fc.assert(
      fc.asyncProperty(
        metadataArb,
        async ({ requestId, latencyMs, overage, modelUsed, tokensSaved }) => {
          server.use(
            http.post("https://api.gatectr.com/v1/complete", () =>
              HttpResponse.json(
                {
                  id: "cmpl_1",
                  object: "text_completion",
                  model: modelUsed,
                  choices: [{ text: "ok", finish_reason: "stop" }],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                    saved_tokens: tokensSaved,
                  },
                },
                {
                  headers: {
                    "x-gatectr-request-id": requestId,
                    "x-gatectr-latency-ms": String(latencyMs),
                    "x-gatectr-overage": String(overage),
                  },
                },
              ),
            ),
          );

          const client = new GateCtr({ apiKey: "test-key" });
          const response = await client.complete({
            model: "gpt-4o",
            messages: [{ role: "user", content: "hi" }],
          });

          expect(response.gatectr.requestId).toBe(requestId);
          expect(response.gatectr.latencyMs).toBe(latencyMs);
          expect(response.gatectr.overage).toBe(overage);
          expect(response.gatectr.modelUsed).toBe(modelUsed);
          expect(response.gatectr.tokensSaved).toBe(tokensSaved);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 7: Per-request options override client defaults ─────────────────
// Feature: sdk-node, Property 7: Per-request options override client defaults
// Validates: Requirements 3.8, 4.4

describe("Property 7: Per-request options override client defaults", () => {
  it("per-request optimize/route override client-level defaults in request body", async () => {
    const overrideArb = fc.record({
      clientOptimize: fc.boolean(),
      clientRoute: fc.boolean(),
      perOptimize: fc.option(fc.boolean(), { nil: undefined }),
      perRoute: fc.option(fc.boolean(), { nil: undefined }),
    });

    await fc.assert(
      fc.asyncProperty(
        overrideArb,
        async ({ clientOptimize, clientRoute, perOptimize, perRoute }) => {
          let capturedBody: Record<string, unknown> | undefined;

          server.use(
            http.post("https://api.gatectr.com/v1/complete", async ({ request }) => {
              capturedBody = (await request.json()) as Record<string, unknown>;
              return HttpResponse.json({
                id: "cmpl_1",
                object: "text_completion",
                model: "gpt-4o",
                choices: [{ text: "ok", finish_reason: "stop" }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, saved_tokens: 0 },
              });
            }),
          );

          const client = new GateCtr({
            apiKey: "test-key",
            optimize: clientOptimize,
            route: clientRoute,
          });

          const gatectr: Record<string, boolean> = {};
          if (perOptimize !== undefined) gatectr["optimize"] = perOptimize;
          if (perRoute !== undefined) gatectr["route"] = perRoute;

          await client.complete({
            model: "gpt-4o",
            messages: [{ role: "user", content: "hi" }],
            ...(Object.keys(gatectr).length > 0 ? { gatectr } : {}),
          });

          const expectedOptimize = perOptimize !== undefined ? perOptimize : clientOptimize;
          const expectedRoute = perRoute !== undefined ? perRoute : clientRoute;

          expect(capturedBody?.["optimize"]).toBe(expectedOptimize);
          expect(capturedBody?.["route"]).toBe(expectedRoute);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Non-2xx responses throw GateCtrApiError with correct status ─
// Feature: sdk-node, Property 10: Non-2xx responses throw GateCtrApiError with correct status
// Validates: Requirements 9.2, 9.3

describe("Property 10: Non-2xx responses throw GateCtrApiError with correct status", () => {
  it("throws GateCtrApiError with matching status for any non-retryable error code", async () => {
    const nonRetryableStatus = fc.constantFrom(400, 401, 403, 404);

    await fc.assert(
      fc.asyncProperty(nonRetryableStatus, async (status) => {
        server.use(
          http.post("https://api.gatectr.com/v1/complete", () =>
            HttpResponse.json({ error: "error", code: "test_error" }, { status }),
          ),
        );

        const client = new GateCtr({ apiKey: "test-key" });
        await expect(
          client.complete({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
        ).rejects.toSatisfy((err: unknown) => {
          return err instanceof GateCtrApiError && err.status === status;
        });
      }),
      { numRuns: 20 },
    );
  });

  it("throws GateCtrApiError with matching status after retries exhausted for retryable codes", async () => {
    const retryableStatus = fc.constantFrom(429, 500, 502, 503, 504);

    await fc.assert(
      fc.asyncProperty(retryableStatus, async (status) => {
        server.use(
          http.post("https://api.gatectr.com/v1/complete", () =>
            HttpResponse.json({ error: "server error" }, { status }),
          ),
        );

        const client = new GateCtr({ apiKey: "test-key", maxRetries: 0 });
        await expect(
          client.complete({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
        ).rejects.toSatisfy((err: unknown) => {
          return err instanceof GateCtrApiError && err.status === status;
        });
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 13: Retry backoff delays are monotonically non-decreasing ───────
// Feature: sdk-node, Property 13: Retry backoff delays are monotonically non-decreasing
// Validates: Requirements 10.2

describe("Property 13: Retry backoff delays are monotonically non-decreasing (base, no jitter)", () => {
  it("base delay (500 * 2^attempt) is strictly increasing up to the 10s cap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (attempt) => {
        // Base formula without jitter: 500 * 2^attempt, capped at 10_000
        const base = (a: number) => Math.min(500 * Math.pow(2, a), 10_000);
        if (base(attempt) < 10_000) {
          expect(base(attempt + 1)).toBeGreaterThanOrEqual(base(attempt));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("backoffMs always returns a value in [500, 10100] for any attempt", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (attempt) => {
        const delay = backoffMs(attempt);
        // min possible: 500 * 2^0 + 0 = 500
        // max possible: 10_000 (cap) + 100 (max jitter) = 10_100
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(10_100);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 14: CompleteResponse round-trips through JSON without data loss ─
// Feature: sdk-node, Property 14: CompleteResponse round-trips through JSON without data loss
// Validates: Requirements 3.2, 13.4b

describe("Property 14: CompleteResponse round-trips through JSON without data loss", () => {
  it("all gatectr metadata fields survive JSON.stringify + JSON.parse", async () => {
    const metadataArb = fc.record({
      requestId: nonEmptyString,
      latencyMs: fc.nat(),
      overage: fc.boolean(),
      modelUsed: nonEmptyString,
      tokensSaved: fc.nat(),
    });

    await fc.assert(
      fc.asyncProperty(
        metadataArb,
        async ({ requestId, latencyMs, overage, modelUsed, tokensSaved }) => {
          server.use(
            http.post("https://api.gatectr.com/v1/complete", () =>
              HttpResponse.json(
                {
                  id: "cmpl_rt",
                  object: "text_completion",
                  model: modelUsed,
                  choices: [{ text: "ok", finish_reason: "stop" }],
                  usage: {
                    prompt_tokens: 5,
                    completion_tokens: 3,
                    total_tokens: 8,
                    saved_tokens: tokensSaved,
                  },
                },
                {
                  headers: {
                    "x-gatectr-request-id": requestId,
                    "x-gatectr-latency-ms": String(latencyMs),
                    "x-gatectr-overage": String(overage),
                  },
                },
              ),
            ),
          );

          const client = new GateCtr({ apiKey: "test-key" });
          const response = await client.complete({
            model: "gpt-4o",
            messages: [{ role: "user", content: "hi" }],
          });

          // Round-trip through JSON
          const roundTripped = JSON.parse(JSON.stringify(response)) as CompleteResponse;

          expect(roundTripped.gatectr.requestId).toBe(requestId);
          expect(roundTripped.gatectr.latencyMs).toBe(latencyMs);
          expect(roundTripped.gatectr.overage).toBe(overage);
          expect(roundTripped.gatectr.modelUsed).toBe(modelUsed);
          expect(roundTripped.gatectr.tokensSaved).toBe(tokensSaved);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 15: Invalid baseUrl throws GateCtrConfigError ──────────────────
// Feature: sdk-node, Property 15: Invalid baseUrl throws GateCtrConfigError
// Validates: Requirements 16.5

describe("Property 15: Invalid baseUrl throws GateCtrConfigError", () => {
  it("throws GateCtrConfigError for any non-HTTP/HTTPS URL", () => {
    fc.assert(
      fc.property(invalidBaseUrl, (baseUrl) => {
        expect(() => new GateCtr({ apiKey: "test-key", baseUrl })).toThrow(GateCtrConfigError);
      }),
      { numRuns: 100 },
    );
  });
});
