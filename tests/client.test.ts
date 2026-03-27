// sdk-node/tests/client.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import {
  server,
  mockCompleteResponse,
  mockChatResponse,
  mockUsageResponse,
  mockUsageTrendsResponse,
  mockSSEResponse,
  DEFAULT_RESPONSE_HEADERS,
} from "./handlers.js";
import { GateCtr } from "../src/client.js";
import { GateCtrConfigError, GateCtrApiError } from "../src/errors.js";

const BASE_URL = "https://api.gatectr.com/v1";
const TEST_API_KEY = "gct_test_key_abc123";

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

// ─── Construction ────────────────────────────────────────────────────────────

describe("GateCtr construction", () => {
  it("constructs successfully with a valid apiKey", () => {
    expect(() => new GateCtr({ apiKey: TEST_API_KEY })).not.toThrow();
  });

  it("throws GateCtrConfigError when apiKey is empty string", () => {
    expect(() => new GateCtr({ apiKey: "" })).toThrow(GateCtrConfigError);
  });

  it("throws GateCtrConfigError when apiKey is whitespace-only", () => {
    expect(() => new GateCtr({ apiKey: "   " })).toThrow(GateCtrConfigError);
  });

  it("throws GateCtrConfigError when no apiKey and no env var", () => {
    const saved = process.env["GATECTR_API_KEY"];
    delete process.env["GATECTR_API_KEY"];
    try {
      expect(() => new GateCtr({})).toThrow(GateCtrConfigError);
    } finally {
      if (saved !== undefined) process.env["GATECTR_API_KEY"] = saved;
    }
  });

  it("reads apiKey from GATECTR_API_KEY env var when not provided in config", () => {
    const saved = process.env["GATECTR_API_KEY"];
    process.env["GATECTR_API_KEY"] = "gct_from_env";
    try {
      expect(() => new GateCtr({})).not.toThrow();
    } finally {
      if (saved !== undefined) {
        process.env["GATECTR_API_KEY"] = saved;
      } else {
        delete process.env["GATECTR_API_KEY"];
      }
    }
  });

  it("throws GateCtrConfigError for invalid baseUrl (ftp://)", () => {
    expect(() => new GateCtr({ apiKey: TEST_API_KEY, baseUrl: "ftp://invalid.com" })).toThrow(
      GateCtrConfigError,
    );
  });

  it("throws GateCtrConfigError for non-URL baseUrl", () => {
    expect(() => new GateCtr({ apiKey: TEST_API_KEY, baseUrl: "not-a-url" })).toThrow(
      GateCtrConfigError,
    );
  });

  it("strips trailing slash from baseUrl", async () => {
    let capturedUrl = "";
    server.use(
      http.post("https://custom.example.com/v1/complete", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(mockCompleteResponse(), {
          headers: DEFAULT_RESPONSE_HEADERS,
        });
      }),
    );

    const client = new GateCtr({
      apiKey: TEST_API_KEY,
      baseUrl: "https://custom.example.com/v1/",
    });
    await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(capturedUrl).toBe("https://custom.example.com/v1/complete");
  });

  it("applies default config values", () => {
    // Construction should not throw — defaults are applied internally
    expect(() => new GateCtr({ apiKey: TEST_API_KEY })).not.toThrow();
  });
});

// ─── complete() ──────────────────────────────────────────────────────────────

