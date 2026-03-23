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
