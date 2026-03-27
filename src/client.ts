// sdk-node/src/client.ts
import { GateCtrConfigError } from "./errors.js";
import { httpRequest } from "./http.js";
import { parseSSE } from "./stream.js";
import type {
  GateCtrConfig,
  PerRequestOptions,
  CompleteParams,
  CompleteResponse,
  ChatParams,
  ChatResponse,
  StreamParams,
  StreamChunk,
  ModelsResponse,
  UsageParams,
  UsageResponse,
  UsageTrendsParams,
  UsageTrendsResponse,
  WebhookCreateParams,
  WebhookUpdateParams,
  WebhooksListResponse,
  Webhook,
  BudgetSetParams,
  Budget,
  BudgetGetResponse,
  ProviderKeyAddParams,
  ProviderKey,
  GateCtrMetadata,
} from "./types.js";
import type { RequestOptions } from "./http.js";


// SDK version constant — avoids ESM/CJS import.meta.url compatibility issues
const SDK_VERSION = "0.1.0";

const DEFAULT_BASE_URL = "https://api.gatectr.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * GateCtr client — the main entry point for the @gatectr/sdk.
 *
 * @example
 * ```typescript
 * const client = new GateCtr({ apiKey: process.env.GATECTR_API_KEY });
 * const response = await client.complete({ model: "gpt-4o", messages: [...] });
 * ```
 */
export class GateCtr {
  /** Resolved, validated configuration (all fields required after construction) */
  private readonly _baseUrl: string;
  private readonly _apiKey: string;
  private readonly _timeout: number;
  private readonly _maxRetries: number;
  private readonly _optimize: boolean;
  private readonly _route: boolean;

