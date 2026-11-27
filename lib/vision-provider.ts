import Anthropic from "@anthropic-ai/sdk";

/**
 * Which AI looks at the pictures, swappable by setting (owner, 2026-11-27: "change the vision model based on pricing
 * and features from different companies"). Every provider gets the same prompt and pictures and must return the same
 * JSON, which Farm Vision checks with one schema, so switching changes cost and quality, never the screens.
 *
 *   VISION_PROVIDER   anthropic | openrouter | openai   (default: the first of these whose key is set:
 *                     ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY)
 *   VISION_MODEL      the model for routine checks (default: claude-haiku-5-5; on OpenRouter anthropic/claude-haiku-5.5,
 *                     any OpenRouter model id with vision works; on OpenAI gpt-5.6-luna)
 *   VISION_EFFORT     low | medium | high    (Claude and OpenRouter; default low: farm pictures need little reasoning)
 *   VISION_ESCALATE_MODEL   optional, same provider: a stronger model that re-checks only pictures the first model
 *                           flagged (high, urgent or escalate). Off unless set.
 *   VISION_PRICES     optional JSON {"model": [input $ per million tokens, output $ per million tokens]} to add or
 *                     correct prices; used only to record cost.
 */

export type VisionImage = { mimeType: string; base64: string };
export type VisionCall = { instructions: string; prompt: string; images: VisionImage[]; model?: string };
export type VisionUsage = { provider: string; model: string; inputTokens: number; outputTokens: number; costMicros: number | null };
export type VisionReply = { ok: true; text: string; usage: VisionUsage } | { ok: false; status: number; error: string; usage?: VisionUsage };

type Provider = "anthropic" | "openrouter" | "openai";

/** List prices, US dollars per million tokens (input, output). Correct or extend with VISION_PRICES. */
const DEFAULT_PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.10, 0.50],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

export function visionProvider(): Provider | null {
  const chosen = process.env.VISION_PROVIDER?.trim().toLowerCase();
  if (chosen === "anthropic" || chosen === "openrouter" || chosen === "openai") return chosen;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

export function visionModel(provider = visionProvider()): string {
  const set = process.env.VISION_MODEL?.trim();
  // A model name from the other company (for example an old VISION_MODEL="gpt-..." left in .env after switching to
  // Claude) is ignored, so a provider switch never sends a request the provider cannot answer.
  // OpenRouter ids name the company first ("anthropic/claude-haiku-5.5"); Anthropic ids start with "claude-".
  const fits = (name: string) => provider === "openrouter" ? name.includes("/") : provider === "anthropic" ? name.startsWith("claude-") : !name.startsWith("claude-") && !name.includes("/");
  if (set && fits(set)) return set;
  return provider === "openai" ? "gpt-5.6-luna" : provider === "openrouter" ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5";
}

export function visionEscalateModel(): string | null {
  return process.env.VISION_ESCALATE_MODEL?.trim() || null;
}

/** Is the chosen provider's key present? (Said as a fact; the key itself is never shown.) */
export function visionConfigured() {
  const provider = visionProvider();
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

export function priceFor(model: string): [number, number] | null {
  let extra: Record<string, unknown> = {};
  try { extra = JSON.parse(process.env.VISION_PRICES ?? "{}"); } catch { /* ignore a bad value */ }
  const custom = extra[model];
  if (Array.isArray(custom) && custom.length === 2 && custom.every((n) => typeof n === "number" && n >= 0)) return custom as [number, number];
  // An OpenRouter Claude id ("anthropic/claude-haiku-5.5") is priced like the Anthropic one ("claude-haiku-5-5").
  const plain = model.startsWith("anthropic/") ? model.slice("anthropic/".length).replaceAll(".", "-") : model;
  return DEFAULT_PRICES[plain] ?? null;
}

/** Cost in millionths of a dollar, or null when the price is unknown. */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = priceFor(model);
  return price ? Math.round(inputTokens * price[0] + outputTokens * price[1]) : null;
}

const usageOf = (provider: Provider, model: string, inputTokens: number, outputTokens: number): VisionUsage =>
  ({ provider, model, inputTokens, outputTokens, costMicros: costMicros(model, inputTokens, outputTokens) });

let client: Anthropic | null = null;

async function callClaude(call: VisionCall, model: string): Promise<VisionReply> {
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const effort = ["low", "medium", "high"].includes(process.env.VISION_EFFORT ?? "") ? process.env.VISION_EFFORT as "low" | "medium" | "high" : "low";
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: call.instructions,
      output_config: { effort },
      messages: [{
        role: "user",
        content: [
          ...call.images.map((image) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: image.base64 },
          })),
          { type: "text" as const, text: call.prompt },
        ],
      }],
    });
    const usage = usageOf("anthropic", model, response.usage.input_tokens, response.usage.output_tokens);
    if (response.stop_reason === "refusal") return { ok: false, status: 502, error: "The vision service declined this picture.", usage };
    if (response.stop_reason === "max_tokens") return { ok: false, status: 502, error: "The vision answer was cut short.", usage };
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    return { ok: true, text, usage };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: "The vision service is busy. Try again shortly." };
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, status: 503, error: "The vision service key was refused. Check ANTHROPIC_API_KEY." };
    if (error instanceof Anthropic.BadRequestError) return { ok: false, status: 502, error: "The vision service could not read this request." };
    if (error instanceof Anthropic.APIError) return { ok: false, status: 502, error: "The vision service could not analyze this image." };
    return { ok: false, status: 502, error: "The vision service could not be reached." };
  }
}