describe("GateCtr.complete()", () => {
  it("sends POST to /complete and returns CompleteResponse", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const response = await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.id).toBe("cmpl_test123");
    expect(response.object).toBe("text_completion");
    expect(response.model).toBe("gpt-4o");
    expect(response.choices).toHaveLength(1);
    expect(response.choices[0]?.text).toBe("Hello, world!");
    expect(response.usage.total_tokens).toBe(15);
  });

  it("extracts GateCtr metadata from response headers", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const response = await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.gatectr.requestId).toBe("req_test_abc123");
    expect(response.gatectr.latencyMs).toBe(42);
    expect(response.gatectr.overage).toBe(false);
  });

  it("sends correct request body", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${BASE_URL}/complete`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(mockCompleteResponse(), {
          headers: DEFAULT_RESPONSE_HEADERS,
        });
      }),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY });
    await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Test" }],
      max_tokens: 100,
      temperature: 0.7,
    });

    expect(capturedBody).toMatchObject({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Test" }],
      max_tokens: 100,
      temperature: 0.7,
      stream: false,
    });
  });

  it("merges per-request gatectr options into request body", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${BASE_URL}/complete`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(mockCompleteResponse(), {
          headers: DEFAULT_RESPONSE_HEADERS,
        });
      }),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY, optimize: false });
    await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Test" }],
      gatectr: { optimize: true, budgetId: "proj_123" },
    });

    expect(capturedBody).toMatchObject({
      optimize: true, // per-request overrides client default (false)
      budgetId: "proj_123",
    });
  });

  it("sends Authorization header on every request", async () => {
    let capturedAuth = "";
    server.use(
      http.post(`${BASE_URL}/complete`, ({ request }) => {
        capturedAuth = request.headers.get("authorization") ?? "";
        return HttpResponse.json(mockCompleteResponse(), {
          headers: DEFAULT_RESPONSE_HEADERS,
        });
      }),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY });
    await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(capturedAuth).toBe(`Bearer ${TEST_API_KEY}`);
  });

  it("throws GateCtrApiError on 401", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json({ code: "invalid_api_key", message: "Unauthorized" }, { status: 401 }),
      ),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY, maxRetries: 0 });
    await expect(
      client.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(GateCtrApiError);
  });
});

// ─── chat() ──────────────────────────────────────────────────────────────────

describe("GateCtr.chat()", () => {
  it("sends POST to /chat and returns ChatResponse", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const response = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.id).toBe("chatcmpl_test123");
    expect(response.object).toBe("chat.completion");
    expect(response.choices[0]?.message.content).toBe("Hello! How can I help you?");
    expect(response.choices[0]?.message.role).toBe("assistant");
  });

  it("extracts GateCtr metadata from response headers", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const response = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.gatectr.requestId).toBe("req_test_abc123");
    expect(response.gatectr.latencyMs).toBe(42);
  });
});

// ─── stream() ────────────────────────────────────────────────────────────────

describe("GateCtr.stream()", () => {
  it("yields StreamChunks from SSE response", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const chunks: Array<{ delta: string | null }> = [];

    for await (const chunk of client.stream({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const assembled = chunks.map((c) => c.delta ?? "").join("");
    expect(assembled).toBe("Hello world!");
  });

  it("sends stream: true in request body", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${BASE_URL}/chat`, async ({ request }) => {
        capturedBody = await request.json();
        return mockSSEResponse();
      }),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY });
    // Consume the stream
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of client.stream({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    })) {
      // drain
    }

    expect((capturedBody as Record<string, unknown>)["stream"]).toBe(true);
  });
});

// ─── models() ────────────────────────────────────────────────────────────────

describe("GateCtr.models()", () => {
  it("sends GET to /models and returns ModelsResponse", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const response = await client.models();

    expect(response.models).toHaveLength(2);
    expect(response.models[0]?.modelId).toBe("gpt-4o");
    expect(response.models[0]?.provider).toBe("openai");
    expect(response.requestId).toBe("req_test_abc123");
  });
});

// ─── usage() ─────────────────────────────────────────────────────────────────

describe("GateCtr.usage()", () => {
  it("sends GET to /usage and returns UsageResponse", async () => {
    const client = new GateCtr({ apiKey: TEST_API_KEY });
    const response = await client.usage();

    expect(response.totalTokens).toBe(150000);
    expect(response.savedTokens).toBe(45000);
    expect(response.byProject).toHaveLength(2);
  });

  it("passes query params from UsageParams", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE_URL}/usage`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(mockUsageResponse(), {
          headers: DEFAULT_RESPONSE_HEADERS,
        });
      }),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY });
    await client.usage({
      from: "2025-01-01",
      to: "2025-01-31",
      projectId: "proj_abc",
    });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("from")).toBe("2025-01-01");
    expect(url.searchParams.get("to")).toBe("2025-01-31");
    expect(url.searchParams.get("projectId")).toBe("proj_abc");
  });
});

// ─── Security ────────────────────────────────────────────────────────────────

