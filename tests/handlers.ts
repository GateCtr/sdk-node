// sdk-node/tests/handlers.ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const BASE_URL = "https://api.gatectr.com/v1";

// ─── Mock response factories ─────────────────────────────────────────────────

export function mockCompleteResponse(overrides?: Record<string, unknown>) {
  return {
    id: "cmpl_test123",
    object: "text_completion",
    model: "gpt-4o",
    choices: [
      {
        text: "Hello, world!",
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      saved_tokens: 3,
    },
    ...overrides,
  };
}

export function mockChatResponse(overrides?: Record<string, unknown>) {
  return {
    id: "chatcmpl_test123",
    object: "chat.completion",
    model: "gpt-4o",
    choices: [
      {
        message: {
          role: "assistant",
          content: "Hello! How can I help you?",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
      saved_tokens: 4,
    },
    ...overrides,
  };
}

export function mockSSEChunk(
  id: string,
  content: string,
  finishReason: string | null = null,
): string {
  const data = JSON.stringify({
    id,
    object: "chat.completion.chunk",
    model: "gpt-4o",
    choices: [
      {
        delta: { content },
        finish_reason: finishReason,
      },
    ],
  });
  return `data: ${data}\n\n`;
}

export function mockSSEResponse(
  chunks: Array<{ content: string; finishReason?: string | null }> = [
    { content: "Hello" },
    { content: " world" },
    { content: "!", finishReason: "stop" },
  ],
): Response {
  const encoder = new TextEncoder();
  const id = "chatcmpl_stream_test";

  const sseBody =
    chunks.map((c) => mockSSEChunk(id, c.content, c.finishReason ?? null)).join("") +
    "data: [DONE]\n\n";

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "x-gatectr-request-id": "req_stream_test",
      "x-gatectr-latency-ms": "55",
    },
  });
}

export function mockModelsResponse(overrides?: Record<string, unknown>) {
  return {
    models: [
      {
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        contextWindow: 128000,
        capabilities: ["chat", "complete", "stream"],
      },
      {
        modelId: "claude-3-5-sonnet",
        displayName: "Claude 3.5 Sonnet",
        provider: "anthropic",
        contextWindow: 200000,
        capabilities: ["chat", "complete", "stream"],
      },
    ],
    ...overrides,
  };
}

export function mockUsageResponse(overrides?: Record<string, unknown>) {
  return {
    totalTokens: 150000,
    totalRequests: 500,
    totalCostUsd: 4.5,
    savedTokens: 45000,
    from: "2025-01-01",
    to: "2025-01-31",
    byProject: [
      {
        projectId: "proj_abc123",
        totalTokens: 100000,
        totalRequests: 300,
        totalCostUsd: 3.0,
      },
      {
        projectId: null,
        totalTokens: 50000,
        totalRequests: 200,
        totalCostUsd: 1.5,
      },
    ],
    ...overrides,
  };
}

export function mockUsageTrendsResponse(overrides?: Record<string, unknown>) {
  return {
    granularity: "day",
    from: "2025-01-01",
    to: "2025-01-07",
    series: [
      {
        date: "2025-01-01",
        totalTokens: 10000,
        savedTokens: 2000,
        totalRequests: 50,
        totalCostUsd: 0.3,
      },
      {
        date: "2025-01-02",
        totalTokens: 12000,
        savedTokens: 2400,
        totalRequests: 60,
        totalCostUsd: 0.36,
      },
    ],
    ...overrides,
  };
}

