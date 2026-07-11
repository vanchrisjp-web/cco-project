import { Hono } from "hono";
import type { Env } from "../types";
import { generateBvAwalWorkbook, type EntryInput } from "../lib/excelGen";

export const exportRoute = new Hono<{ Bindings: Env }>();

exportRoute.get("/sessions/:sessionId/export", async (c) => {
  const sessionId = c.req.param("sessionId");

  const session = await c.env.DB.prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ name: string }>();
  if (!session) return c.json({ error: "Session not found" }, 404);

  const { results: entryRows } = await c.env.DB.prepare(
    `SELECT be.*, wi.path as work_item_path, wi.description as work_item_description
     FROM backup_entries be JOIN work_items wi ON wi.id = be.work_item_id
     WHERE be.session_id = ? ORDER BY be.sort_order`
  )
    .bind(sessionId)
    .all();

  if (entryRows.length === 0) {
    return c.json({ error: "No entries to export yet" }, 400);
  }

  const { results: componentRows } = await c.env.DB.prepare(
    `SELECT bec.*, ft.rumus as formula_rumus
     FROM backup_entry_components bec
     JOIN formula_templates ft ON ft.id = bec.formula_template_id
     WHERE bec.entry_id IN (SELECT id FROM backup_entries WHERE session_id = ?)
     ORDER BY bec.sort_order`
  )
    .bind(sessionId)
    .all();

  const entryIndexById = new Map<string, number>();
  (entryRows as any[]).forEach((e, i) => entryIndexById.set(e.id, i));

  const componentsByEntry = new Map<string, any[]>();
  for (const comp of componentRows as any[]) {
    const list = componentsByEntry.get(comp.entry_id) ?? [];
    list.push(comp);
    componentsByEntry.set(comp.entry_id, list);
  }

  const entries: EntryInput[] = [];
  for (let i = 0; i < (entryRows as any[]).length; i++) {
    const row = (entryRows as any[])[i];
    let imageBuffer: ArrayBuffer | null = null;
    const imageObject = await c.env.FILES.get(row.image_r2_key);
    if (imageObject) imageBuffer = await imageObject.arrayBuffer();

    const ext = (row.image_r2_key.split(".").pop() || "png").toLowerCase();

    entries.push({
      no: i + 1,
      uraian: row.work_item_description,
      notasi: row.notasi,
      imageBuffer,
      imageExtension: ext === "jpg" || ext === "jpeg" ? "jpeg" : "png",
      components: (componentsByEntry.get(row.id) ?? []).map((comp) => ({
        formulaRumus: comp.formula_rumus,
        panjang: comp.panjang,
        lebar: comp.lebar,
        tinggi: comp.tinggi,
        berat: comp.berat,
        koefisien: comp.koefisien,
        unit: comp.unit,
        sat: comp.sat,
        sign: comp.sign as 1 | -1,
        ket: comp.ket,
        sameAsEntryIndex: comp.same_as_entry_id
          ? entryIndexById.get(comp.same_as_entry_id) ?? null
          : null,
      })),
    });
  }

  const buffer = await generateBvAwalWorkbook({ projectName: session.name, entries });

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="BV_AWAL_${sessionId}.xlsx"`,
    },
  });
});
