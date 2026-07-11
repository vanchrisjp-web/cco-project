import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { newId } from "../lib/ids";

export const entriesRoute = new Hono<{ Bindings: Env }>();

// Upload a blueprint/drawing image for a session. Returns the R2 key to
// reference when creating the entry.
entriesRoute.post("/sessions/:sessionId/images", async (c) => {
  const sessionId = c.req.param("sessionId");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const key = `sessions/${sessionId}/images/${newId("img")}.${ext}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "image/png" },
  });

  return c.json({ imageR2Key: key, imageFilename: file.name });
});

// Serve an uploaded image back for preview in the frontend.
entriesRoute.get("/images/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/images\//, "");
  const object = await c.env.FILES.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
});

const componentSchema = z.object({
  formulaRumus: z.string(),
  panjang: z.number().nullable().optional(),
  lebar: z.number().nullable().optional(),
  tinggi: z.number().nullable().optional(),
  berat: z.number().nullable().optional(),
  koefisien: z.number().nullable().optional(),
  unit: z.number().nullable().optional(),
  sat: z.string().nullable().optional(),
  sign: z.union([z.literal(1), z.literal(-1)]).default(1),
  ket: z.string().nullable().optional(),
  sameAsEntryId: z.string().nullable().optional(),
});

const entrySchema = z.object({
  workItemId: z.string(),
  imageR2Key: z.string(),
  imageFilename: z.string().optional(),
  notasi: z.string().nullable().optional(),
  components: z.array(componentSchema).min(1),
});

entriesRoute.post("/sessions/:sessionId/entries", async (c) => {
  const sessionId = c.req.param("sessionId");
  const parsed = entrySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;

  const entryId = newId("entry");
  const { results: countRows } = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM backup_entries WHERE session_id = ?"
  )
    .bind(sessionId)
    .all();
  const sortOrder = (countRows[0] as any).n as number;

  await c.env.DB.prepare(
    "INSERT INTO backup_entries (id, session_id, work_item_id, image_r2_key, image_filename, notasi, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(entryId, sessionId, body.workItemId, body.imageR2Key, body.imageFilename ?? null, body.notasi ?? null, sortOrder)
    .run();

  const stmt = c.env.DB.prepare(
    `INSERT INTO backup_entry_components
      (id, entry_id, formula_template_id, panjang, lebar, tinggi, berat, koefisien, unit, sat, sign, ket, same_as_entry_id, sort_order)
     VALUES (?, ?, (SELECT id FROM formula_templates WHERE rumus = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = body.components.map((comp, i) =>
    stmt.bind(
      newId("comp"),
      entryId,
      comp.formulaRumus,
      comp.panjang ?? null,
      comp.lebar ?? null,
      comp.tinggi ?? null,
      comp.berat ?? null,
      comp.koefisien ?? null,
      comp.unit ?? null,
      comp.sat ?? null,
      comp.sign,
      comp.ket ?? null,
      comp.sameAsEntryId ?? null,
      i
    )
  );
  await c.env.DB.batch(batch);

  return c.json({ id: entryId });
});

entriesRoute.get("/sessions/:sessionId/entries", async (c) => {
  const sessionId = c.req.param("sessionId");
  const { results: entries } = await c.env.DB.prepare(
    `SELECT be.*, wi.path as work_item_path, wi.description as work_item_description, wi.unit as work_item_unit
     FROM backup_entries be JOIN work_items wi ON wi.id = be.work_item_id
     WHERE be.session_id = ? ORDER BY be.sort_order`
  )
    .bind(sessionId)
    .all();

  const { results: components } = await c.env.DB.prepare(
    `SELECT bec.*, ft.rumus as formula_rumus
     FROM backup_entry_components bec
     JOIN formula_templates ft ON ft.id = bec.formula_template_id
     WHERE bec.entry_id IN (SELECT id FROM backup_entries WHERE session_id = ?)
     ORDER BY bec.sort_order`
  )
    .bind(sessionId)
    .all();

  const componentsByEntry = new Map<string, unknown[]>();
  for (const comp of components as any[]) {
    const list = componentsByEntry.get(comp.entry_id) ?? [];
    list.push(comp);
    componentsByEntry.set(comp.entry_id, list);
  }

  const withComponents = (entries as any[]).map((entry) => ({
    ...entry,
    components: componentsByEntry.get(entry.id) ?? [],
  }));

  return c.json(withComponents);
});

entriesRoute.delete("/entries/:entryId", async (c) => {
  await c.env.DB.prepare("DELETE FROM backup_entries WHERE id = ?")
    .bind(c.req.param("entryId"))
    .run();
  return c.json({ ok: true });
});
