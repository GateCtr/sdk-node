// sdk-node/src/errors.ts

/** Base error class for all GateCtr SDK errors */
export class GateCtrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateCtrError";
    // Fix prototype chain for instanceof checks in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown for invalid or missing configuration (e.g., no API key) */
export class GateCtrConfigError extends GateCtrError {
  constructor(message: string) {
    super(message);
    this.name = "GateCtrConfigError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the Platform returns a non-2xx HTTP response */
export class GateCtrApiError extends GateCtrError {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(opts: { message: string; status: number; code: string; requestId?: string }) {
    super(opts.message);
    this.name = "GateCtrApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Returns a plain object safe for JSON.stringify in logging pipelines. Never includes the API key. */
  toJSON(): {
    name: string;
    message: string;
    status: number;
    code: string;
    requestId: string | undefined;
  } {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      requestId: this.requestId,
    };
  }
}

/** Thrown when a request exceeds the configured timeout */
export class GateCtrTimeoutError extends GateCtrError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${String(timeoutMs)}ms`);
    this.name = "GateCtrTimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a streaming connection fails mid-stream */
export class GateCtrStreamError extends GateCtrError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GateCtrStreamError";
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown for DNS failures, connection refused, and other transport-level errors */
export class GateCtrNetworkError extends GateCtrError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GateCtrNetworkError";
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
