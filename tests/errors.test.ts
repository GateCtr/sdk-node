// sdk-node/tests/errors.test.ts
import { describe, it, expect } from "vitest";
import {
  GateCtrError,
  GateCtrConfigError,
  GateCtrApiError,
  GateCtrTimeoutError,
  GateCtrStreamError,
  GateCtrNetworkError,
} from "../src/errors.js";

describe("GateCtrError hierarchy", () => {
  it("GateCtrConfigError is instanceof GateCtrError and GateCtrConfigError", () => {
    const err = new GateCtrConfigError("missing api key");
    expect(err).toBeInstanceOf(GateCtrConfigError);
    expect(err).toBeInstanceOf(GateCtrError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GateCtrConfigError");
    expect(err.message).toBe("missing api key");
  });

  it("GateCtrApiError is instanceof GateCtrError", () => {
    const err = new GateCtrApiError({
      message: "Unauthorized",
      status: 401,
      code: "invalid_api_key",
      requestId: "req_abc123",
    });
    expect(err).toBeInstanceOf(GateCtrApiError);
    expect(err).toBeInstanceOf(GateCtrError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("invalid_api_key");
    expect(err.requestId).toBe("req_abc123");
    expect(err.name).toBe("GateCtrApiError");
  });

  it("GateCtrApiError.toJSON() returns safe shape without API key", () => {
    const err = new GateCtrApiError({
      message: "Rate limit exceeded",
      status: 429,
      code: "rate_limit_exceeded",
      requestId: "req_xyz",
    });
    const json = err.toJSON();
    expect(json).toEqual({
      name: "GateCtrApiError",
      message: "Rate limit exceeded",
      status: 429,
      code: "rate_limit_exceeded",
      requestId: "req_xyz",
    });
    // Must not contain any API key field
    expect(Object.keys(json)).not.toContain("apiKey");
    expect(Object.keys(json)).not.toContain("api_key");
    expect(Object.keys(json)).not.toContain("key");
  });

  it("GateCtrApiError.toJSON() works when requestId is undefined", () => {
    const err = new GateCtrApiError({
      message: "Server error",
      status: 500,
      code: "internal_error",
    });
    const json = err.toJSON();
    expect(json.requestId).toBeUndefined();
    expect(json.status).toBe(500);
  });

  it("GateCtrTimeoutError includes timeoutMs in message and field", () => {
    const err = new GateCtrTimeoutError(30000);
    expect(err).toBeInstanceOf(GateCtrTimeoutError);
    expect(err).toBeInstanceOf(GateCtrError);
    expect(err.timeoutMs).toBe(30000);
    expect(err.message).toContain("30000");
    expect(err.name).toBe("GateCtrTimeoutError");
  });

  it("GateCtrStreamError is instanceof GateCtrError", () => {
    const cause = new Error("connection reset");
    const err = new GateCtrStreamError("Stream failed", cause);
    expect(err).toBeInstanceOf(GateCtrStreamError);
    expect(err).toBeInstanceOf(GateCtrError);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("GateCtrStreamError");
  });

  it("GateCtrNetworkError is instanceof GateCtrError", () => {
    const cause = new Error("ECONNREFUSED");
    const err = new GateCtrNetworkError("Network error", cause);
    expect(err).toBeInstanceOf(GateCtrNetworkError);
    expect(err).toBeInstanceOf(GateCtrError);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("GateCtrNetworkError");
  });

  it("GateCtrStreamError works without cause", () => {
    const err = new GateCtrStreamError("Stream closed unexpectedly");
    expect(err.cause).toBeUndefined();
  });

  it("all error classes have correct name property", () => {
    expect(new GateCtrError("x").name).toBe("GateCtrError");
    expect(new GateCtrConfigError("x").name).toBe("GateCtrConfigError");
    expect(new GateCtrApiError({ message: "x", status: 400, code: "bad" }).name).toBe(
      "GateCtrApiError",
    );
    expect(new GateCtrTimeoutError(1000).name).toBe("GateCtrTimeoutError");
    expect(new GateCtrStreamError("x").name).toBe("GateCtrStreamError");
    expect(new GateCtrNetworkError("x").name).toBe("GateCtrNetworkError");
  });
});