  constructor(config: GateCtrConfig = {}) {
    // Resolve API key: constructor option → env var → throw
    const rawKey = config.apiKey ?? process.env["GATECTR_API_KEY"];

    if (!rawKey || rawKey.trim() === "") {
      throw new GateCtrConfigError(
        "GateCtr API key is required. Pass apiKey in the config or set the GATECTR_API_KEY environment variable.",
      );
    }

    this._apiKey = rawKey.trim();

    // Validate and normalize baseUrl
    const rawBaseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    try {
      const parsed = new URL(rawBaseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new GateCtrConfigError(
          `Invalid baseUrl: "${rawBaseUrl}". Must be an HTTP or HTTPS URL.`,
        );
      }
    } catch (err) {
      if (err instanceof GateCtrConfigError) throw err;
      throw new GateCtrConfigError(
        `Invalid baseUrl: "${rawBaseUrl}". Must be a valid HTTP or HTTPS URL.`,
      );
    }

    // Strip trailing slash(es)
    this._baseUrl = rawBaseUrl.replace(/\/+$/, "");

    this._timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this._maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this._optimize = config.optimize ?? true;
    this._route = config.route ?? false;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Build the standard headers for every request */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this._apiKey}`,
      "User-Agent": `@gatectr/sdk/${SDK_VERSION} node/${process.version}`,
      ...extra,
    };
  }

  /** Extract GateCtrMetadata from response headers + body */
  private extractMetadata(headers: Headers, body: Record<string, unknown>): GateCtrMetadata {
    const requestId = headers.get("x-gatectr-request-id") ?? "";
    const latencyMs = parseInt(headers.get("x-gatectr-latency-ms") ?? "0", 10);
    const overage = headers.get("x-gatectr-overage") === "true";

    const usage = body["usage"] as Record<string, unknown> | undefined;
    const tokensSaved = typeof usage?.["saved_tokens"] === "number" ? usage["saved_tokens"] : 0;
    const modelUsed = typeof body["model"] === "string" ? body["model"] : "";

    return { requestId, latencyMs, overage, modelUsed, tokensSaved };
  }

  /** Merge per-request GateCtr options into the request body */
  private mergeGatectrOptions(perRequest: PerRequestOptions | undefined): Record<string, unknown> {
    const merged: Record<string, unknown> = {
      optimize: this._optimize,
      route: this._route,
    };

    if (perRequest !== undefined) {
      if (perRequest.optimize !== undefined) merged["optimize"] = perRequest.optimize;
      if (perRequest.route !== undefined) merged["route"] = perRequest.route;
      if (perRequest.budgetId !== undefined) merged["budgetId"] = perRequest.budgetId;
    }

    return merged;
  }

  /** Build RequestOptions, conditionally including signal to satisfy exactOptionalPropertyTypes */
  private buildRequestOptions(
    base: Omit<RequestOptions, "signal">,
    signal: AbortSignal | undefined,
  ): RequestOptions {
    if (signal !== undefined) {
      return { ...base, signal };
    }
    return base;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Text completion — POST /complete
   */
  async complete(params: CompleteParams): Promise<CompleteResponse> {
    const gatectrOpts = this.mergeGatectrOptions(params.gatectr);

    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: false,
      ...gatectrOpts,
    };
    if (params.max_tokens !== undefined) body["max_tokens"] = params.max_tokens;
    if (params.temperature !== undefined) body["temperature"] = params.temperature;

    const raw = await httpRequest(
      this.buildRequestOptions(
        {
          method: "POST",
          url: `${this._baseUrl}/complete`,
          headers: {
            ...this.buildHeaders(),
            "Content-Type": "application/json",
          },
          body,
          timeoutMs: this._timeout,
          maxRetries: this._maxRetries,
        },
        params.signal,
      ),
    );

    const responseBody = (await raw.json()) as Record<string, unknown>;
    const gatectr = this.extractMetadata(raw.headers, responseBody);

    const usageBody = responseBody["usage"] as Record<string, unknown> | undefined;
    const promptTokens = usageBody !== undefined ? Number(usageBody["prompt_tokens"] ?? 0) : 0;
    const completionTokens =
      usageBody !== undefined ? Number(usageBody["completion_tokens"] ?? 0) : 0;
    const totalTokens = usageBody !== undefined ? Number(usageBody["total_tokens"] ?? 0) : 0;

    return {
      id: typeof responseBody["id"] === "string" ? responseBody["id"] : "",
      object: "text_completion",
      model: typeof responseBody["model"] === "string" ? responseBody["model"] : "",
      choices: (Array.isArray(responseBody["choices"])
        ? (responseBody["choices"] as Array<Record<string, unknown>>)
        : []
      ).map((c) => ({
        text: typeof c["text"] === "string" ? c["text"] : "",
        finish_reason: typeof c["finish_reason"] === "string" ? c["finish_reason"] : "",
      })),
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      gatectr,
    };
  }

  /**
   * Chat completion — POST /chat
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    const gatectrOpts = this.mergeGatectrOptions(params.gatectr);

    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: false,
      ...gatectrOpts,
    };
    if (params.max_tokens !== undefined) body["max_tokens"] = params.max_tokens;
    if (params.temperature !== undefined) body["temperature"] = params.temperature;

    const raw = await httpRequest(
      this.buildRequestOptions(
        {
          method: "POST",
          url: `${this._baseUrl}/chat`,
          headers: {
            ...this.buildHeaders(),
            "Content-Type": "application/json",
          },
          body,
          timeoutMs: this._timeout,
          maxRetries: this._maxRetries,
        },
        params.signal,
      ),
    );

    const responseBody = (await raw.json()) as Record<string, unknown>;
    const gatectr = this.extractMetadata(raw.headers, responseBody);

    const usageBody = responseBody["usage"] as Record<string, unknown> | undefined;
    const promptTokens = usageBody !== undefined ? Number(usageBody["prompt_tokens"] ?? 0) : 0;
    const completionTokens =
      usageBody !== undefined ? Number(usageBody["completion_tokens"] ?? 0) : 0;
    const totalTokens = usageBody !== undefined ? Number(usageBody["total_tokens"] ?? 0) : 0;

    return {
      id: typeof responseBody["id"] === "string" ? responseBody["id"] : "",
      object: "chat.completion",
      model: typeof responseBody["model"] === "string" ? responseBody["model"] : "",
      choices: (Array.isArray(responseBody["choices"])
        ? (responseBody["choices"] as Array<Record<string, unknown>>)
        : []
      ).map((c) => {
        const msg = c["message"] as Record<string, unknown> | undefined;
        const role =
          msg !== undefined && typeof msg["role"] === "string"
            ? (msg["role"] as "system" | "user" | "assistant")
            : ("assistant" as const);
        const content =
          msg !== undefined && typeof msg["content"] === "string" ? msg["content"] : "";
        return {
          message: { role, content },
          finish_reason: typeof c["finish_reason"] === "string" ? c["finish_reason"] : "",
        };
      }),
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      gatectr,
    };
  }

  /**
   * Streaming chat completion — POST /chat with stream: true
   * Returns an AsyncIterable<StreamChunk> for use with `for await`.
   */
  async *stream(params: StreamParams): AsyncIterable<StreamChunk> {
    const gatectrOpts = this.mergeGatectrOptions(params.gatectr);

    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: true,
      ...gatectrOpts,
    };
    if (params.max_tokens !== undefined) body["max_tokens"] = params.max_tokens;
    if (params.temperature !== undefined) body["temperature"] = params.temperature;

    const raw = await httpRequest(
      this.buildRequestOptions(
        {
          method: "POST",
          url: `${this._baseUrl}/chat`,
          headers: {
            ...this.buildHeaders(),
            "Content-Type": "application/json",
          },
          body,
          timeoutMs: this._timeout,
          maxRetries: this._maxRetries,
        },
        params.signal,
      ),
    );

    if (raw.body === null) {
      return;
    }

    yield* parseSSE(raw.body, params.signal);
  }

  /**
   * List available models — GET /models
   */
  async models(): Promise<ModelsResponse> {
    const raw = await httpRequest({
      method: "GET",
      url: `${this._baseUrl}/models`,
      headers: this.buildHeaders(),
      timeoutMs: this._timeout,
      maxRetries: this._maxRetries,
    });

    const responseBody = (await raw.json()) as Record<string, unknown>;
    const requestId = raw.headers.get("x-gatectr-request-id") ?? "";

    const modelsRaw = (responseBody["models"] as Array<Record<string, unknown>> | undefined) ?? [];

    return {
      models: modelsRaw.map((m) => ({
        modelId:
          typeof m["modelId"] === "string"
            ? m["modelId"]
            : typeof m["model_id"] === "string"
              ? m["model_id"]
              : "",
        displayName:
          typeof m["displayName"] === "string"
            ? m["displayName"]
            : typeof m["display_name"] === "string"
              ? m["display_name"]
              : "",
        provider: typeof m["provider"] === "string" ? m["provider"] : "",
        contextWindow: Number(m["contextWindow"] ?? m["context_window"] ?? 0),
        capabilities: Array.isArray(m["capabilities"])
          ? (m["capabilities"] as unknown[]).map(String)
          : [],
      })),
      requestId,
    };
  }

  /**
   * Fetch usage statistics — GET /usage
   */
  async usage(params?: UsageParams): Promise<UsageResponse> {
    const url = new URL(`${this._baseUrl}/usage`);
    if (params?.from !== undefined) url.searchParams.set("from", params.from);
    if (params?.to !== undefined) url.searchParams.set("to", params.to);
    if (params?.projectId !== undefined) url.searchParams.set("projectId", params.projectId);

    const raw = await httpRequest({
      method: "GET",
      url: url.toString(),
      headers: this.buildHeaders(),
      timeoutMs: this._timeout,
      maxRetries: this._maxRetries,
    });

    const responseBody = (await raw.json()) as Record<string, unknown>;

    const byProject = (
      (responseBody["byProject"] as Array<Record<string, unknown>> | undefined) ?? []
    ).map((p) => ({
      projectId: typeof p["projectId"] === "string" ? p["projectId"] : null,
      totalTokens: Number(p["totalTokens"] ?? 0),
      totalRequests: Number(p["totalRequests"] ?? 0),
      totalCostUsd: Number(p["totalCostUsd"] ?? 0),
    }));

    return {
      totalTokens: Number(responseBody["totalTokens"] ?? 0),
      totalRequests: Number(responseBody["totalRequests"] ?? 0),
      totalCostUsd: Number(responseBody["totalCostUsd"] ?? 0),
      savedTokens: Number(responseBody["savedTokens"] ?? 0),
      from: typeof responseBody["from"] === "string" ? responseBody["from"] : "",
      to: typeof responseBody["to"] === "string" ? responseBody["to"] : "",
      byProject,
      ...(responseBody["budgetStatus"] !== undefined
        ? {
            budgetStatus: responseBody["budgetStatus"] as Record<string, unknown>,
          }
        : {}),
    };
  }

  /**
   * Fetch usage trends (time series) — GET /usage/trends
   * Requires scope: read
   */
  async usageTrends(params?: UsageTrendsParams): Promise<UsageTrendsResponse> {
    const url = new URL(`${this._baseUrl}/usage/trends`);
    if (params?.from) url.searchParams.set("from", params.from);
    if (params?.to) url.searchParams.set("to", params.to);
    if (params?.projectId) url.searchParams.set("projectId", params.projectId);
    if (params?.granularity) url.searchParams.set("granularity", params.granularity);

    const raw = await httpRequest({
      method: "GET",
      url: url.toString(),
      headers: this.buildHeaders(),
      timeoutMs: this._timeout,
      maxRetries: this._maxRetries,
    });

    const body = (await raw.json()) as Record<string, unknown>;
    const series = ((body["series"] as Array<Record<string, unknown>>) ?? []).map((p) => ({
      date: String(p["date"] ?? ""),
      totalTokens: Number(p["totalTokens"] ?? 0),
      savedTokens: Number(p["savedTokens"] ?? 0),
      totalRequests: Number(p["totalRequests"] ?? 0),
      totalCostUsd: Number(p["totalCostUsd"] ?? 0),
    }));

    return {
      granularity: String(body["granularity"] ?? "day"),
      from: String(body["from"] ?? ""),
      to: String(body["to"] ?? ""),
      series,
    };
  }

  /** Webhook management — requires scope: admin (write) or read (list) */
  readonly webhooks = {
    list: async (): Promise<WebhooksListResponse> => {
      const raw = await httpRequest({
        method: "GET",
        url: `${this._baseUrl}/webhooks`,
        headers: this.buildHeaders(),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as WebhooksListResponse;
    },

    create: async (params: WebhookCreateParams): Promise<Webhook> => {
      const raw = await httpRequest({
        method: "POST",
        url: `${this._baseUrl}/webhooks`,
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as Webhook;
    },

    update: async (id: string, params: WebhookUpdateParams): Promise<Webhook> => {
      const raw = await httpRequest({
        method: "PATCH",
        url: `${this._baseUrl}/webhooks/${id}`,
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as Webhook;
    },

    delete: async (id: string): Promise<void> => {
      await httpRequest({
        method: "DELETE",
        url: `${this._baseUrl}/webhooks/${id}`,
        headers: this.buildHeaders(),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
    },
  };

  /** Budget management — requires scope: admin (write) or read (get) */
  readonly budget = {
    get: async (): Promise<BudgetGetResponse> => {
      const raw = await httpRequest({
        method: "GET",
        url: `${this._baseUrl}/budget`,
        headers: this.buildHeaders(),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as BudgetGetResponse;
    },

    set: async (params: BudgetSetParams): Promise<Budget> => {
      const raw = await httpRequest({
        method: "POST",
        url: `${this._baseUrl}/budget`,
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as Budget;
    },
  };

  /** Provider key management — requires scope: admin (write) or read (list) */
  readonly providerKeys = {
    list: async (): Promise<ProviderKey[]> => {
      const raw = await httpRequest({
        method: "GET",
        url: `${this._baseUrl}/provider-keys`,
        headers: this.buildHeaders(),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as ProviderKey[];
    },

    add: async (params: ProviderKeyAddParams): Promise<ProviderKey> => {
      const raw = await httpRequest({
        method: "POST",
        url: `${this._baseUrl}/provider-keys`,
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ provider: params.provider, apiKey: params.apiKey, name: params.name }),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
      return (await raw.json()) as ProviderKey;
    },

    remove: async (id: string, hard = false): Promise<void> => {
      await httpRequest({
        method: "DELETE",
        url: `${this._baseUrl}/provider-keys/${id}${hard ? "?hard=true" : ""}`,
        headers: this.buildHeaders(),
        timeoutMs: this._timeout,
        maxRetries: this._maxRetries,
      });
    },
  };
}

