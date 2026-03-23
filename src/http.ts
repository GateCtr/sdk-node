// sdk-node/src/http.ts
import {
  GateCtrApiError,
  GateCtrNetworkError,
  GateCtrTimeoutError,
} from "./errors.js";

export interface RequestOptions {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs: number;
  maxRetries: number;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
}

/** Status codes that warrant automatic retry */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Status codes that should never be retried */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404]);

/**
 * Exponential backoff with jitter.
 * delay = min(500 * 2^attempt + jitter(0-100ms), 10_000ms)
 */
export function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 101);
  return Math.min(base + jitter, 10_000);
}

/** Sleep for the given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Combines multiple AbortSignals into one. Safe for Node 18+.
 * The returned signal aborts when any of the input signals abort.
 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      "abort",
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

/**
 * Core HTTP request function with retry loop and timeout.
 * Throws typed GateCtr errors — never raw fetch errors.
 */
export async function httpRequest(opts: RequestOptions): Promise<RawResponse> {
  const {
    method,
    url,
    headers,
    body,
    signal: callerSignal,
    timeoutMs,
    maxRetries,
  } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Apply backoff before retry attempts (not before the first attempt)
    if (attempt > 0) {
      await sleep(backoffMs(attempt - 1));
    }

    // Create a per-attempt AbortController for timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, timeoutMs);

    // Combine caller signal with timeout signal
    const combinedSignal = callerSignal
      ? combineSignals([callerSignal, timeoutController.signal])
      : timeoutController.signal;

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: combinedSignal,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      // Distinguish timeout from other network errors
      if (timeoutController.signal.aborted && !callerSignal?.aborted) {
        throw new GateCtrTimeoutError(timeoutMs);
      }

      // Caller cancelled — rethrow as-is so the caller can handle it
      if (callerSignal?.aborted) {
        throw err;
      }

      // Other network error (DNS, ECONNREFUSED, etc.)
      lastError = new GateCtrNetworkError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );

      // Network errors are retryable
      if (attempt < maxRetries) {
        continue;
      }
      throw lastError;
    }

    clearTimeout(timeoutId);

    // 2xx — success
    if (response.status >= 200 && response.status < 300) {
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        json: () => response.json(),
      };
    }

    // Non-retryable client errors — throw immediately
    if (NON_RETRYABLE_STATUSES.has(response.status)) {
      const requestId =
        response.headers.get("x-gatectr-request-id") ?? undefined;
      let code = "api_error";
      let message = `HTTP ${String(response.status)}`;

      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody["code"] === "string") code = errorBody["code"];
        if (typeof errorBody["message"] === "string")
          message = errorBody["message"];
        if (typeof errorBody["error"] === "string")
          message = errorBody["error"];
      } catch {
        // ignore parse errors
      }

      throw new GateCtrApiError({
        message,
        status: response.status,
        code,
        ...(requestId !== undefined ? { requestId } : {}),
      });
    }

    // Retryable server errors
    if (RETRYABLE_STATUSES.has(response.status)) {
      const requestId =
        response.headers.get("x-gatectr-request-id") ?? undefined;
      let code = "server_error";
      let message = `HTTP ${String(response.status)}`;

      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody["code"] === "string") code = errorBody["code"];
        if (typeof errorBody["message"] === "string")
          message = errorBody["message"];
      } catch {
        // ignore parse errors
      }

      lastError = new GateCtrApiError({
        message,
        status: response.status,
        code,
        ...(requestId !== undefined ? { requestId } : {}),
      });

      if (attempt < maxRetries) {
        continue;
      }
      throw lastError;
    }

    // Unknown status — treat as non-retryable
    const requestId =
      response.headers.get("x-gatectr-request-id") ?? undefined;
    throw new GateCtrApiError({
      message: `Unexpected HTTP status ${String(response.status)}`,
      status: response.status,
      code: "unexpected_status",
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }

  // Should never reach here, but TypeScript needs it
  const fallback = lastError instanceof Error
    ? lastError
    : new GateCtrNetworkError("Request failed after retries");
  throw fallback;
}
