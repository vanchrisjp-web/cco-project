import { Hono } from "hono";
import type { Env } from "./types";
import { sessionsRoute } from "./routes/sessions";
import { formulasRoute } from "./routes/formulas";
import { entriesRoute } from "./routes/entries";
import { exportRoute } from "./routes/export";
import { qaRoute } from "./routes/qa";
import { dimensionsRoute } from "./routes/dimensions";

const app = new Hono<{ Bindings: Env }>();

app.route("/api", sessionsRoute);
app.route("/api", formulasRoute);
app.route("/api", entriesRoute);
app.route("/api", exportRoute);
app.route("/api", qaRoute);
app.route("/api", dimensionsRoute);

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
