// sdk-node/tests/http.test.ts
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { httpRequest, backoffMs } from "../src/http.js";
import {
  GateCtrApiError,
  GateCtrTimeoutError,
  GateCtrNetworkError,
} from "../src/errors.js";

const BASE_URL = "https://api.gatectr.com/v1";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const defaultOpts = {
  method: "POST" as const,
  url: `${BASE_URL}/complete`,
  headers: {
    Authorization: "Bearer gct_test",
    "Content-Type": "application/json",
    "User-Agent": "@gatectr/sdk/0.1.0 node/v18.0.0",
  },
  body: { model: "gpt-4o", messages: [] },
  timeoutMs: 5000,
  maxRetries: 0,
};

describe("httpRequest — success", () => {
  it("returns RawResponse on 200", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json(
          { id: "cmpl_1", object: "text_completion" },
          {
            headers: {
              "x-gatectr-request-id": "req_abc",
              "x-gatectr-latency-ms": "42",
            },
          },
        ),
      ),
    );

    const res = await httpRequest(defaultOpts);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gatectr-request-id")).toBe("req_abc");
    const body = await res.json();
    expect((body as Record<string, unknown>)["id"]).toBe("cmpl_1");
  });
});

describe("httpRequest — non-retryable errors", () => {
  it.each([400, 401, 403, 404])(
    "throws GateCtrApiError immediately for status %i (no retry)",
    async (status) => {
      let callCount = 0;
      server.use(
        http.post(`${BASE_URL}/complete`, () => {
          callCount++;
          return HttpResponse.json(
            { code: "test_error", message: `Error ${status}` },
            { status },
          );
        }),
      );

      await expect(httpRequest(defaultOpts)).rejects.toThrow(GateCtrApiError);
      expect(callCount).toBe(1); // no retry
    },
  );

  it("throws GateCtrApiError with correct status for 401", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json(
          { code: "invalid_api_key", message: "Unauthorized" },
          { status: 401 },
        ),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).status).toBe(401);
    expect((err as GateCtrApiError).code).toBe("invalid_api_key");
  });
});

describe("httpRequest — retry logic", () => {
  it("retries retryable status codes up to maxRetries+1 total attempts", async () => {
    let callCount = 0;
    server.use(
      http.post(`${BASE_URL}/complete`, () => {
        callCount++;
        return HttpResponse.json({ code: "server_error" }, { status: 500 });
      }),
    );

    const opts = { ...defaultOpts, maxRetries: 2 };
    await expect(httpRequest(opts)).rejects.toThrow(GateCtrApiError);
    expect(callCount).toBe(3); // 1 initial + 2 retries
  });

  it.each([429, 500, 502, 503, 504])(
    "retries on status %i",
    async (status) => {
      let callCount = 0;
      server.use(
        http.post(`${BASE_URL}/complete`, () => {
          callCount++;
          return HttpResponse.json({ code: "error" }, { status });
        }),
      );

      const opts = { ...defaultOpts, maxRetries: 1 };
      await expect(httpRequest(opts)).rejects.toThrow(GateCtrApiError);
      expect(callCount).toBe(2);
    },
  );

  it("succeeds on retry after initial failure", async () => {
    let callCount = 0;
    server.use(
      http.post(`${BASE_URL}/complete`, () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ code: "server_error" }, { status: 500 });
        }
        return HttpResponse.json({ id: "cmpl_ok" });
      }),
    );

    const opts = { ...defaultOpts, maxRetries: 2 };
    const res = await httpRequest(opts);
    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });
});

describe("httpRequest — timeout", () => {
  it("throws GateCtrTimeoutError when request exceeds timeoutMs", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({});
      }),
    );

    const opts = { ...defaultOpts, timeoutMs: 50, maxRetries: 0 };
    await expect(httpRequest(opts)).rejects.toThrow(GateCtrTimeoutError);
  });
});

describe("httpRequest — headers", () => {
  it("sends Authorization, User-Agent, and Content-Type headers", async () => {
    let capturedHeaders: Headers | null = null;
    server.use(
      http.post(`${BASE_URL}/complete`, ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json({});
      }),
    );

    await httpRequest(defaultOpts);
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("authorization")).toBe("Bearer gct_test");
    expect(capturedHeaders!.get("content-type")).toBe("application/json");
    expect(capturedHeaders!.get("user-agent")).toContain("@gatectr/sdk");
  });
});

