import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";
import { getFormulaDefinition, CROSS_REFERENCE_RUMUS } from "../lib/formulas";

export const qaRoute = new Hono<{ Bindings: Env }>();

interface Finding {
  severity: "error" | "warning";
  entryId: string;
  message: string;
}

/**
 * QA pass before export. Two layers, matching Section 7's functional
 * requirement:
 *  1. Deterministic checks (free, always run) — a required dimension field
 *     left blank for the chosen formula, or two different work items
 *     sharing an identical dimension set (a real "did I look at the wrong
 *     image" risk once a session has many entries).
 *  2. An optional Claude API pass (Haiku 4.5, text-only — cheap) that
 *     reviews the full structured summary for judgment calls a fixed rule
 *     can't make, e.g. a formula/unit combination that doesn't match the
 *     work item's own description.
 */
qaRoute.post("/sessions/:sessionId/qa", async (c) => {
  const sessionId = c.req.param("sessionId");
  const useAi = c.req.query("ai") !== "false";

  const { results: entryRows } = await c.env.DB.prepare(
    `SELECT be.id, be.notasi, wi.description as work_item_description
     FROM backup_entries be JOIN work_items wi ON wi.id = be.work_item_id
     WHERE be.session_id = ? ORDER BY be.sort_order`
  )
    .bind(sessionId)
    .all();

  const { results: componentRows } = await c.env.DB.prepare(
    `SELECT bec.*, ft.rumus as formula_rumus
     FROM backup_entry_components bec
     JOIN formula_templates ft ON ft.id = bec.formula_template_id
     WHERE bec.entry_id IN (SELECT id FROM backup_entries WHERE session_id = ?)
     ORDER BY bec.sort_order`
  )
    .bind(sessionId)
    .all();

  const componentsByEntry = new Map<string, any[]>();
  for (const comp of componentRows as any[]) {
    const list = componentsByEntry.get(comp.entry_id) ?? [];
    list.push(comp);
    componentsByEntry.set(comp.entry_id, list);
  }

  const findings: Finding[] = [];
  const dimensionSignatures = new Map<string, string>(); // signature -> first entryId that used it

  for (const entry of entryRows as any[]) {
    const components = componentsByEntry.get(entry.id) ?? [];
    for (const comp of components) {
      if (comp.formula_rumus === CROSS_REFERENCE_RUMUS) continue;
      const def = getFormulaDefinition(comp.formula_rumus);
      if (!def) continue;

      for (const field of def.fields) {
        if (comp[field] == null) {
          findings.push({
            severity: "error",
            entryId: entry.id,
            message: `"${entry.work_item_description}" uses formula "${comp.formula_rumus}", which needs ${field}, but that field is blank.`,
          });
        }
      }

      const signature = def.fields.map((f) => `${f}=${comp[f]}`).join(",");
      const priorEntryId = dimensionSignatures.get(`${comp.formula_rumus}|${signature}`);
      if (priorEntryId && priorEntryId !== entry.id) {
        findings.push({
          severity: "warning",
          entryId: entry.id,
          message: `"${entry.work_item_description}" has the exact same dimensions and formula as another entry — double check you matched the right image to the right work item.`,
        });
      } else {
        dimensionSignatures.set(`${comp.formula_rumus}|${signature}`, entry.id);
      }
    }
  }

  if (useAi && c.env.ANTHROPIC_API_KEY && entryRows.length > 0) {
    const summary = (entryRows as any[])
      .map((entry) => {
        const components = componentsByEntry.get(entry.id) ?? [];
        const compLines = components
          .map(
            (comp) =>
              `  - ${comp.formula_rumus} | P=${comp.panjang} L=${comp.lebar} T=${comp.tinggi} Berat=${comp.berat} Koef=${comp.koefisien} Unit=${comp.unit} Sat=${comp.sat} sign=${comp.sign} ${comp.ket ? `(${comp.ket})` : ""}`
          )
          .join("\n");
        return `Item: ${entry.work_item_description}\n${compLines}`;
      })
      .join("\n\n");

    try {
      const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: `You are reviewing a backup-volume (BV AWAL) worksheet before it's exported for a construction Contract Change Order. Below is every work item, its formula(s), and entered dimensions. Flag anything that looks like a real mistake: a unit of measure that doesn't match the formula type (e.g. an area formula with Sat="kg"), a dimension that looks implausible for the described item (e.g. a room listed as 300m long), or a formula that doesn't fit what the item description says it is. Do not flag things that are merely unusual but plausible. Reply with a short bullet list of concerns only, or "No concerns found" if there are none.

${summary}`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text" && !/no concerns/i.test(textBlock.text)) {
        findings.push({
          severity: "warning",
          entryId: "",
          message: textBlock.text.trim(),
        });
      }
    } catch (err) {
      // The AI layer is an enhancement, not a requirement — a failure here
      // must not take down the whole QA pass (the deterministic findings
      // above are still valid and useful on their own). Log full detail
      // so `wrangler tail` shows the real cause instead of a bare status.
      const detail =
        err instanceof Anthropic.APIError
          ? `status=${err.status} name=${err.name} message=${err.message}`
          : String(err);
      console.error("QA AI layer failed:", detail);
      findings.push({
        severity: "warning",
        entryId: "",
        message: `AI review step failed (${detail}) — deterministic checks above still ran.`,
      });
    }
  }

  return c.json({ findings, checkedEntries: entryRows.length });
});
