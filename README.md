<div align="center">

<img src="https://raw.githubusercontent.com/GateCtr/.github/main/profile/logo.svg" width="56" height="56" alt="GateCtr" />

# @gatectr/sdk

**Node.js SDK for GateCtr — One gateway. Every LLM.**

[![npm](https://img.shields.io/npm/v/@gatectr/sdk?color=1B4F82)](https://www.npmjs.com/package/@gatectr/sdk)
[![license](https://img.shields.io/badge/license-MIT-00B4C8)](LICENSE)
[![status](https://img.shields.io/badge/status-operational-38A169)](https://status.gatectr.com)

</div>

---

## Install

```bash
npm install @gatectr/sdk
# or
pnpm add @gatectr/sdk
```

## Quick start

```typescript
import { GateCtr } from "@gatectr/sdk";

const client = new GateCtr({ apiKey: process.env.GATECTR_API_KEY });

const response = await client.complete({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(response.choices[0].message.content);
```

One endpoint swap. Your existing OpenAI-compatible code works as-is.

---

## What GateCtr adds automatically

- **-40% tokens** — Context Optimizer compresses prompts before they hit the LLM
- **Budget Firewall** — Hard caps per project. Requests blocked when limit is reached.
- **Model Router** — Optionally let GateCtr pick the right model for each request
- **Analytics** — Every token, every cost tracked in your dashboard
- **Webhooks** — Budget alerts pushed to Slack, Teams, or any URL

---

## Usage

### Chat completion

```typescript
const response = await client.complete({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Summarize this document." },
  ],
});
```

### Streaming

```typescript
const stream = await client.stream({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

for await (const chunk of stream) {
  process.stdout.write(chunk.delta ?? "");
}
```

### With budget override

```typescript
const response = await client.complete({
  model: "gpt-4o",
  messages,
  gatectr: {
    budgetId: "proj_123", // enforce a specific budget
    optimize: true, // enable context optimizer
    route: false, // disable model router for this call
  },
});
```

### Model Router (auto-select)

```typescript
const response = await client.complete({
  model: "auto", // GateCtr picks the optimal model
  messages,
});

console.log(response.gatectr.modelUsed); // e.g. "gpt-3.5-turbo"
console.log(response.gatectr.tokensSaved); // e.g. 312
```

---

## Configuration

```typescript
const client = new GateCtr({
  apiKey: "your-api-key", // required — get it at gatectr.com
  baseUrl: "https://api.gatectr.com/v1", // default
  timeout: 30_000, // ms, default 30s
  optimize: true, // enable context optimizer globally
  route: false, // disable model router globally
});
```

| Option     | Type      | Default                      | Description              |
| ---------- | --------- | ---------------------------- | ------------------------ |
| `apiKey`   | `string`  | —                            | Your GateCtr API key     |
| `baseUrl`  | `string`  | `https://api.gatectr.com/v1` | API base URL             |
| `timeout`  | `number`  | `30000`                      | Request timeout in ms    |
| `optimize` | `boolean` | `true`                       | Enable context optimizer |
| `route`    | `boolean` | `false`                      | Enable model router      |

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

- Node.js 18+
- TypeScript 5+ (optional but recommended)

---

## Links

[Dashboard](https://gatectr.com) · [Docs](https://docs.gatectr.com) · [Status](https://status.gatectr.com) · [X](https://x.com/gatectrl)
