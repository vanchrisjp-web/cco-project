import { getDocumentProxy, extractText } from "unpdf";
import Anthropic from "@anthropic-ai/sdk";

export interface ParsedWorkItem {
  path: string; // full breadcrumb, e.g. "V.1 PEKERJAAN LANTAI > 2. Pasang Lantai Keramik ... (R. Locker)"
  description: string;
  unit: string | null;
  sourceCategory: string | null;
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
 * matching on the structural markers catalogued from a real BQ PDF
 * (Section 4.3): Roman-numeral categories, decimal sub-headers, numbered
 * OR dash-bulleted items, item numbers that reset per section.
 *
 * This deliberately does not try to be perfect — it's the free first pass
 * that handles the well-behaved majority. Ambiguous cases (descriptive
 * sub-lines with no volume, ranges of ' - ' bullets that are really
 * components of the item above, multi-line descriptions) are exactly what
 * the Tier 3 fallback below is for.
 */
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
      // row's trailing VOL/SAT/HARGA figures ride along on the same line as
      // the description (e.g. "... (R. Locker) 6.14 6.14 m2 357,500
      // 2,195,050"). Trim from the first run of "number number unit" onward
      // — best-effort only; Tier 3 (Claude API, table-aware) is the
      // accuracy fallback for BQs where this trim misfires.
      const description = rawDescription
        .replace(/\s+[\d.,]+\s+[\d.,]+\s+[a-zA-Z0-9']{1,4}\s+[\d.,]+.*$/, "")
        .trim();

      const breadcrumbParts = [currentCategory, currentSubcategory].filter(Boolean);
      const label = numMatch ? `${numMatch[1]}. ${description}` : description;
      items.push({
        path: [...breadcrumbParts, label].join(" > "),
        description,
        unit: null, // Tier 1 does not attempt column-aware SAT extraction — see module doc
        sourceCategory: currentCategory,
      });
    }
  }

  return items;
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
): Promise<ParsedWorkItem[]> {
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
            text: `This is a construction Bill of Quantity (BQ) document. Extract every real work item (a priced or plannable line item — not a category header, not a subtotal "JUMLAH" row, not a descriptive sub-line with no volume/unit of its own, not the explanatory paragraph text that sometimes precedes a section).

For each work item return:
- path: the full hierarchical breadcrumb, e.g. "V.1 PEKERJAAN LANTAI > 2. Pasang Lantai Keramik ... (R. Locker)" — item numbers reset per section, so always include the section path, not just the bare number.
- description: the item's own text, without the leading number.
- unit: the "SAT" unit of measure if shown (e.g. m2, m3, kg, unit, titik, ls), or null if not numeric/not shown (e.g. "by owner").
- sourceCategory: the top-level Roman-numeral category this item belongs to.

Return ONLY a JSON array of objects with exactly these four keys: path, description, unit, sourceCategory.`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  return JSON.parse(jsonMatch[0]) as ParsedWorkItem[];
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
