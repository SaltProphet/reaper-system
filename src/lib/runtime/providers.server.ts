import { Agent } from "undici";
import { env } from "../env.server.ts";
import { ProviderError } from "./errors.ts";
import type { RuntimeDependencies, SourceRecord } from "./types.ts";

export const DEFAULT_MODEL_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_MODEL = "gpt-oss:20b";
export const DEFAULT_MODEL_TIMEOUT_MS = 600_000;
export const ANALYSIS_INSTRUCTIONS =
  "Analyze only the supplied source records. Every factual claim must cite one or more supplied source IDs. Put uncertainty and missing evidence in limitations. Do not invent IDs or facts.";
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

export function modelConfig(): ModelConfig {
  const baseUrl = (env("OPENAI_BASE_URL") ?? DEFAULT_MODEL_BASE_URL).replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`OPENAI_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  const apiKey = env("OPENAI_API_KEY");
  if (host === "api.openai.com" && !apiKey) throw new Error("OPENAI_API_KEY is not configured.");
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

function messageFor(response: Response, payload: unknown): string {
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

type PostOptions = { apiKey?: string; timeoutMs: number; dispatcher?: unknown };

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
  const response = await fetch(url, init as RequestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${messageFor(response, payload)}`);
  return payload as JsonObject;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function responseOutputText(payload: JsonObject): string {
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      const record = asRecord(item);
      if (record.type !== "message") continue;
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
  return error instanceof Error ? error : new Error(String(error));
}

export function createProviderDependencies(): RuntimeDependencies {
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
          content: (text(item.markdown) || text(item.description) || text(item.content)).slice(0, 20_000),
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
        }, { apiKey: config.apiKey, timeoutMs: config.timeoutMs, dispatcher: modelAgent(config.timeoutMs) });
      } catch (error) {
        throw classifyModelError(error, config);
      }
      const parsed = JSON.parse(responseOutputText(payload)) as ProviderAnalysis;
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
      };
    },
  };
}
