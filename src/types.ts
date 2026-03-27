/** Client configuration passed to the GateCtr constructor */
export interface GateCtrConfig {
  /** Bearer token for authentication. Falls back to GATECTR_API_KEY env var. */
  apiKey?: string;
  /** Base URL for the GateCtr API. Default: "https://api.gatectr.com/v1" */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 30000 */
  timeout?: number;
  /** Maximum number of retries for transient errors. Default: 3 */
  maxRetries?: number;
  /** Enable Context Optimizer globally. Default: true */
  optimize?: boolean;
  /** Enable Model Router globally. Default: false */
  route?: boolean;
}

/** Per-request GateCtr overrides passed in params.gatectr */
export interface PerRequestOptions {
  /** Budget ID to enforce for this request */
  budgetId?: string;
  /** Override client-level optimize setting for this request */
  optimize?: boolean;
  /** Override client-level route setting for this request */
  route?: boolean;
}

/** OpenAI-compatible message shape */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/** GateCtr metadata present on every response */
export interface GateCtrMetadata {
  /** Unique request ID from X-GateCtr-Request-Id header */
  requestId: string;
  /** Request latency in ms from X-GateCtr-Latency-Ms header */
  latencyMs: number;
  /** Whether the request exceeded the budget, from X-GateCtr-Overage header */
  overage: boolean;
  /** The model that actually processed the request */
  modelUsed: string;
  /** Number of tokens saved by the Context Optimizer */
  tokensSaved: number;
}

/** Token usage counts */
export interface UsageCounts {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Parameters for client.complete() */
export interface CompleteParams {
  model: string;
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  /** Per-request GateCtr overrides */
  gatectr?: PerRequestOptions;
  /** AbortSignal to cancel the request */
  signal?: AbortSignal;
}

/** Response from client.complete() */
export interface CompleteResponse {
  id: string;
  object: "text_completion";
  model: string;
  choices: Array<{ text: string; finish_reason: string }>;
  usage: UsageCounts;
  gatectr: GateCtrMetadata;
}

/** Parameters for client.chat() */
export interface ChatParams {
  model: string;
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  /** Per-request GateCtr overrides */
  gatectr?: PerRequestOptions;
  /** AbortSignal to cancel the request */
  signal?: AbortSignal;
}

/** Response from client.chat() */
export interface ChatResponse {
  id: string;
  object: "chat.completion";
  model: string;
  choices: Array<{ message: Message; finish_reason: string }>;
  usage: UsageCounts;
  gatectr: GateCtrMetadata;
}

/** Parameters for client.stream() */
export interface StreamParams {
  model: string;
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  /** Per-request GateCtr overrides */
  gatectr?: PerRequestOptions;
  /** AbortSignal to cancel the stream */
  signal?: AbortSignal;
}

/** A single SSE chunk yielded by client.stream() */
export interface StreamChunk {
  /** Completion ID */
  id: string;
  /** Incremental text delta, null on final chunk */
  delta: string | null;
  /** Finish reason, non-null on final chunk */
  finishReason: string | null;
}

/** Information about a single available model */
export interface ModelInfo {
  modelId: string;
  displayName: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
}

/** Response from client.models() */
export interface ModelsResponse {
  models: ModelInfo[];
  requestId: string;
}

/** Optional filters for client.usage() */
export interface UsageParams {
  /** Start date in YYYY-MM-DD format */
  from?: string;
  /** End date in YYYY-MM-DD format */
  to?: string;
  /** Filter by project ID */
  projectId?: string;
}

/** Per-project usage breakdown */
export interface UsageByProject {
  projectId: string | null;
  totalTokens: number;
  totalRequests: number;
  totalCostUsd: number;
}

/** Response from client.usage() */
export interface UsageResponse {
  totalTokens: number;
  totalRequests: number;
  totalCostUsd: number;
  savedTokens: number;
  from: string;
  to: string;
  byProject: UsageByProject[];
  budgetStatus?: Record<string, unknown>;
}

// ─── Usage Trends ─────────────────────────────────────────────────────────────

/** Optional filters for client.usageTrends() */
export interface UsageTrendsParams {
  /** Start date in YYYY-MM-DD format */
  from?: string;
  /** End date in YYYY-MM-DD format */
  to?: string;
  /** Filter by project ID */
  projectId?: string;
  /** Granularity: "day" | "week" | "month". Default: "day" */
  granularity?: "day" | "week" | "month";
}

/** A single data point in the trend series */
export interface UsageTrendPoint {
  date: string;
  totalTokens: number;
  savedTokens: number;
  totalRequests: number;
  totalCostUsd: number;
}

/** Response from client.usageTrends() */
export interface UsageTrendsResponse {
  granularity: string;
  from: string;
  to: string;
  series: UsageTrendPoint[];
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/** Parameters for client.webhooks.create() */
export interface WebhookCreateParams {
  name: string;
  url: string;
  events?: string[];
}

/** Parameters for client.webhooks.update() */
export interface WebhookUpdateParams {
  name?: string;
  url?: string;
  events?: string[];
  isActive?: boolean;
}

/** A webhook object */
export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastFiredAt: string | null;
  failCount: number;
  successCount: number;
  createdAt: string;
}

/** Response from client.webhooks.list() */
export interface WebhooksListResponse {
  webhooks: Webhook[];
}

// ─── Budget ───────────────────────────────────────────────────────────────────

/** Parameters for client.budget.set() */
export interface BudgetSetParams {
  projectId?: string;
  maxTokensPerDay?: number;
  maxTokensPerMonth?: number;
  maxCostPerDay?: number;
  maxCostPerMonth?: number;
  alertThresholdPct?: number;
  hardStop?: boolean;
  notifyOnThreshold?: boolean;
  notifyOnExceeded?: boolean;
}

/** A budget object */
export interface Budget {
  id: string;
  userId?: string | null;
  projectId?: string | null;
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  maxCostPerDay: number | null;
  maxCostPerMonth: number | null;
  alertThresholdPct: number;
  hardStop: boolean;
  notifyOnThreshold: boolean;
  notifyOnExceeded: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Response from client.budget.get() */
export interface BudgetGetResponse {
  userBudget: Budget | null;
  projectBudgets: Array<Budget & { project: { id: string; name: string; slug: string } }>;
}

// ─── Provider Keys ────────────────────────────────────────────────────────────

/** Parameters for client.providerKeys.add() */
export interface ProviderKeyAddParams {
  provider: "openai" | "anthropic" | "mistral" | "gemini";
  apiKey: string;
  name?: string;
}

/** A provider key object (never exposes the raw key) */
export interface ProviderKey {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}
