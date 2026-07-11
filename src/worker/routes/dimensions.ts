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
 * a highlighted area but no printed measurements). A single vision pass on
 * rotated/small dimension text isn't reliable enough alone — the same
 * drawing has come back correct, with a dropped digit, or confusing a
 * small nearby fixture label for the real dimension, from one call to the
 * next (confirmed by direct testing — see git history for image rotation
 * and upscaling experiments that did NOT help and were reverted). This
 * takes 2-5 independent readings (only escalating past 2 when they
 * disagree) and only keeps a value once at least two of them agree,
 * preferring readings whose own digit-transcription looks self-consistent;
 * see reconcile() below.
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
  // Kept deliberately short: an earlier, much longer version of this
  // paragraph (spelling out how to tell overall dimension lines apart from
  // small fixture annotations, plus a multi-step digit/proportion
  // self-check) measurably made readings *less* reliable, not more —
  // likely because a single-shot JSON completion doesn't actually "think
  // through" prose instructions before the numeric fields, it just
  // generates them. This one sentence stays because repeated direct
  // testing on a real drawing confirmed this exact confusion (reading a
  // 3-digit fixture/door-swing label instead of the real 4-digit overall
  // dimension) as the dominant failure mode — it's evidence-based, not
  // speculative. The real accuracy backstop is reconcile() below: a digit-
  // count mismatch in the "reading" field is detected in code and that
  // reading is deprioritized rather than trusted at face value.
  const targetRegionGuidance = `\n\nThis crop may show more than one room or design element. If any region has a solid color fill (e.g. red, pink, orange) that contrasts with the rest of the drawing (which is normally just white/outlined), that fill marks the specific work item's target area — read or count dimensions for THAT region, not other outlined-only shapes, room labels, or fixtures shown elsewhere in the same crop. A short 2-3 digit label next to a door-swing arc or fixture symbol is a local fixture annotation, not the overall dimension — the real overall dimension is a separate, longer number on the full extension line spanning that edge.`;

  const instruction = requestedDef
    ? `This is a crop from an architectural or structural drawing, for a work item already using the "${requestedDef.rumus}" formula (${requestedDef.label}). Read the dimension callouts (numbers with extension/dimension lines) for: ${requestedDef.fields.join(", ")}. Dimensions are typically in millimeters — convert to meters (divide by 1000) for panjang/lebar/tinggi.${targetRegionGuidance}

If NO numeric dimension callouts are visible at all, but the drawing shows a grid or tile pattern (e.g. floor tiles, ceiling grid) with a specific area highlighted, outlined, or colored, COUNT how many whole grid squares that area spans along each axis instead — state the counts and note that a per-square size still needs to be confirmed manually if none is printed on the drawing.${workItemContext}

Reply with ONLY a JSON object with exactly these keys, in this exact order:
{
  "reading": "<transcribe the raw millimeter number printed on each overall dimension line exactly as printed, digit by digit, before any unit conversion — e.g. \\"top: 1853, right: 3391\\">",
  "dimensions": { ${requestedDef.fields.map((f) => `"${f}": <number or null>`).join(", ")} },
  "method": "dimension_callout" | "grid_count" | "unknown",
  "note": "<one short sentence — especially explain if you used grid counting, or why a field is null>"
}`
    : `This is a crop from an architectural or structural drawing, matched to a construction work item that needs a Volume Bagian (sub-volume) formula and its dimensions identified.${targetRegionGuidance}

First, decide which formula from this library best fits the shape of that target area:
${FORMULA_LIBRARY.map((f) => `- "${f.rumus}": ${f.label} (needs: ${f.fields.join(", ")})`).join("\n")}

Then read the dimension callouts (numbers with extension/dimension lines) for that formula's fields. Dimensions are typically in millimeters — convert to meters (divide by 1000) for panjang/lebar/tinggi.

If NO numeric dimension callouts are visible at all, but the drawing shows a grid or tile pattern (e.g. floor tiles, ceiling grid) with a specific area highlighted, outlined, or colored, COUNT how many whole grid squares that area spans along each axis instead of giving up — state the counts in the note and note that a per-square size still needs confirming manually if none is printed on the drawing.${workItemContext}

Reply with ONLY a JSON object with exactly these keys, in this exact order:
{
  "rumus": "<one of the exact formula strings above>",
  "reading": "<transcribe the raw millimeter number printed on each overall dimension line exactly as printed, digit by digit, before any unit conversion — e.g. \\"top: 1853, right: 3391\\">",
  "dimensions": { <that formula's fields, each a number or null> },
  "method": "dimension_callout" | "grid_count" | "unknown",
  "note": "<one short sentence — especially explain if you used grid counting, or why you couldn't determine something confidently>"
}`;

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  const readings: DimensionReading[] = await Promise.all([
    readDimensionsOnce(client, base64, contentType, instruction),
    readDimensionsOnce(client, base64, contentType, instruction),
  ]);

  const resolve = (rs: DimensionReading[]) => {
    const rumus = requestedDef?.rumus ?? majorityRumus(rs);
    const def = requestedDef ?? (rumus ? getFormulaDefinition(rumus) : undefined);
    const fields = def?.fields ?? [];
    const { dimensions, conflicts } = reconcile(fields, rs);
    const rumusSettled = requestedDef ? true : rs.every((r) => r.rumus === rumus);
    return { rumus, def, fields, dimensions, conflicts, rumusSettled };
  };

  // Readings disagreed — keep taking one more independent look at a time,
  // up to this ceiling, stopping as soon as every field/the formula reaches
  // 2-way agreement. Each extra attempt is a real cost/latency trade-off,
  // but this is the opt-in paid "high-accuracy" tier and a wrong dimension
  // silently baked into an exported workbook is far more expensive than a
  // few more cents of API calls.
  const MAX_READINGS = 5;
  let resolved = resolve(readings);
  while ((resolved.conflicts.length > 0 || !resolved.rumusSettled) && readings.length < MAX_READINGS) {
    readings.push(await readDimensionsOnce(client, base64, contentType, instruction));
    resolved = resolve(readings);
  }

  const methodCounts = new Map<string, number>();
  for (const r of readings) methodCounts.set(r.method, (methodCounts.get(r.method) ?? 0) + 1);
  const method = [...methodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  const note =
    resolved.conflicts.length > 0
      ? `Repeated readings disagreed on ${resolved.conflicts.join(", ")} — left blank rather than guessing; please measure and enter manually.`
      : readings.find((r) => r.note)?.note;

  return c.json({
    mode,
    suggestion: resolved.dimensions,
    fields: resolved.fields,
    suggestedFormula: requestedDef ? undefined : resolved.rumus ?? null,
    method,
    note,
  });
});

