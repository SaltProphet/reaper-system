// B1: the model call uses undici@7's own fetch with undici@7's Agent. Node 22 bundles undici 6
// in its global fetch, and mixing a v7 Agent into it is unsupported; pairing them avoids that.
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "../env.server.ts";
import { ProviderError } from "./errors.ts";
import type { RuntimeDependencies, SourceRecord } from "./types.ts";

// Code-level defaults stay as they were before Stage 1 so a cloud deploy keeps working.
// The local station's defaults (Ollama on loopback, gpt-oss-20b-32k) live in scripts/start-local.mjs.
export const DEFAULT_MODEL_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-5.4-mini";
export const DEFAULT_MODEL_TIMEOUT_MS = 600_000;
export const SOURCE_CONTENT_CAP = 7_000;
export const ANALYSIS_INSTRUCTIONS =
  "Analyze only the supplied source records. Every factual claim must cite one or more supplied source IDs. Put uncertainty and missing evidence in limitations. Do not invent IDs or facts. Copy source IDs exactly as given, ASCII only.";
export const REAPER_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "claims", "limitations"],
  properties: {
    summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "sourceIds"],
        properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
      },
    },
    limitations: { type: "array", items: { type: "string" } },
  },
};

export function modelAgentOptions(timeoutMs: number) {
  return { headersTimeout: timeoutMs, bodyTimeout: timeoutMs };
}

const modelAgents = new Map<number, Agent>();
function modelAgent(timeoutMs: number): Agent {
  let agent = modelAgents.get(timeoutMs);
  if (!agent) {
    agent = new Agent(modelAgentOptions(timeoutMs));
    modelAgents.set(timeoutMs, agent);
  }
  return agent;
}

export type ModelConfig = { baseUrl: string; apiKey?: string; model: string; timeoutMs: number };

type KeyEnv = { OPENAI_API_KEY?: string; REAPER_MODEL_API_KEY?: string };

/**
 * S1: which key (if any) goes in the Authorization header. OPENAI_API_KEY is sent only to
 * api.openai.com; any other host gets REAPER_MODEL_API_KEY, and only over https. A key that
 * is present but not sent yields a warning that never contains the value.
 */
export function modelAuth(baseUrl: string, keys: KeyEnv): { apiKey?: string; warning?: string } {
  const url = new URL(baseUrl);
  const openaiKey = keys.OPENAI_API_KEY?.trim() || undefined;
  const reaperKey = keys.REAPER_MODEL_API_KEY?.trim() || undefined;
  if (url.hostname === "api.openai.com") return openaiKey ? { apiKey: openaiKey } : {};
  if (url.protocol === "https:" && reaperKey) return { apiKey: reaperKey };
  const unsent = [openaiKey && "OPENAI_API_KEY", reaperKey && "REAPER_MODEL_API_KEY"].filter(Boolean);
  if (!unsent.length) return {};
  return {
    warning: `[reaper] ${unsent.join(" and ")} is set but not sent to ${url.protocol}//${url.host}: only api.openai.com gets OPENAI_API_KEY, and only an https base URL gets REAPER_MODEL_API_KEY.`,
  };
}

function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

export function modelConfig(): ModelConfig {
  const baseUrl = (env("OPENAI_BASE_URL") ?? DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`OPENAI_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (host === "api.openai.com" && !env("OPENAI_API_KEY")) throw new Error("OPENAI_API_KEY is not configured.");
  const auth = modelAuth(baseUrl, { OPENAI_API_KEY: env("OPENAI_API_KEY"), REAPER_MODEL_API_KEY: env("REAPER_MODEL_API_KEY") });
  if (auth.warning) console.warn(auth.warning);
  const apiKey = auth.apiKey;
  const rawTimeout = env("REAPER_MODEL_TIMEOUT_MS");
  const timeoutMs = rawTimeout === undefined ? DEFAULT_MODEL_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error(`REAPER_MODEL_TIMEOUT_MS must be a whole number of milliseconds >= 1000, got "${rawTimeout}".`);
  }
  return { baseUrl, apiKey, model: env("OPENAI_MODEL") ?? DEFAULT_MODEL, timeoutMs };
}

type JsonObject = Record<string, unknown>;
type ProviderAnalysis = {
  summary: string;
  claims: { text: string; sourceIds: string[] }[];
  limitations: string[];
};

function messageFor(response: { status: number; statusText: string }, payload: unknown): string {
  if (payload && typeof payload === "object") {
    const object = payload as JsonObject;
    const error = object.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as JsonObject).message === "string") {
      return (error as JsonObject).message as string;
    }
  }
  return `${response.status} ${response.statusText}`.trim();
}

type FetchResponse = { ok: boolean; status: number; statusText: string; json(): Promise<unknown> };
/** The fetch seam: tests inject a mock; production passes undici's fetch for the model call. */
export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<FetchResponse>;
type PostOptions = { apiKey?: string; timeoutMs: number; dispatcher?: Agent; fetch?: FetchLike };

/** An HTTP (non-2xx) failure; `status` lets classifyModelError tell it from a network error. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`${status}: ${message}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function postJson(url: string, body: unknown, options: PostOptions): Promise<JsonObject> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  const init = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
  };
  // A dispatcher (undici@7 Agent) only ever travels with undici@7's fetch (B1).
  const doFetch: FetchLike = options.fetch
    ?? (options.dispatcher ? (undiciFetch as unknown as FetchLike) : (globalThis.fetch as unknown as FetchLike));
  const response = await doFetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, messageFor(response, payload));
  return payload as JsonObject;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function incomplete(payload: JsonObject): Error {
  const reason = text(asRecord(payload.incomplete_details).reason) || "unknown";
  return new Error(`Model reply incomplete: ${reason}`);
}

