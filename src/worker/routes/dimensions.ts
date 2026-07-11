import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";
import { FORMULA_LIBRARY, getFormulaDefinition } from "../../shared/formulas";

export const dimensionsRoute = new Hono<{ Bindings: Env }>();

/**
 * Suggests dimension values (and, in accurate mode, the formula itself) by
 * reading the uploaded drawing image — Section 4.4.2. This is ALWAYS a
 * suggestion: the frontend must pre-fill an editable form and require
 * explicit user confirmation before the entry is submitted. Never wire
 * this to auto-submit.
 *
 * ?mode=free (default): Cloudflare Workers AI vision model, no extra
 * vendor integration, included in the 10,000 free Neurons/day. Reads
 * dimensions for a formula the user has already picked — asking a small
 * vision model to also choose from a 14-formula library is a much harder
 * reasoning task better reserved for the paid tier.
 * ?mode=accurate: Claude API vision (opt-in, small per-image cost) — also
 * suggests which RUMUS best fits the drawing when the caller doesn't pin
 * one down, and falls back to counting grid/tile squares when no numeric
 * dimension callouts are visible at all (e.g. a plain tile floor plan with
 * a highlighted area but no printed measurements).
 */
dimensionsRoute.post("/sessions/:sessionId/suggest-dimensions", async (c) => {
  const mode = c.req.query("mode") === "accurate" ? "accurate" : "free";
  const body = await c.req.json<{ imageR2Key: string; formulaRumus?: string; workItemDescription?: string }>();

  const imageObject = await c.env.FILES.get(body.imageR2Key);
  if (!imageObject) return c.json({ error: "Image not found" }, 404);
  const imageBuffer = await imageObject.arrayBuffer();
  const contentType = imageObject.httpMetadata?.contentType ?? "image/png";
  const base64 = arrayBufferToBase64(imageBuffer);

  if (mode === "free") {
    // Unchanged: dimensions only, for a formula the user has already picked.
    if (!body.formulaRumus) return c.json({ error: "Free mode requires a formula to already be selected" }, 400);
    const def = getFormulaDefinition(body.formulaRumus);
    if (!def) return c.json({ error: `Unknown formula: ${body.formulaRumus}` }, 400);

    const instruction = `This is a crop from an architectural or structural drawing. Read the dimension callouts (the numbers with extension/dimension lines) and identify the values for: ${def.fields.join(", ")}. Dimensions on the drawing are typically in millimeters — convert to meters (divide by 1000) for panjang/lebar/tinggi. Reply with ONLY a JSON object with exactly these keys: ${JSON.stringify(def.fields)}. Use null for any field you can't confidently read.`;

    const result: any = await c.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
      image: Array.from(new Uint8Array(imageBuffer)),
      prompt: instruction,
      max_tokens: 512,
    });
    const suggestion = extractJson(result.description ?? result.response ?? "");
    normalizePanjangLebar(suggestion);
    return c.json({ mode, suggestion, fields: def.fields });
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: "High-accuracy mode requires ANTHROPIC_API_KEY to be configured" }, 400);
  }
  const requestedDef = body.formulaRumus ? getFormulaDefinition(body.formulaRumus) : undefined;
  if (body.formulaRumus && !requestedDef) return c.json({ error: `Unknown formula: ${body.formulaRumus}` }, 400);

  const workItemContext = body.workItemDescription
    ? `\n\nThe work item this drawing is for: "${body.workItemDescription}". If a module/tile size is stated there (e.g. "60/60" means 0.6m x 0.6m tiles, "80/80" means 0.8m x 0.8m), use it to convert a grid-square count into a real measurement instead of leaving it as a bare square count.`
    : "";
  const targetRegionGuidance = `\n\nThis crop may show more than one room or design element. If any region has a solid color fill (e.g. red, pink, orange) that contrasts with the rest of the drawing (which is normally just white/outlined), that fill marks the specific work item's target area — read or count dimensions for THAT region, not other outlined-only shapes, room labels, or fixtures shown elsewhere in the same crop.

Numeric dimension callouts strongly take priority over grid counting whenever they exist — only fall back to counting grid/tile squares if truly no usable dimension line can be found for the target region. When reading dimension callouts, a drawing usually has more than one number printed near the target region — distinguish between them:
- The OVERALL dimension lines are full extension lines that run along an entire outer edge of the highlighted/target region, typically with arrowheads or tick marks at both ends and positioned just outside the shape (e.g. along its top edge and its side edge). These give the overall panjang and lebar.
- Small numbers near a circled tag, door-swing arc, or fixture symbol INSIDE the region (e.g. a 2-3 digit label next to a door or equipment mark) are local annotations for that fixture, NOT the overall dimension — ignore these when determining panjang/lebar.
By convention, "panjang" is the larger of the two overall dimensions and "lebar" the smaller one, regardless of which is drawn horizontally or vertically on the page.

Dimension text running along a vertical/side extension line is usually rotated 90 degrees on the page, which makes individual digits genuinely harder to read correctly than horizontal text — slow down and read it digit by digit rather than skimming, and double-check your reading before answering. Before finalizing, sanity-check both values:
1. Digit count — dimension callouts on this type of drawing are normally 3-4 digit millimeter values (e.g. 1853, 3391, 6140). If one value you read has noticeably fewer digits than the other overall dimension (e.g. one reads as 4 digits like "1853" and the other as only 1-2 digits like "34"), you almost certainly cut off digits from a rotated number — look again at the full extension line before answering, expecting another 3-4 digit value.
2. Proportion — compare the ratio of your two values against how the highlighted region actually looks in the image (clearly taller than wide, wider than tall, or roughly square). If your numbers imply a drastically different shape than what the region visually looks like, you likely misread one of them — re-examine it.
If, even after re-checking, you still cannot confidently read a digit, return null for that field rather than forcing a guess — a blank field is safer than a wrong number, since every suggestion is reviewed manually before use.`;

  const instruction = requestedDef
    ? `This is a crop from an architectural or structural drawing, for a work item already using the "${requestedDef.rumus}" formula (${requestedDef.label}). Read the dimension callouts (numbers with extension/dimension lines) for: ${requestedDef.fields.join(", ")}. Dimensions are typically in millimeters — convert to meters (divide by 1000) for panjang/lebar/tinggi.${targetRegionGuidance}

If NO numeric dimension callouts are visible at all, but the drawing shows a grid or tile pattern (e.g. floor tiles, ceiling grid) with a specific area highlighted, outlined, or colored, COUNT how many whole grid squares that area spans along each axis instead — state the counts and note that a per-square size still needs to be confirmed manually if none is printed on the drawing.${workItemContext}

Reply with ONLY a JSON object with exactly these keys:
{
  "dimensions": { ${requestedDef.fields.map((f) => `"${f}": <number or null>`).join(", ")} },
  "method": "dimension_callout" | "grid_count" | "unknown",
  "note": "<one short sentence — especially explain if you used grid counting, or why a field is null>"
}`
    : `This is a crop from an architectural or structural drawing, matched to a construction work item that needs a Volume Bagian (sub-volume) formula and its dimensions identified.${targetRegionGuidance}

First, decide which formula from this library best fits the shape of that target area:
${FORMULA_LIBRARY.map((f) => `- "${f.rumus}": ${f.label} (needs: ${f.fields.join(", ")})`).join("\n")}

Then read the dimension callouts (numbers with extension/dimension lines) for that formula's fields. Dimensions are typically in millimeters — convert to meters (divide by 1000) for panjang/lebar/tinggi.

If NO numeric dimension callouts are visible at all, but the drawing shows a grid or tile pattern (e.g. floor tiles, ceiling grid) with a specific area highlighted, outlined, or colored, COUNT how many whole grid squares that area spans along each axis instead of giving up — state the counts in the note and note that a per-square size still needs confirming manually if none is printed on the drawing.${workItemContext}

Reply with ONLY a JSON object with exactly these keys:
{
  "rumus": "<one of the exact formula strings above>",
  "dimensions": { <that formula's fields, each a number or null> },
  "method": "dimension_callout" | "grid_count" | "unknown",
  "note": "<one short sentence — especially explain if you used grid counting, or why you couldn't determine something confidently>"
}`;

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: contentType as any, data: base64 } },
          { type: "text", text: instruction },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  const parsed =
    textBlock && textBlock.type === "text"
      ? extractJson(textBlock.text)
      : {};

  const suggestedRumus: string | undefined = typeof parsed.rumus === "string" ? parsed.rumus : undefined;
  const resolvedDef = requestedDef ?? (suggestedRumus ? getFormulaDefinition(suggestedRumus) : undefined);

  const dimensions = (parsed.dimensions as Record<string, number | null>) ?? {};
  normalizePanjangLebar(dimensions);

  return c.json({
    mode,
    suggestion: dimensions,
    fields: resolvedDef?.fields ?? [],
    suggestedFormula: requestedDef ? undefined : resolvedDef?.rumus ?? null,
    method: typeof parsed.method === "string" ? parsed.method : "unknown",
    note: typeof parsed.note === "string" ? parsed.note : undefined,
  });
});

/**
 * The vision model reliably reads the two overall edge values correctly but
 * inconsistently applies the "panjang = larger value" convention itself —
 * observed swapping panjang/lebar even while its own note describes the
 * correct order. Every formula in FORMULA_LIBRARY that uses both fields
 * (P×L, P+L, etc.) is symmetric in panjang/lebar, so enforcing the
 * convention here is a safe, deterministic fix rather than another prompt
 * tweak asking the model to compare two numbers correctly.
 */
function normalizePanjangLebar(dims: Record<string, number | null>): void {
  if (typeof dims.panjang === "number" && typeof dims.lebar === "number" && dims.panjang < dims.lebar) {
    [dims.panjang, dims.lebar] = [dims.lebar, dims.panjang];
  }
}

function extractJson(text: string): Record<string, any> {
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
