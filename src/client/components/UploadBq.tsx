import { useState } from "react";
import { api } from "../api";

export function UploadBq({
  sessionId,
  onParsed,
}: {
  sessionId: string;
  onParsed: (count: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"free" | "accurate">("free");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ itemCount: number; mode: string } | null>(null);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadBq(sessionId, file, mode);
      setResult(res);
      onParsed(res.itemCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__eyebrow">
        <span className="step-num">1</span> Bill of Quantity
      </div>
      <h2>Upload the project's BQ PDF</h2>
      <label>PDF file</label>
      <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />

      <label>Extraction path</label>
      <div className="row">
        <label style={{ margin: 0, display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input
            type="radio"
            name="mode"
            checked={mode === "free"}
            onChange={() => setMode("free")}
            style={{ width: "auto" }}
          />
          Free (deterministic + rules)
        </label>
        <label style={{ margin: 0, display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input
            type="radio"
            name="mode"
            checked={mode === "accurate"}
            onChange={() => setMode("accurate")}
            style={{ width: "auto" }}
          />
          High-accuracy (Claude API, small cost/doc)
        </label>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <button disabled={!file || busy} onClick={handleUpload}>
          {busy ? "Parsing…" : "Upload & parse"}
        </button>
      </div>

      {error && (
        <p className="muted" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      {result && (
        <p className="muted">
          Parsed <strong>{result.itemCount}</strong> work items using the {result.mode} path.
        </p>
      )}
    </section>
  );
}