interface DimensionReading {
  rumus?: string;
  dimensions: Record<string, number | null>;
  method: string;
  note?: string;
  /** Whether this reading's own "reading" transcription looks internally
   * consistent (same digit count across the overall-dimension numbers it
   * transcribed) — see isDigitCountSuspicious(). */
  trustworthy: boolean;
}

async function readDimensionsOnce(
  client: Anthropic,
  base64: string,
  contentType: string,
  instruction: string,
): Promise<DimensionReading> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 800,
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
  const parsed = textBlock && textBlock.type === "text" ? extractJson(textBlock.text) : {};
  const dimensions = (parsed.dimensions as Record<string, number | null>) ?? {};
  normalizePanjangLebar(dimensions);
  const reading = typeof parsed.reading === "string" ? parsed.reading : undefined;
  const method = typeof parsed.method === "string" ? parsed.method : "unknown";
  const note = typeof parsed.note === "string" ? parsed.note : undefined;
  return {
    rumus: typeof parsed.rumus === "string" ? parsed.rumus : undefined,
    dimensions,
    method,
    note,
    trustworthy: !isDigitCountSuspicious(reading) && !isUnfoundMirrorGuess(dimensions) && !hasHedgingLanguage(note),
  };
}

/**
 * Third failure mode observed directly: the model sometimes hedges heavily
 * in its own note ("not clearly marked", "cannot be reliably determined",
 * "needs to be confirmed") while still returning a guessed number for the
 * field it just disclaimed — e.g. defaulting lebar to exactly one tile
 * module (0.6m) "suggested" by a grid count it says is inconclusive. That
 * self-contradiction — hedge in prose, confident number in the JSON — is
 * treated as untrustworthy for the same reason as the other two checks:
 * the model's own words are a more reliable signal here than its numbers.
 */
const HEDGE_PATTERNS = [
  /cannot be (?:reliably |confidently )?(?:determined|extracted|confirmed|read)/i,
  /not (?:clearly |explicitly )?(?:marked|labeled|labelled|dimensioned|visible|legible)/i,
  /needs? (?:to be )?confirm/i,
  /requires? (?:the )?full drawing/i,
  /not clear from/i,
];

function hasHedgingLanguage(note: string | undefined): boolean {
  if (!note) return false;
  return HEDGE_PATTERNS.some((re) => re.test(note));
}

