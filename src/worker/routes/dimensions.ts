import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";
import { getFormulaDefinition } from "../../shared/formulas";

export const dimensionsRoute = new Hono<{ Bindings: Env }>();

/**
 * Suggests dimension values by reading the uploaded drawing image —
 * Section 4.4.2. This is ALWAYS a suggestion: the frontend must pre-fill
 * an editable form and require explicit user confirmation before the
 * entry is submitted. Never wire this to auto-submit.
 *
 * ?mode=free (default): Cloudflare Workers AI vision model, no extra
 * vendor integration, included in the 10,000 free Neurons/day. Expect
 * lower accuracy on rotated dimension text or dense drawings.
 * ?mode=accurate: Claude API vision (opt-in, small per-image cost) —
 * verified during this project's own analysis to correctly read mm
 * dimension callouts off a real blueprint crop.
 */
dimensionsRoute.post("/sessions/:sessionId/suggest-dimensions", async (c) => {
  const mode = c.req.query("mode") === "accurate" ? "accurate" : "free";
  const body = await c.req.json<{ imageR2Key: string; formulaRumus: string }>();

  const def = getFormulaDefinition(body.formulaRumus);
  if (!def) return c.json({ error: `Unknown formula: ${body.formulaRumus}` }, 400);

  const imageObject = await c.env.FILES.get(body.imageR2Key);
  if (!imageObject) return c.json({ error: "Image not found" }, 404);
  const imageBuffer = await imageObject.arrayBuffer();
  const contentType = imageObject.httpMetadata?.contentType ?? "image/png";

  const instruction = `This is a crop from an architectural or structural drawing. Read the dimension callouts (the numbers with extension/dimension lines) and identify the values for: ${def.fields.join(", ")}. Dimensions on the drawing are typically in millimeters — convert to meters (divide by 1000) for panjang/lebar/tinggi. Reply with ONLY a JSON object with exactly these keys: ${JSON.stringify(def.fields)}. Use null for any field you can't confidently read.`;

  let suggestion: Record<string, number | null> = {};

  if (mode === "accurate") {
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json({ error: "High-accuracy mode requires ANTHROPIC_API_KEY to be configured" }, 400);
    }
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
    const base64 = arrayBufferToBase64(imageBuffer);
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: contentType as any, data: base64 },
            },
            { type: "text", text: instruction },
          ],
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text") {
      suggestion = extractJson(textBlock.text);
    }
  } else {
    const base64 = arrayBufferToBase64(imageBuffer);
    // Model name per Cloudflare Workers AI's vision catalog — verify against
    // the current catalog at build time; swap here if it's been superseded.
    const result: any = await c.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
      image: Array.from(new Uint8Array(imageBuffer)),
      prompt: instruction,
      max_tokens: 512,
    });
    suggestion = extractJson(result.description ?? result.response ?? "");
  }

  return c.json({ mode, suggestion, fields: def.fields });
});

function extractJson(text: string): Record<string, number | null> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