export function mockWebhook(overrides?: Record<string, unknown>) {
  return {
    id: "wh_test123",
    name: "My Webhook",
    url: "https://example.com/hook",
    events: ["budget.alert", "request.completed"],
    isActive: true,
    lastFiredAt: null,
    failCount: 0,
    successCount: 5,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

export function mockBudget(overrides?: Record<string, unknown>) {
  return {
    id: "bgt_test123",
    userId: "user_abc",
    projectId: null,
    maxTokensPerDay: 100000,
    maxTokensPerMonth: 2000000,
    maxCostPerDay: null,
    maxCostPerMonth: null,
    alertThresholdPct: 80,
    hardStop: false,
    notifyOnThreshold: true,
    notifyOnExceeded: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

export function mockProviderKey(overrides?: Record<string, unknown>) {
  return {
    id: "pk_test123",
    provider: "openai",
    name: "Default",
    isActive: true,
    lastUsedAt: null,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── Default response headers ────────────────────────────────────────────────

export const DEFAULT_RESPONSE_HEADERS = {
  "x-gatectr-request-id": "req_test_abc123",
  "x-gatectr-latency-ms": "42",
  "x-gatectr-overage": "false",
};

// ─── MSW handlers ────────────────────────────────────────────────────────────

export const handlers = [
  // POST /complete
  http.post(`${BASE_URL}/complete`, () =>
    HttpResponse.json(mockCompleteResponse(), {
      headers: DEFAULT_RESPONSE_HEADERS,
    }),
  ),

  // POST /chat — handles both streaming and non-streaming
  http.post(`${BASE_URL}/chat`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (body["stream"] === true) {
      return mockSSEResponse();
    }
    return HttpResponse.json(mockChatResponse(), {
      headers: DEFAULT_RESPONSE_HEADERS,
    });
  }),

  // GET /models
  http.get(`${BASE_URL}/models`, () =>
    HttpResponse.json(mockModelsResponse(), {
      headers: DEFAULT_RESPONSE_HEADERS,
    }),
  ),

  // GET /usage
  http.get(`${BASE_URL}/usage`, () =>
    HttpResponse.json(mockUsageResponse(), {
      headers: DEFAULT_RESPONSE_HEADERS,
    }),
  ),

  // GET /usage/trends
  http.get(`${BASE_URL}/usage/trends`, () =>
    HttpResponse.json(mockUsageTrendsResponse(), {
      headers: DEFAULT_RESPONSE_HEADERS,
    }),
  ),

  // GET /webhooks
  http.get(`${BASE_URL}/webhooks`, () =>
    HttpResponse.json(
      { webhooks: [mockWebhook()] },
      {
        headers: DEFAULT_RESPONSE_HEADERS,
      },
    ),
  ),

  // POST /webhooks
  http.post(`${BASE_URL}/webhooks`, () =>
    HttpResponse.json(mockWebhook(), { status: 201, headers: DEFAULT_RESPONSE_HEADERS }),
  ),

  // PATCH /webhooks/:id
  http.patch(`${BASE_URL}/webhooks/:id`, () =>
    HttpResponse.json(mockWebhook({ name: "Updated" }), { headers: DEFAULT_RESPONSE_HEADERS }),
  ),

  // DELETE /webhooks/:id
  http.delete(`${BASE_URL}/webhooks/:id`, () => new HttpResponse(null, { status: 204 })),

  // GET /budget
  http.get(`${BASE_URL}/budget`, () =>
    HttpResponse.json(
      { userBudget: mockBudget(), projectBudgets: [] },
      {
        headers: DEFAULT_RESPONSE_HEADERS,
      },
    ),
  ),

  // POST /budget
  http.post(`${BASE_URL}/budget`, () =>
    HttpResponse.json(mockBudget(), { headers: DEFAULT_RESPONSE_HEADERS }),
  ),

  // GET /provider-keys
  http.get(`${BASE_URL}/provider-keys`, () =>
    HttpResponse.json([mockProviderKey()], { headers: DEFAULT_RESPONSE_HEADERS }),
  ),

  // POST /provider-keys
  http.post(`${BASE_URL}/provider-keys`, () =>
    HttpResponse.json(mockProviderKey(), { status: 201, headers: DEFAULT_RESPONSE_HEADERS }),
  ),

  // DELETE /provider-keys/:id
  http.delete(`${BASE_URL}/provider-keys/:id`, () =>
    HttpResponse.json({ success: true }, { headers: DEFAULT_RESPONSE_HEADERS }),
  ),
];

// ─── Shared server instance ──────────────────────────────────────────────────

export const server = setupServer(...handlers);