export function responseOutputText(payload: JsonObject): string {
  // R1: a reply that stopped early (e.g. max_output_tokens) would parse as truncated JSON.
  // Mocked or older replies may omit status; when it is present it must be "completed".
  if (typeof payload.status === "string" && payload.status !== "completed") throw incomplete(payload);
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      const record = asRecord(item);
      if (record.type !== "message") continue;
      if (record.status === "incomplete") throw incomplete(payload);
      const content = Array.isArray(record.content) ? record.content : [];
      for (const part of content) {
        const object = asRecord(part);
        const isAnswer = object.type === undefined || object.type === "output_text";
        if (isAnswer && typeof object.text === "string" && object.text.trim()) return object.text;
      }
    }
    throw new Error("Model returned no answer text.");
  }
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  throw new Error("Model returned no answer text.");
}

const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"]);
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "UND_ERR_SOCKET"]);

export function classifyModelError(error: unknown, config: Pick<ModelConfig, "baseUrl" | "timeoutMs">): Error {
  const name = (error as { name?: unknown } | null)?.name;
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (name === "TimeoutError" || name === "AbortError" || (typeof code === "string" && TIMEOUT_CODES.has(code))) {
    return new ProviderError(`Model call timed out after ${Math.round(config.timeoutMs / 1000)} s at ${config.baseUrl}.`, false);
  }
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) {
    return new ProviderError(`Model server not reachable at ${config.baseUrl}.`, false);
  }
  // R2: an HTTP error from a local model server (e.g. a 500 when the runner crashes or runs out
  // of memory) is not retried: a retry doubles the GPU load. Remote errors keep the regex rule.
  if (error instanceof HttpError && isLoopbackUrl(config.baseUrl)) {
    return new ProviderError(error.message, false);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type ProviderOptions = { modelFetch?: FetchLike };

export function createProviderDependencies(options: ProviderOptions = {}): RuntimeDependencies {
  const modelFetch = options.modelFetch ?? (undiciFetch as unknown as FetchLike);
  return {
    async research(query, limit) {
      const key = env("FIRECRAWL_API_KEY");
      if (!key) throw new Error("FIRECRAWL_API_KEY is not configured.");
      const payload = await postJson("https://api.firecrawl.dev/v2/search", {
        query,
        limit: Math.min(5, Math.max(1, limit)),
        sources: [{ type: "web" }],
        safe: true,
        timeout: 45_000,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }, { apiKey: key, timeoutMs: 60_000 });
      const dataObject = asRecord(payload.data);
      const candidates = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(dataObject.web)
          ? dataObject.web
          : [];
      const retrievedAt = new Date().toISOString();
      return candidates.slice(0, 5).flatMap<SourceRecord>((candidate, index) => {
        const item = asRecord(candidate);
        const metadata = asRecord(item.metadata);
        const url = text(item.url) || text(metadata.sourceURL) || text(metadata.url);
        if (!url) return [];
        return [{
          id: `SRC-${String(index + 1).padStart(3, "0")}`,
          url,
          title: text(item.title) || text(metadata.title) || url,
          retrievedAt,
          content: (text(item.markdown) || text(item.description) || text(item.content)).slice(0, SOURCE_CONTENT_CAP),
        }];
      });
    },

    async analyze(objective, sources) {
      const config = modelConfig();
      const model = config.model;
      let payload: JsonObject;
      try {
        payload = await postJson(`${config.baseUrl}/responses`, {
          model,
          instructions: ANALYSIS_INSTRUCTIONS,
          input: JSON.stringify({ objective, sources }),
          text: { format: { type: "json_schema", name: "reaper_analysis", strict: true, schema: REAPER_ANALYSIS_SCHEMA } },
        }, { apiKey: config.apiKey, timeoutMs: config.timeoutMs, dispatcher: modelAgent(config.timeoutMs), fetch: modelFetch });
      } catch (error) {
        throw classifyModelError(error, config);
      }
      const parsed = JSON.parse(responseOutputText(payload)) as ProviderAnalysis;
      const rawUsage = asRecord(payload.usage);
      const input = tokenCount(rawUsage.input_tokens);
      const output = tokenCount(rawUsage.output_tokens);
      const usage = input !== undefined || output !== undefined ? { input, output } : undefined;
      const claimsValid = Array.isArray(parsed?.claims) && parsed.claims.every((claim) =>
        claim && typeof claim.text === "string" && Array.isArray(claim.sourceIds) && claim.sourceIds.every((id) => typeof id === "string"));
      if (!parsed || typeof parsed.summary !== "string" || !claimsValid || !Array.isArray(parsed.limitations)
        || !parsed.limitations.every((item) => typeof item === "string")) {
        throw new Error("Model returned malformed structured analysis.");
      }
      return {
        summary: parsed.summary,
        claims: parsed.claims.map((claim) => ({ ...claim, supported: false })),
        limitations: parsed.limitations,
        model,
        ...(usage ? { tokens: usage } : {}),
      };
    },
  };
}