async function callOpenAI(call: VisionCall, model: string): Promise<VisionReply> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(35_000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, store: false, instructions: call.instructions, max_output_tokens: 1400,
      input: [{ role: "user", content: [{ type: "input_text", text: call.prompt },
        ...call.images.map((image) => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.base64}` }))] }],
    }),
  }).catch(() => null);
  if (!response?.ok) return { ok: false, status: 502, error: "The vision service could not analyze this image." };
  const ai = await response.json() as { output_text?: string; usage?: { input_tokens?: number; output_tokens?: number }; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  const text = ai.output_text || ai.output?.filter((item) => item.type === "message").flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n") || "";
  return { ok: true, text, usage: usageOf("openai", model, ai.usage?.input_tokens ?? 0, ai.usage?.output_tokens ?? 0) };
}

async function callOpenRouter(call: VisionCall, model: string): Promise<VisionReply> {
  const effort = ["low", "medium", "high"].includes(process.env.VISION_EFFORT ?? "") ? process.env.VISION_EFFORT : "low";
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://flockence.com", "X-Title": "Flockence Farm Vision",
      },
      body: JSON.stringify({
        model, max_tokens: 8000, reasoning: { effort },
        messages: [
          { role: "system", content: call.instructions },
          { role: "user", content: [
            ...call.images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })),
            { type: "text", text: call.prompt },
          ] },
        ],
      }),
    });
  } catch {
    return { ok: false, status: 502, error: "The vision service could not be reached." };
  }
  const data = await response.json().catch(() => null) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string | Array<{ type?: string; text?: string }> | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number | null };
  } | null;
  const inputTokens = data?.usage?.prompt_tokens ?? 0, outputTokens = data?.usage?.completion_tokens ?? 0;
  // OpenRouter reports what it charged; use that, else the price list.
  const charged = typeof data?.usage?.cost === "number" && data.usage.cost >= 0 ? Math.round(data.usage.cost * 1_000_000) : null;
  const usage: VisionUsage = { provider: "openrouter", model, inputTokens, outputTokens, costMicros: charged ?? costMicros(model, inputTokens, outputTokens) };
  if (!response.ok) {
    if (response.status === 402) return { ok: false, status: 503, error: "The OpenRouter account is out of credits. Add credits at openrouter.ai/credits.", usage };
    if (response.status === 401) return { ok: false, status: 503, error: "The OpenRouter key was refused. Check OPENROUTER_API_KEY.", usage };
    if (response.status === 429) return { ok: false, status: 429, error: "The vision service is busy. Try again shortly.", usage };
    return { ok: false, status: 502, error: "The vision service could not analyze this image.", usage };
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text ?? "").join("\n") : "";
  if (choice?.finish_reason === "length") return { ok: false, status: 502, error: "The vision answer was cut short.", usage };
  return { ok: true, text, usage };
}

/** Ask the configured vision model. `model` overrides the routine model (used for the optional re-check). */
export async function callVisionModel(call: VisionCall): Promise<VisionReply> {
  const provider = visionProvider();
  if (!provider || !visionConfigured()) {
    return { ok: false, status: 503, error: "Farm Vision is not configured. Add OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY to the server environment." };
  }
  const model = call.model ?? visionModel(provider);
  return provider === "anthropic" ? callClaude(call, model) : provider === "openrouter" ? callOpenRouter(call, model) : callOpenAI(call, model);
}
