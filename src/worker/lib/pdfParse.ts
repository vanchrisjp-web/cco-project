import { getDocumentProxy, extractText } from "unpdf";
import Anthropic from "@anthropic-ai/sdk";

export interface ParsedWorkItem {
  path: string; // full breadcrumb, e.g. "V.1 PEKERJAAN LANTAI > 2. Pasang Lantai Keramik ... (R. Locker)"
  description: string;
  unit: string | null;
  sourceCategory: string | null;
  /** The Breakdown's own "VOL AWAL" column for this item, if present —
   * the contract/existing volume before CCO backup verification, not to
   * be confused with the Volume Terpasang this app later computes. */
  volumeAwal: number | null;
}

const ROMAN_CATEGORY = /^([IVXLCM]+)\.?\s+([A-Z][A-Z0-9 .&/()'-]{2,})\s*$/;
const DECIMAL_SUBCATEGORY = /^([IVXLCM]+\.\d+\.?)\s+(.{2,})$/;
const NUMBERED_ITEM = /^(\d+)\.?\s+(.{3,})$/;
const DASH_ITEM = /^-\s*(.{3,})$/;
const SKIP_LINE =
  /^(No\.?|URAIAN|VOL\.?\s*AWAL|VOL\.?\s*EVALUASI|SAT|HARGA SATUAN|JUMLAH HARGA|JUMLAH|BILL OF QUANTITY|PENGADAAN|REKAPITULASI)\s*$/i;

/**
 * Tier 1 — free, deterministic. Pulls raw text with unpdf (PDF.js compiled
 * for edge runtimes, no native Node deps) and applies rule-based pattern
 * matching on the structural markers catalogued from a real breakdown PDF
 * (Section 4.3): Roman-numeral categories, decimal sub-headers, numbered
 * OR dash-bulleted items, item numbers that reset per section.
 *
 * This deliberately does not try to be perfect — it's the free first pass
 * that handles the well-behaved majority. Ambiguous cases (descriptive
 * sub-lines with no volume, ranges of ' - ' bullets that are really
 * components of the item above, multi-line descriptions) are exactly what
 * the Tier 3 fallback below is for.
 */
/** Numbers in this document style use "." for decimals (e.g. "6.14") and
 * "," as a thousands separator (e.g. "357,500") — strip thousands commas
 * before parsing. Returns null rather than NaN so a bad match degrades to
 * "no volume found" instead of poisoning the value. */
function parseIndoNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function parseWorkItemsDeterministic(
  pdfBuffer: ArrayBuffer
): Promise<ParsedWorkItem[]> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { text } = await extractText(pdf, { mergePages: false });

  const items: ParsedWorkItem[] = [];
  let currentCategory: string | null = null;
  let currentSubcategory: string | null = null;

  for (const pageText of text) {
    const lines = pageText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (SKIP_LINE.test(line)) continue;
      if (/^JUMLAH\b/i.test(line)) continue;

      const catMatch = line.match(ROMAN_CATEGORY);
      if (catMatch) {
        currentCategory = `${catMatch[1]} ${catMatch[2]}`;
        currentSubcategory = null;
        continue;
      }

      const subMatch = line.match(DECIMAL_SUBCATEGORY);
      if (subMatch && subMatch[2].toUpperCase() === subMatch[2]) {
        currentSubcategory = `${subMatch[1]} ${subMatch[2]}`;
        continue;
      }

      const numMatch = line.match(NUMBERED_ITEM);
      const dashMatch = line.match(DASH_ITEM);
      const rawDescription = numMatch?.[2] ?? dashMatch?.[1];
      if (!rawDescription) continue;

      // Skip lines that are clearly just a bare number/price fragment,
      // not a real description (heuristic: needs at least one letter).
      if (!/[a-zA-Z]/.test(rawDescription)) continue;

      // unpdf's plain-text extraction has no column boundaries, so a table
      // row's trailing VOL AWAL/VOL EVALUASI/SAT/HARGA figures ride along
      // on the same line as the description (e.g. "... (R. Locker) 6.14
      // 6.14 m2 357,500 2,195,050"). The first number is VOL AWAL, the
      // second is VOL EVALUASI (not needed here), then SAT — captured
      // instead of just trimmed so both flow into the work item.
      // Best-effort only; Tier 3 (Claude API, table-aware) is the accuracy
      // fallback for breakdowns where this match misfires.
      const columnsMatch = rawDescription.match(
        /^(.*?)\s+([\d.,]+)\s+[\d.,]+\s+([a-zA-Z0-9']{1,4})\s+[\d.,]+.*$/
      );
      const description = (columnsMatch?.[1] ?? rawDescription).trim();
      const volumeAwal = columnsMatch ? parseIndoNumber(columnsMatch[2]) : null;
      const unit = columnsMatch?.[3] ?? null;

      const breadcrumbParts = [currentCategory, currentSubcategory].filter(Boolean);
      const label = numMatch ? `${numMatch[1]}. ${description}` : description;
      items.push({
        path: [...breadcrumbParts, label].join(" > "),
        description,
        unit,
        sourceCategory: currentCategory,
        volumeAwal,
      });
    }
  }

  return items;
}

/** Claude's nested response shape — grouping by category/sub-category so
 * that repeated breadcrumb text is written once per group instead of once
 * per item. A flat "one full path per item" shape (the original design)
 * bloated the response 3-4x on a breakdown with 150+ items, which was
 * blowing the max_tokens budget and getting silently cut off mid-array —
 * the root cause of "0 work items" on the high-accuracy path. */
interface ClaudeCategoryBlock {
  category: string;
  subcategories: {
    subcategory: string | null;
    items: { no: string; description: string; unit: string | null; volumeAwal: number | null }[];
  }[];
}

function flattenClaudeBlocks(blocks: ClaudeCategoryBlock[]): ParsedWorkItem[] {
  const items: ParsedWorkItem[] = [];
  for (const block of blocks) {
    if (!block || !Array.isArray(block.subcategories)) continue;
    for (const sub of block.subcategories) {
      if (!sub || !Array.isArray(sub.items)) continue;
      for (const item of sub.items) {
        if (!item?.description) continue;
        const breadcrumbParts = [block.category, sub.subcategory].filter(Boolean) as string[];
        const label = item.no ? `${item.no}. ${item.description}` : item.description;
        items.push({
          path: [...breadcrumbParts, label].join(" > "),
          description: item.description,
          unit: item.unit ?? null,
          volumeAwal: typeof item.volumeAwal === "number" ? item.volumeAwal : null,
          sourceCategory: block.category ?? null,
        });
      }
    }
  }
  return items;
}

/**
 * Extracts complete top-level JSON objects from a `[ {...}, {...}, ... ]`
 * array's text, even if the array was truncated mid-object — every
 * fully-formed object up to the truncation point is recovered instead of
 * the whole result silently collapsing to zero the moment the closing `]`
 * never arrives (which is exactly what a plain `JSON.parse` on the whole
 * match does: throws, or the regex never matches an unterminated array).
 */
function extractCompleteObjects(text: string): unknown[] {
  const start = text.indexOf("[");
  if (start === -1) return [];

  const results: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          results.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          // Malformed despite balanced braces shouldn't normally happen —
          // skip it rather than let one bad object drop everything else.
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return results;
}

export interface ClaudeParseResult {
  items: ParsedWorkItem[];
  /** True when the response was cut off before the array closed (either
   * Claude's own stop_reason says so, or recovery had to kick in) — the
   * items list may be an undercount, not a confirmed-complete result. */
  truncated: boolean;
}

/**
 * Tier 3 — paid, opt-in "high-accuracy mode". Sends the PDF natively to
 * the Claude API and asks for the same structured extraction, letting the
 * model handle the irregularities a line-based parser can't (numbering
 * resets, descriptive non-work sub-lines, multi-line entries, non-numeric
 * prices). Roughly $0.05-0.10 per document at current Haiku pricing —
 * surface this as an explicit user choice, never a silent default.
 */
export async function parseWorkItemsWithClaude(
  pdfBuffer: ArrayBuffer,
  apiKey: string
): Promise<ClaudeParseResult> {
  const client = new Anthropic({ apiKey });
  const base64 = arrayBufferToBase64(pdfBuffer);

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          {
            type: "text",
            text: `This is a construction Breakdown (Bill of Quantity) document. Extract every real work item (a priced or plannable line item — not a category header, not a subtotal "JUMLAH" row, not a descriptive sub-line with no volume/unit of its own, not the explanatory paragraph text that sometimes precedes a section).

Group hierarchically instead of repeating the section path on every item — this document can have 100+ items and repeating full breadcrumbs blows the response size. Return ONLY compact JSON (no markdown fences, no commentary before or after) matching exactly this shape:

[
  {
    "category": "V PEKERJAAN ARSITEKTUR",
    "subcategories": [
      {
        "subcategory": "V.1 PEKERJAAN LANTAI",
        "items": [
          { "no": "1", "description": "Pasang Lantai Keramik ... (R. Locker)", "unit": "m2", "volumeAwal": 6.14 }
        ]
      }
    ]
  }
]

Rules:
- "category": the top-level Roman-numeral section, e.g. "V PEKERJAAN ARSITEKTUR".
- "subcategory": the decimal sub-header, e.g. "V.1 PEKERJAAN LANTAI", or null if this category has no sub-headers and items sit directly under it.
- "no": the item's own number as printed (resets per section) — just the number, not repeated with a period.
- "description": the item's own text, without the leading number.
- "unit": the "SAT" unit of measure if shown (e.g. m2, m3, kg, unit, titik, ls), or null if not shown/not numeric (e.g. "by owner").
- "volumeAwal": the item's own "VOLUME" or "VOL AWAL" column value (a plain number, e.g. 6.14), or null if blank/not shown. This is the item's existing contract quantity, not a price — don't confuse it with HARGA SATUAN or JUMLAH HARGA columns.
- Keep description text exactly as printed — don't summarize or truncate it.`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  let blocks: ClaudeCategoryBlock[] = [];
  let truncated = response.stop_reason === "max_tokens";
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) blocks = JSON.parse(jsonMatch[0]) as ClaudeCategoryBlock[];
  } catch {
    // Fall through to the truncation-tolerant recovery below.
  }
  if (blocks.length === 0 && text.includes("[")) {
    blocks = extractCompleteObjects(text) as ClaudeCategoryBlock[];
    if (blocks.length > 0) truncated = true;
  }

  return { items: flattenClaudeBlocks(blocks), truncated };
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
