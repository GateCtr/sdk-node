// sdk-node/src/index.ts
// Public API surface for @gatectr/sdk

export { GateCtr } from "./client.js";

export {
  GateCtrError,
  GateCtrConfigError,
  GateCtrApiError,
  GateCtrTimeoutError,
  GateCtrStreamError,
  GateCtrNetworkError,
} from "./errors.js";

export type {
  GateCtrConfig,
  PerRequestOptions,
  Message,
  GateCtrMetadata,
  UsageCounts,
  CompleteParams,
  CompleteResponse,
  ChatParams,
  ChatResponse,
  StreamParams,
  StreamChunk,
  ModelInfo,
  ModelsResponse,
  UsageParams,
  UsageByProject,
  UsageResponse,
  UsageTrendsParams,
  UsageTrendPoint,
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
} from "./types.js";

