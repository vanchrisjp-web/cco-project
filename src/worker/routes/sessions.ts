import { Hono } from "hono";
import type { Env } from "../types";
import { newId } from "../lib/ids";
import { parseWorkItemsDeterministic, parseWorkItemsWithClaude } from "../lib/pdfParse";

export const sessionsRoute = new Hono<{ Bindings: Env }>();

sessionsRoute.post("/sessions", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  const id = newId("sess");
  await c.env.DB.prepare("INSERT INTO sessions (id, name) VALUES (?, ?)")
    .bind(id, body.name ?? "Untitled project")
    .run();
  return c.json({ id, name: body.name ?? "Untitled project" });
});

sessionsRoute.patch("/sessions/:id", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  if (!body.name || !body.name.trim()) return c.json({ error: "name is required" }, 400);
  await c.env.DB.prepare("UPDATE sessions SET name = ? WHERE id = ?")
    .bind(body.name.trim(), c.req.param("id"))
    .run();
  return c.json({ id: c.req.param("id"), name: body.name.trim() });
});

sessionsRoute.get("/sessions/:id", async (c) => {
  const session = await c.env.DB.prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(session);
});

/**
 * Upload the BQ PDF and parse it into a hierarchical work-item list.
 * ?mode=accurate opts into the paid Claude API high-accuracy path
 * (Section 4.4.1 Tier 3); default is the free deterministic Tier 1 parser.
 * This must be an explicit choice, never a silent fallback that surprises
 * the user with a cost.
 */
sessionsRoute.post("/sessions/:id/bq", async (c) => {
  const sessionId = c.req.param("id");
  const mode = c.req.query("mode") === "accurate" ? "accurate" : "free";

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);

  const buffer = await file.arrayBuffer();
  const r2Key = `sessions/${sessionId}/bq/${file.name}`;
  await c.env.FILES.put(r2Key, buffer);
  await c.env.DB.prepare(
    "UPDATE sessions SET bq_pdf_r2_key = ?, bq_pdf_filename = ? WHERE id = ?"
  )
    .bind(r2Key, file.name, sessionId)
    .run();

  let parsed;
  if (mode === "accurate") {
    if (!c.env.ANTHROPIC_API_KEY) {
      return c.json({ error: "High-accuracy mode requires ANTHROPIC_API_KEY to be configured" }, 400);
    }
    parsed = await parseWorkItemsWithClaude(buffer, c.env.ANTHROPIC_API_KEY);
  } else {
    parsed = await parseWorkItemsDeterministic(buffer);
  }

  const stmt = c.env.DB.prepare(
    "INSERT INTO work_items (id, session_id, path, description, unit, source_category, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const batch = parsed.map((item, i) =>
    stmt.bind(newId("wi"), sessionId, item.path, item.description, item.unit, item.sourceCategory, i)
  );
  if (batch.length > 0) await c.env.DB.batch(batch);

  return c.json({ mode, itemCount: parsed.length });
});

sessionsRoute.get("/sessions/:id/work-items", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM work_items WHERE session_id = ? ORDER BY sort_order"
  )
    .bind(c.req.param("id"))
    .all();
  return c.json(results);
});
