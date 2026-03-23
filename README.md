<div align="center">

<img src="https://raw.githubusercontent.com/GateCtr/.github/main/profile/logo.svg" width="56" height="56" alt="GateCtr" />

# @gatectr/sdk

**Node.js SDK for GateCtr — One gateway. Every LLM.**

[![npm](https://img.shields.io/npm/v/@gatectr/sdk?color=1B4F82)](https://www.npmjs.com/package/@gatectr/sdk)
[![CI](https://github.com/GateCtr/sdk-node/actions/workflows/ci.yml/badge.svg)](https://github.com/GateCtr/sdk-node/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-00B4C8)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

</div>

---

## Install

```bash
npm install @gatectr/sdk
pnpm add @gatectr/sdk
yarn add @gatectr/sdk
bun add @gatectr/sdk
```

## Quick start

```typescript
import { GateCtr } from "@gatectr/sdk";

const client = new GateCtr({ apiKey: process.env.GATECTR_API_KEY });

const response = await client.complete({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(response.choices[0]?.text);
console.log(response.gatectr.tokensSaved); // tokens saved by the optimizer
```

One endpoint swap. Your existing code works as-is.

---

## What GateCtr adds automatically

- **-40% tokens** — Context Optimizer compresses prompts before they hit the LLM
- **Budget Firewall** — Hard caps per project. Requests blocked when limit is reached.
- **Model Router** — Let GateCtr pick the right model for each request
- **Analytics** — Every token, every cost tracked in your dashboard
- **Webhooks** — Budget alerts pushed to Slack, Teams, or any URL

---

## Usage

### Completion

```typescript
const response = await client.complete({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Summarize this document." },
  ],
  max_tokens: 512,
  temperature: 0.7,
});
```

### Chat

```typescript
const response = await client.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(response.choices[0]?.message.content);
```

### Streaming

```typescript
for await (const chunk of client.stream({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
})) {
  process.stdout.write(chunk.delta ?? "");
}
```

### Models & usage

```typescript
const { models } = await client.models();
// [{ modelId: "gpt-4o", provider: "openai", ... }, ...]

const usage = await client.usage({ from: "2025-01-01", to: "2025-01-31" });
// { totalTokens: 150000, savedTokens: 45000, ... }
```

### Per-request options

```typescript
const response = await client.complete({
  model: "gpt-4o",
  messages,
  gatectr: {
    budgetId: "proj_123", // enforce a specific budget
    optimize: true, // override client-level setting
    route: false, // disable model router for this call
  },
});
```

---

## Configuration

```typescript
const client = new GateCtr({
  apiKey: "gct_...", // or set GATECTR_API_KEY env var
  baseUrl: "https://api.gatectr.com/v1", // default
  timeout: 30_000, // ms, default 30s
  maxRetries: 3, // default 3
  optimize: true, // enable context optimizer globally
  route: false, // disable model router globally
});
```

| Option       | Type      | Default                      | Description                       |
| ------------ | --------- | ---------------------------- | --------------------------------- |
| `apiKey`     | `string`  | `GATECTR_API_KEY` env var    | Your GateCtr API key              |
| `baseUrl`    | `string`  | `https://api.gatectr.com/v1` | API base URL                      |
| `timeout`    | `number`  | `30000`                      | Request timeout in ms             |
| `maxRetries` | `number`  | `3`                          | Retries on 429/5xx                |
| `optimize`   | `boolean` | `true`                       | Enable context optimizer globally |
| `route`      | `boolean` | `false`                      | Enable model router globally      |

---

## Error handling

```typescript
import { GateCtrApiError, GateCtrTimeoutError, GateCtrNetworkError } from "@gatectr/sdk";

try {
  await client.complete({ model: "gpt-4o", messages });
} catch (err) {
  if (err instanceof GateCtrApiError) {
    console.error(err.status, err.code, err.requestId);
  } else if (err instanceof GateCtrTimeoutError) {
    console.error(`Timed out after ${err.timeoutMs}ms`);
  } else if (err instanceof GateCtrNetworkError) {
    console.error("Network error", err.cause);
  }
}
```

| Error class           | When                                      |
| --------------------- | ----------------------------------------- |
| `GateCtrConfigError`  | Invalid `apiKey` or `baseUrl` at init     |
| `GateCtrApiError`     | Non-2xx response from the API             |
| `GateCtrTimeoutError` | Request exceeded `timeout`                |
| `GateCtrNetworkError` | Network failure (DNS, connection refused) |
| `GateCtrStreamError`  | SSE stream parse or connection error      |

---

## Drop-in for OpenAI SDK

Already using the OpenAI SDK? Swap the base URL:

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.GATECTR_API_KEY,
  baseURL: "https://api.gatectr.com/v1",
});

// Everything else stays the same
```

---

## Requirements

- Node.js 22+
- TypeScript 5+ (optional but recommended)

---

## Links

[Dashboard](https://gatectr.com) · [Docs](https://docs.gatectr.com) · [Status](https://status.gatectr.com) · [npm](https://www.npmjs.com/package/@gatectr/sdk)