describe("backoffMs", () => {
  it("returns values within expected range for each attempt", () => {
    // attempt 0: base=500, max=600 (500 + 100 jitter)
    for (let i = 0; i < 20; i++) {
      const delay0 = backoffMs(0);
      expect(delay0).toBeGreaterThanOrEqual(500);
      expect(delay0).toBeLessThanOrEqual(600);
    }

    // attempt 1: base=1000, max=1100
    for (let i = 0; i < 20; i++) {
      const delay1 = backoffMs(1);
      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1100);
    }

    // attempt 2: base=2000, max=2100
    for (let i = 0; i < 20; i++) {
      const delay2 = backoffMs(2);
      expect(delay2).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeLessThanOrEqual(2100);
    }
  });

  it("caps at 10000ms", () => {
    // attempt 10: base=512000 → capped at 10000
    for (let i = 0; i < 10; i++) {
      expect(backoffMs(10)).toBeLessThanOrEqual(10_000);
    }
  });
});

describe("httpRequest — unknown status code", () => {
  it("throws GateCtrApiError with unexpected_status code for unknown status", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        new HttpResponse(null, { status: 418 }),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).status).toBe(418);
    expect((err as GateCtrApiError).code).toBe("unexpected_status");
  });
});

describe("httpRequest — caller AbortSignal cancellation", () => {
  it("propagates caller abort without wrapping in GateCtrNetworkError", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({});
      }),
    );

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    const opts = { ...defaultOpts, signal: controller.signal, timeoutMs: 5000, maxRetries: 0 };
    await expect(httpRequest(opts)).rejects.toThrow();
  });
});

describe("httpRequest — error body parsing", () => {
  it("uses message field from error body when present", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json({ message: "Custom error message", code: "custom_code" }, { status: 400 }),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).message).toBe("Custom error message");
    expect((err as GateCtrApiError).code).toBe("custom_code");
  });

  it("uses error field from error body when message is absent", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json({ error: "Something went wrong" }, { status: 400 }),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).message).toBe("Something went wrong");
  });

  it("includes requestId from response header in GateCtrApiError", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json({ error: "Not found" }, {
          status: 404,
          headers: { "x-gatectr-request-id": "req_xyz789" },
        }),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).requestId).toBe("req_xyz789");
  });
});

describe("httpRequest — GET request (no body)", () => {
  it("sends GET without Content-Type or body", async () => {
    let capturedMethod: string | undefined;
    let capturedBody: string | null = null;

    server.use(
      http.get(`${BASE_URL}/models`, async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = await request.text();
        return HttpResponse.json({ models: [] });
      }),
    );

    const opts = {
      method: "GET" as const,
      url: `${BASE_URL}/models`,
      headers: { Authorization: "Bearer gct_test", "User-Agent": "@gatectr/sdk/0.1.0" },
      timeoutMs: 5000,
      maxRetries: 0,
    };

    await httpRequest(opts);
    expect(capturedMethod).toBe("GET");
    expect(capturedBody).toBe("");
  });
});

describe("httpRequest — retryable error body parsing", () => {
  it("extracts message from retryable error body", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        HttpResponse.json(
          { message: "Rate limit exceeded", code: "rate_limited" },
          { status: 429 },
        ),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).message).toBe("Rate limit exceeded");
    expect((err as GateCtrApiError).code).toBe("rate_limited");
  });

  it("falls back to HTTP status message when retryable body is not valid JSON", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        new HttpResponse("not json", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).status).toBe(500);
  });

  it("falls back to HTTP status message when non-retryable body is not valid JSON", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () =>
        new HttpResponse("not json", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const err = await httpRequest(defaultOpts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect((err as GateCtrApiError).status).toBe(400);
  });
});

describe("httpRequest — caller signal already aborted before request", () => {
  it("throws immediately when caller signal is pre-aborted", async () => {
    server.use(
      http.post(`${BASE_URL}/complete`, () => HttpResponse.json({})),
    );

    const controller = new AbortController();
    controller.abort(); // abort before the call

    const opts = { ...defaultOpts, signal: controller.signal, maxRetries: 0 };
    await expect(httpRequest(opts)).rejects.toThrow();
  });
});
