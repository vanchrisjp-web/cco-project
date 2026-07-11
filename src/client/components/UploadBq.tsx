import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { api } from "../api";
import { Dropzone } from "./Dropzone";

type ParsePhase = "idle" | "uploading" | "parsing" | "done";

// Tier 1 parsing is one synchronous pass server-side — there's no per-page
// signal to report honestly. Instead of a fake bar that lies about being
// "done", this climbs on an ease-out curve toward a cap just short of 100%
// while we wait, then snaps to the real 100% the instant the response
// actually lands, so it never overclaims completion.
const PARSE_ESTIMATE_SECONDS = 2.2;
const PARSE_ESTIMATE_CAP = 0.92;

/** "breakdown BQ Renovasi BTN KCP Supermall Karawaci.pdf" -> "Renovasi BTN
 * KCP Supermall Karawaci" — strips the extension and generic administrative
 * prefixes ("BQ", "Breakdown BQ") that describe the document type, not the
 * project, so the auto-derived name reads like an actual project title. */
function deriveProjectNameFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.pdf$/i, "").trim();
  const withoutPrefix = withoutExt.replace(/^(breakdown\s+)?bq\s+/i, "").trim();
  return withoutPrefix || withoutExt || "Untitled project";
}

export function UploadBq({
  sessionId,
  onParsed,
  onProjectNameSuggested,
}: {
  sessionId: string;
  onParsed: (count: number) => void;
  onProjectNameSuggested: (name: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"free" | "accurate">("free");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ itemCount: number; mode: string; truncated?: boolean } | null>(null);
  const [phase, setPhase] = useState<ParsePhase>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [parsePct, setParsePct] = useState(0);
  const parseStartRef = useRef<number | null>(null);

  const busy = phase === "uploading" || phase === "parsing";

  useEffect(() => {
    if (phase !== "parsing") return;
    parseStartRef.current = performance.now();
    setParsePct(0);
    const id = setInterval(() => {
      const elapsedSeconds = (performance.now() - parseStartRef.current!) / 1000;
      setParsePct(PARSE_ESTIMATE_CAP * (1 - Math.exp(-elapsedSeconds / PARSE_ESTIMATE_SECONDS)));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

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
      setParsePct(1);
      setResult(res);
      setPhase("done");
      onParsed(res.itemCount);
      onProjectNameSuggested(deriveProjectNameFromFilename(file.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  return (
    <section className="panel">
      <div className="panel__eyebrow">
        <span className="step-num">1</span> Breakdown
      </div>
      <h2>Upload the project's Breakdown PDF</h2>
      <label>PDF file</label>
      <Dropzone
        accept="application/pdf"
        label="Click to upload or drag & drop"
        hint="The Breakdown (Bill of Quantity) PDF for this project"
        file={file}
        onChange={setFile}
      />

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

      <div style={{ marginTop: "1.1rem" }}>
        <button disabled={!file || busy} onClick={handleUpload}>
          {busy ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
          {phase === "uploading" ? "Uploading…" : phase === "parsing" ? "Parsing…" : "Upload & parse"}
        </button>
      </div>

      {busy && (
        <div className="progress-bar" style={{ marginTop: "0.8rem" }}>
          <div className="progress-bar__track">
            <div
              className="progress-bar__fill"
              style={{ width: `${Math.round((phase === "uploading" ? uploadPct : parsePct) * 100)}%` }}
            />
          </div>
          <span className="progress-bar__label">
            {phase === "uploading"
              ? `Uploading… ${Math.round(uploadPct * 100)}%`
              : `Parsing PDF structure — extracting categories, sub-categories, and items… ${Math.round(parsePct * 100)}%`}
          </span>
        </div>
      )}

      {error && (
        <p className="muted" style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--critical)" }}>
          <AlertTriangle size={15} />
          {error}
        </p>
      )}
      {result && (
        <>
          {result.itemCount > 0 ? (
            <p className="muted" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <CheckCircle2 size={15} color="var(--good)" />
              Parsed <strong>{result.itemCount}</strong> work items using the {result.mode} path.
            </p>
          ) : (
            <p className="muted" style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--critical)" }}>
              <AlertTriangle size={15} />
              No work items found.{" "}
              {result.mode === "accurate"
                ? "Try Free mode, or a smaller/simpler PDF."
                : "Check the PDF has a recognizable Breakdown table."}
            </p>
          )}
          {result.truncated && (
            <p className="muted" style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--warn)", marginTop: "0.3rem" }}>
              <AlertTriangle size={15} />
              The high-accuracy response was cut off partway through this document — the list above may be
              incomplete. Free mode reads the whole document in one deterministic pass instead.
            </p>
          )}
        </>
      )}
    </section>
  );
}