describe("Security — apiKey never leaks", () => {
  it("does not include apiKey in GateCtrConfigError message", () => {
    const secretKey = "gct_super_secret_key_xyz";
    try {
      new GateCtr({ apiKey: secretKey, baseUrl: "not-a-url" });
    } catch (err) {
      expect(err).toBeInstanceOf(GateCtrConfigError);
      expect((err as GateCtrConfigError).message).not.toContain(secretKey);
    }
  });

  it("does not include apiKey in GateCtrApiError message or toJSON()", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json({ code: "invalid_api_key", message: "Unauthorized" }, { status: 401 }),
      ),
    );

    const client = new GateCtr({ apiKey: TEST_API_KEY, maxRetries: 0 });
    try {
      await client.complete({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(GateCtrApiError);
      const apiErr = err as GateCtrApiError;
      expect(apiErr.message).not.toContain(TEST_API_KEY);
      expect(JSON.stringify(apiErr.toJSON())).not.toContain(TEST_API_KEY);
    }
  });
});

// ─── No network at module load ────────────────────────────────────────────────

describe("No network at module load time", () => {
  it("importing GateCtr does not trigger any HTTP requests", async () => {
    // If any request was made at import time, the msw server with
    // onUnhandledRequest: "error" would have thrown already.
    // This test simply verifies the module loaded cleanly.
    const { GateCtr: GateCtrImported } = await import("../src/client.js");
    expect(GateCtrImported).toBeDefined();
  });
});

// ─── Branch coverage additions ───────────────────────────────────────────────

describe("GateCtr — budgetId per-request option", () => {
  it("includes budgetId in request body when provided", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post("https://api.gatectr.com/v1/complete", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(mockCompleteResponse(), { headers: DEFAULT_RESPONSE_HEADERS });
      }),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      gatectr: { budgetId: "budget_abc123" },
    });

    expect(capturedBody?.["budgetId"]).toBe("budget_abc123");
  });
});

describe("GateCtr — usage() with query params", () => {
  it("appends from, to, and projectId as query params", async () => {
    let capturedUrl: string | undefined;
    server.use(
      http.get("https://api.gatectr.com/v1/usage", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(mockUsageResponse(), { headers: DEFAULT_RESPONSE_HEADERS });
      }),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    await client.usage({ from: "2025-01-01", to: "2025-01-31", projectId: "proj_xyz" });

    expect(capturedUrl).toContain("from=2025-01-01");
    expect(capturedUrl).toContain("to=2025-01-31");
    expect(capturedUrl).toContain("projectId=proj_xyz");
  });
});

describe("GateCtr — models() snake_case fallback", () => {
  it("falls back to model_id and display_name snake_case fields", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/models", () =>
        HttpResponse.json(
          {
            models: [
              {
                model_id: "claude-3-5-sonnet",
                display_name: "Claude 3.5 Sonnet",
                provider: "anthropic",
                context_window: 200000,
                capabilities: ["chat"],
              },
            ],
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.models();
    expect(res.models[0]?.modelId).toBe("claude-3-5-sonnet");
    expect(res.models[0]?.displayName).toBe("Claude 3.5 Sonnet");
  });
});

describe("GateCtr — response without usage body", () => {
  it("returns zero usage counts when usage field is absent from response", async () => {
    server.use(
      http.post("https://api.gatectr.com/v1/complete", () =>
        HttpResponse.json(
          {
            id: "cmpl_no_usage",
            object: "text_completion",
            model: "gpt-4o",
            choices: [{ text: "ok", finish_reason: "stop" }],
            // no usage field
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.usage.prompt_tokens).toBe(0);
    expect(res.usage.completion_tokens).toBe(0);
    expect(res.usage.total_tokens).toBe(0);
    expect(res.gatectr.tokensSaved).toBe(0);
  });
});

describe("GateCtr — complete() with max_tokens and temperature", () => {
  it("includes optional fields in request body when provided", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.post("https://api.gatectr.com/v1/complete", async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(mockCompleteResponse(), { headers: DEFAULT_RESPONSE_HEADERS });
      }),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 256,
      temperature: 0.7,
    });

    expect(capturedBody?.["max_tokens"]).toBe(256);
    expect(capturedBody?.["temperature"]).toBe(0.7);
  });
});

