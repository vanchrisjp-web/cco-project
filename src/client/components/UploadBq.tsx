import { useState } from "react";
import { api } from "../api";

type ParsePhase = "idle" | "uploading" | "parsing" | "done";

export function UploadBq({
  sessionId,
  onParsed,
}: {
  sessionId: string;
  onParsed: (count: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"free" | "accurate">("free");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ itemCount: number; mode: string } | null>(null);
  const [phase, setPhase] = useState<ParsePhase>("idle");
  const [uploadPct, setUploadPct] = useState(0);

  const busy = phase === "uploading" || phase === "parsing";

  async function handleUpload() {
    if (!file) return;
    setPhase("uploading");
    setUploadPct(0);
    setError(null);
    try {
      const res = await api.uploadBqWithProgress(sessionId, file, mode, (fraction) => {
        setUploadPct(fraction);
        if (fraction >= 1) setPhase("parsing");
      });
      setResult(res);
      setPhase("done");
      onParsed(res.itemCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
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
          {phase === "uploading" ? "Uploading…" : phase === "parsing" ? "Parsing…" : "Upload & parse"}
        </button>
      </div>

      {busy && (
        <div className="progress-bar" style={{ marginTop: "0.8rem" }}>
          <div className="progress-bar__track">
            <div
              className={"progress-bar__fill" + (phase === "parsing" ? " progress-bar__fill--indeterminate" : "")}
              style={phase === "uploading" ? { width: `${Math.round(uploadPct * 100)}%` } : undefined}
            />
          </div>
          <span className="progress-bar__label">
            {phase === "uploading"
              ? `Uploading… ${Math.round(uploadPct * 100)}%`
              : "Parsing PDF structure — extracting categories, sub-categories, and items…"}
          </span>
        </div>
      )}

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
