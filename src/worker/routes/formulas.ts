import { Hono } from "hono";
import type { Env } from "../types";

export const formulasRoute = new Hono<{ Bindings: Env }>();

formulasRoute.get("/formulas", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, rumus, label, dimension_fields FROM formula_templates ORDER BY rowid"
  ).all();
  const formulas = results.map((r: any) => ({
    ...r,
    dimension_fields: JSON.parse(r.dimension_fields as string),
  }));
  return c.json(formulas);
});