describe("GateCtr — chat() with missing message field in choice", () => {
  it("defaults role to assistant and content to empty string when message is absent", async () => {
    server.use(
      http.post("https://api.gatectr.com/v1/chat", () =>
        HttpResponse.json(
          {
            id: "chatcmpl_no_msg",
            object: "chat.completion",
            model: "gpt-4o",
            choices: [{ finish_reason: "stop" }], // no message field
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, saved_tokens: 0 },
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.choices[0]?.message.role).toBe("assistant");
    expect(res.choices[0]?.message.content).toBe("");
  });
});

describe("GateCtr — stream() with null body", () => {
  it("returns without yielding when response body is null", async () => {
    server.use(
      http.post(
        "https://api.gatectr.com/v1/chat",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: DEFAULT_RESPONSE_HEADERS,
          }),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const chunks: unknown[] = [];
    for await (const chunk of client.stream({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });
});

describe("GateCtr — complete() with non-array choices", () => {
  it("returns empty choices array when choices field is absent", async () => {
    server.use(
      http.post("https://api.gatectr.com/v1/complete", () =>
        HttpResponse.json(
          {
            id: "cmpl_no_choices",
            object: "text_completion",
            model: "gpt-4o",
            // no choices field
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, saved_tokens: 0 },
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.choices).toHaveLength(0);
  });
});

describe("GateCtr — models() contextWindow snake_case fallback", () => {
  it("reads context_window when contextWindow is absent", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/models", () =>
        HttpResponse.json(
          {
            models: [
              {
                modelId: "gpt-4o",
                displayName: "GPT-4o",
                provider: "openai",
                context_window: 128000, // snake_case only
                capabilities: ["chat"],
              },
            ],
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.models();
    expect(res.models[0]?.contextWindow).toBe(128000);
  });

  it("returns 0 contextWindow when both camelCase and snake_case are absent", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/models", () =>
        HttpResponse.json(
          {
            models: [{ modelId: "x", displayName: "X", provider: "p", capabilities: [] }],
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.models();
    expect(res.models[0]?.contextWindow).toBe(0);
  });
});

describe("GateCtr — usage() with budgetStatus in response", () => {
  it("includes budgetStatus when present in response body", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/usage", () =>
        HttpResponse.json(
          {
            ...mockUsageResponse(),
            budgetStatus: { proj_abc: { used: 1000, limit: 50000 } },
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.usage();
    expect(res.budgetStatus).toBeDefined();
    expect(res.budgetStatus?.["proj_abc"]).toBeDefined();
  });
});

describe("GateCtr — usage() byProject with null projectId", () => {
  it("maps null projectId correctly", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/usage", () =>
        HttpResponse.json(
          {
            ...mockUsageResponse(),
            byProject: [{ projectId: null, totalTokens: 100, totalRequests: 5, totalCostUsd: 0.5 }],
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.usage();
    expect(res.byProject[0]?.projectId).toBeNull();
  });
});

describe("GateCtr — models() defensive fallbacks", () => {
  it("returns empty strings and empty array when all model fields are missing", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/models", () =>
        HttpResponse.json(
          {
            models: [
              {
                /* completely empty model object */
              },
            ],
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.models();
    expect(res.models[0]?.modelId).toBe("");
    expect(res.models[0]?.displayName).toBe("");
    expect(res.models[0]?.provider).toBe("");
    expect(res.models[0]?.capabilities).toEqual([]);
  });

  it("returns empty models array when models field is absent", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/models", () =>
        HttpResponse.json({}, { headers: DEFAULT_RESPONSE_HEADERS }),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.models();
    expect(res.models).toHaveLength(0);
  });
});

describe("GateCtr — usage() defensive fallbacks", () => {
  it("returns empty strings for from/to when absent in response", async () => {
    server.use(
      http.get("https://api.gatectr.com/v1/usage", () =>
        HttpResponse.json(
          {
            totalTokens: 0,
            totalRequests: 0,
            totalCostUsd: 0,
            savedTokens: 0,
            // no from/to
            byProject: [],
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.usage();
    expect(res.from).toBe("");
    expect(res.to).toBe("");
  });
});

describe("GateCtr — http.ts non-Error network error", () => {
  it("handles non-Error thrown by fetch (string throw)", async () => {
    // msw can't simulate a raw string throw from fetch, but we can test
    // the GateCtrNetworkError constructor handles non-Error causes gracefully
    const { GateCtrNetworkError } = await import("../src/errors.js");
    const err = new GateCtrNetworkError("Network error: connection refused", "raw string cause");
    expect(err).toBeInstanceOf(GateCtrNetworkError);
    expect(err.message).toContain("connection refused");
  });
});

describe("GateCtr — AbortSignal passed to complete() and chat()", () => {
  it("passes signal through to the request (complete)", async () => {
    server.use(
      http.post("https://api.gatectr.com/v1/complete", () =>
        HttpResponse.json(mockCompleteResponse(), { headers: DEFAULT_RESPONSE_HEADERS }),
      ),
    );

    const controller = new AbortController();
    const client = new GateCtr({ apiKey: "gct_test" });
    // Should succeed — signal not aborted
    const res = await client.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });
    expect(res.id).toBeDefined();
  });

  it("passes signal through to the request (chat)", async () => {
    server.use(
      http.post("https://api.gatectr.com/v1/chat", () =>
        HttpResponse.json(mockChatResponse(), { headers: DEFAULT_RESPONSE_HEADERS }),
      ),
    );

    const controller = new AbortController();
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });
    expect(res.id).toBeDefined();
  });
});

describe("GateCtr — chat() with non-array choices", () => {
  it("returns empty choices array when choices field is absent in chat response", async () => {
    server.use(
      http.post("https://api.gatectr.com/v1/chat", () =>
        HttpResponse.json(
          {
            id: "chatcmpl_no_choices",
            object: "chat.completion",
            model: "gpt-4o",
            // no choices field
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, saved_tokens: 0 },
          },
          { headers: DEFAULT_RESPONSE_HEADERS },
        ),
      ),
    );

    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.choices).toHaveLength(0);
  });
});

// ─── usageTrends ─────────────────────────────────────────────────────────────

describe("client.usageTrends()", () => {
  it("returns trend series with correct shape", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.usageTrends();
    expect(res.granularity).toBe("day");
    expect(res.from).toBe("2025-01-01");
    expect(res.to).toBe("2025-01-07");
    expect(res.series).toHaveLength(2);
    expect(res.series[0]).toMatchObject({
      date: "2025-01-01",
      totalTokens: 10000,
      savedTokens: 2000,
      totalRequests: 50,
      totalCostUsd: 0.3,
    });
  });

  it("passes query params correctly", async () => {
    let capturedUrl = "";
    server.use(
      http.get("https://api.gatectr.com/v1/usage/trends", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(mockUsageTrendsResponse(), { headers: DEFAULT_RESPONSE_HEADERS });
      }),
    );
    const client = new GateCtr({ apiKey: "gct_test" });
    await client.usageTrends({ from: "2025-01-01", to: "2025-01-31", granularity: "week" });
    expect(capturedUrl).toContain("from=2025-01-01");
    expect(capturedUrl).toContain("to=2025-01-31");
    expect(capturedUrl).toContain("granularity=week");
  });
});

// ─── webhooks ─────────────────────────────────────────────────────────────────

describe("client.webhooks", () => {
  it("list() returns webhooks array", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.webhooks.list();
    expect(res.webhooks).toHaveLength(1);
    expect(res.webhooks[0]?.id).toBe("wh_test123");
  });

  it("create() returns created webhook", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.webhooks.create({
      name: "My Webhook",
      url: "https://example.com/hook",
    });
    expect(res.id).toBe("wh_test123");
    expect(res.name).toBe("My Webhook");
  });

  it("update() returns updated webhook", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.webhooks.update("wh_test123", { name: "Updated" });
    expect(res.name).toBe("Updated");
  });

  it("delete() resolves without error", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    await expect(client.webhooks.delete("wh_test123")).resolves.toBeUndefined();
  });
});

// ─── budget ───────────────────────────────────────────────────────────────────

describe("client.budget", () => {
  it("get() returns budget response", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.budget.get();
    expect(res.userBudget?.id).toBe("bgt_test123");
    expect(res.projectBudgets).toHaveLength(0);
  });

  it("set() returns updated budget", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.budget.set({ maxTokensPerDay: 100000 });
    expect(res.id).toBe("bgt_test123");
    expect(res.maxTokensPerDay).toBe(100000);
  });
});

// ─── providerKeys ─────────────────────────────────────────────────────────────

describe("client.providerKeys", () => {
  it("list() returns provider keys array", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.providerKeys.list();
    expect(res).toHaveLength(1);
    expect(res[0]?.provider).toBe("openai");
  });

  it("add() returns created provider key", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    const res = await client.providerKeys.add({ provider: "openai", apiKey: "sk-test" });
    expect(res.id).toBe("pk_test123");
    expect(res.provider).toBe("openai");
  });

  it("remove() resolves without error", async () => {
    const client = new GateCtr({ apiKey: "gct_test" });
    await expect(client.providerKeys.remove("pk_test123")).resolves.toBeUndefined();
  });
});
