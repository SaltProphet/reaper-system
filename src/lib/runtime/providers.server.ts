import { env } from "../env.server.ts";
import type { RuntimeDependencies, SourceRecord } from "./types.ts";

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

async function postJson(url: string, apiKey: string, body: unknown): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
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

function responseOutputText(payload: JsonObject): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(asRecord(item).content) ? asRecord(item).content as unknown[] : [];
    for (const part of content) {
      const object = asRecord(part);
      if (typeof object.text === "string") return object.text;
    }
  }
  throw new Error("OpenAI returned no structured analysis text.");
}

export function createProviderDependencies(): RuntimeDependencies {
  return {
    async research(query, limit) {
      const key = env("FIRECRAWL_API_KEY");
      if (!key) throw new Error("FIRECRAWL_API_KEY is not configured.");
      const payload = await postJson("https://api.firecrawl.dev/v2/search", key, {
        query,
        limit: Math.min(5, Math.max(1, limit)),
        sources: [{ type: "web" }],
        safe: true,
        timeout: 45_000,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      });
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
      const key = env("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY is not configured.");
      const model = env("OPENAI_MODEL") ?? "gpt-5.4-mini";
      const payload = await postJson("https://api.openai.com/v1/responses", key, {
        model,
        instructions:
          "Analyze only the supplied source records. Every factual claim must cite one or more supplied source IDs. Put uncertainty and missing evidence in limitations. Do not invent IDs or facts.",
        input: JSON.stringify({ objective, sources }),
        text: {
          format: {
            type: "json_schema",
            name: "reaper_analysis",
            strict: true,
            schema: {
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
                    properties: {
                      text: { type: "string" },
                      sourceIds: { type: "array", items: { type: "string" } },
                    },
                  },
                },
                limitations: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      });
      const parsed = JSON.parse(responseOutputText(payload)) as ProviderAnalysis;
      const claimsValid = Array.isArray(parsed?.claims) && parsed.claims.every((claim) =>
        claim && typeof claim.text === "string" && Array.isArray(claim.sourceIds) && claim.sourceIds.every((id) => typeof id === "string"));
      if (!parsed || typeof parsed.summary !== "string" || !claimsValid || !Array.isArray(parsed.limitations)
        || !parsed.limitations.every((item) => typeof item === "string")) {
        throw new Error("OpenAI returned malformed structured analysis.");
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
