# Changelog

## 0.2.1

### Patch Changes

- fd009f6: ci: verify automated publish pipeline via Trusted Publishing

## 0.2.0

### Minor Changes

- e2fad07: Initial release of `@gatectr/sdk` — Node.js SDK for GateCtr.
  - `complete()` — single-turn LLM completion
  - `chat()` — multi-turn chat with message history
  - `stream()` — streaming completions via SSE
  - `models()` — list available models
  - `usage()` — fetch token usage stats
  - Drop-in OpenAI-compatible endpoint swap
  - Full TypeScript support (ESM + CJS dual build)
  - Budget Firewall and Context Optimizer transparent pass-through

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