/**
 * Direct testing against a real drawing showed the dominant failure mode
 * isn't random noise — it's the model confidently, repeatably transcribing
 * a short local fixture/door-swing label (e.g. "343") instead of the real
 * overall dimension (e.g. "3391") for the rotated edge. The two overall
 * dimensions on this drawing style are consistently the same digit count
 * (both 3-4 digits); a reading whose two transcribed numbers have visibly
 * different digit counts is very likely this exact mix-up, so it's flagged
 * here in code rather than trusted on the model's own say-so — the earlier
 * prompt-only version of this check didn't change the model's output
 * because by the time it writes a self-check into "note", the "dimensions"
 * values are already committed earlier in the same response.
 */
function isDigitCountSuspicious(reading: string | undefined): boolean {
  if (!reading) return false;
  const tokens = reading.match(/\d{2,6}/g);
  if (!tokens || tokens.length < 2) return false;
  const lengths = tokens.map((t) => t.length);
  return Math.max(...lengths) - Math.min(...lengths) >= 1;
}

/**
 * Also observed directly: when the model can't actually find a second
 * dimension line, it sometimes guesses by mirroring panjang into lebar
 * (assuming a square) rather than returning null — and if two independent
 * calls both fall back to that same guess, they'll "agree" and slip past
 * reconcile()'s vote even though neither call actually read a real value.
 * An initial version of this check exempted method === "grid_count" on the
 * theory that a real N×N tile count could legitimately be square — but
 * direct testing showed the model will label the exact same mirror-guess
 * "grid_count" to describe it, so that exemption was actively letting the
 * wrong answer through and has been removed: any panjang-equals-lebar
 * reading is treated as suspicious regardless of stated method.
 */
function isUnfoundMirrorGuess(dims: Record<string, number | null>): boolean {
  return (
    typeof dims.panjang === "number" && typeof dims.lebar === "number" && roundMm(dims.panjang) === roundMm(dims.lebar)
  );
}

const roundMm = (v: number) => Math.round(v * 1000);

/**
 * Only accept a field's value once at least 2 *trustworthy* readings agree
 * at millimeter precision — readings flagged untrustworthy (digit-count
 * mismatch, or an unfound-dimension mirror guess) are excluded from the
 * vote entirely, not just deprioritized. An earlier version fell back to
 * voting across all readings whenever fewer than 2 trustworthy ones were
 * available; direct testing showed that loophole let two independent
 * mirror-guesses "agree" with each other and win the vote despite each
 * being individually flagged as suspect. A field with no trustworthy
 * agreement comes back null (with the caller surfacing a note) instead of
 * silently picking one of the disagreeing/suspect guesses — consistent
 * with this feature always being a reviewable suggestion, never an
 * auto-filled fact.
 */
function reconcile(
  fields: string[],
  readings: DimensionReading[],
): { dimensions: Record<string, number | null>; conflicts: string[] } {
  const pool = readings.filter((r) => r.trustworthy);

  const dimensions: Record<string, number | null> = {};
  const conflicts: string[] = [];
  for (const field of fields) {
    const values = pool.map((r) => r.dimensions[field]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) {
      // No trustworthy reading has produced a number for this field yet —
      // keep this an open conflict (rather than a settled null) so the
      // caller's retry loop keeps trying up to its ceiling instead of
      // giving up the moment the first attempt or two comes up empty.
      dimensions[field] = null;
      conflicts.push(field);
      continue;
    }
    const counts = new Map<number, { value: number; count: number }>();
    for (const v of values) {
      const key = roundMm(v);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { value: v, count: 1 });
    }
    const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    if (winner.count >= 2) {
      dimensions[field] = winner.value;
    } else {
      dimensions[field] = null;
      conflicts.push(field);
    }
  }
  return { dimensions, conflicts };
}

function majorityRumus(readings: DimensionReading[]): string | undefined {
  const counts = new Map<string, number>();
  for (const r of readings) {
    if (!r.rumus) continue;
    counts.set(r.rumus, (counts.get(r.rumus) ?? 0) + 1);
  }
  let best: [string, number] | undefined;
  for (const entry of counts) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best?.[0];
}

/**
 * The vision model reliably reads the two overall edge values correctly but
 * inconsistently applies the "panjang = larger value" convention itself —
 * observed swapping panjang/lebar even while its own note describes the
 * correct order. Every formula in FORMULA_LIBRARY that uses both fields
 * (P×L, P+L, etc.) is symmetric in panjang/lebar, so enforcing the
 * convention here is a safe, deterministic fix rather than another prompt
 * tweak asking the model to compare two numbers correctly. Applying this
 * per-reading (before cross-reading comparison) also means a call that
 * swapped the fields still agrees with one that didn't.
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
