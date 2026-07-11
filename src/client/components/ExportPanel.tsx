import { useState } from "react";
import { api } from "../api";

export function ExportPanel({ sessionId, entryCount }: { sessionId: string; entryCount: number }) {
  const [findings, setFindings] = useState<{ severity: string; message: string }[] | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleCheck() {
    setChecking(true);
    try {
      const { findings } = await api.runQa(sessionId);
      setFindings(findings);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__eyebrow">
        <span className="step-num">4</span> Export
      </div>
      <h2>Check, then download the BV AWAL workbook</h2>
      <p className="muted">
        The QA pass flags blank required dimensions, duplicate dimension sets across items, and
        anything a quick review would catch — the same pattern that found two real defects in
        past project files.
      </p>
      <div className="row">
        <button className="secondary" disabled={entryCount === 0 || checking} onClick={handleCheck}>
          {checking ? "Checking…" : "Run QA check"}
        </button>
        <a href={entryCount > 0 ? api.exportUrl(sessionId) : undefined}>
          <button disabled={entryCount === 0}>Download .xlsx</button>
        </a>
      </div>

      {findings && (
        <ul className="qa-findings">
          {findings.length === 0 && <li>No concerns found.</li>}
          {findings.map((f, i) => (
            <li key={i}>
              <span className={`pill pill--${f.severity === "error" ? "critical" : "warn"}`}>
                {f.severity}
              </span>
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
