import { useEffect, useState } from "react";
import { api, type EntryRecord, type FormulaTemplate, type WorkItem } from "./api";
import { UploadBq } from "./components/UploadBq";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { ExportPanel } from "./components/ExportPanel";

export default function App() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [projectName, setProjectName] = useState("Untitled project");
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [formulas, setFormulas] = useState<FormulaTemplate[]>([]);
  const [entries, setEntries] = useState<EntryRecord[]>([]);

  useEffect(() => {
    api.createSession("Untitled project").then((s) => {
      setSession(s);
      setProjectName(s.name);
    });
    api.listFormulas().then(setFormulas);
  }, []);

  async function refreshEntries(sessionId: string) {
    setEntries(await api.listEntries(sessionId));
  }

  async function refreshWorkItems(sessionId: string) {
    setWorkItems(await api.listWorkItems(sessionId));
  }

  async function saveProjectName() {
    if (!session) return;
    const trimmed = projectName.trim();
    if (!trimmed || trimmed === session.name) {
      setProjectName(session.name);
      return;
    }
    const updated = await api.renameSession(session.id, trimmed);
    setSession(updated);
    setProjectName(updated.name);
  }

  if (!session) {
    return (
      <div className="loading-state">
        <p className="muted">Starting session…</p>
      </div>
    );
  }

  return (
    <div>
      <header className="app-header">
        <div className="app-header__titles">
          <h1>BV AWAL Generator</h1>
          <input
            className="project-name-input"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={saveProjectName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Project name"
            placeholder="Name this project…"
          />
        </div>
        <span className="subtitle">Milestone 1 · backup-volume workbook builder</span>
      </header>

      <div className="status-bar">
        <div className={"status-chip" + (workItems.length > 0 ? " status-chip--done" : "")}>
          <span className="status-chip__icon">1</span>
          <span>
            <span className="status-chip__label">Bill of Quantity</span>
            <span className="status-chip__value">
              {workItems.length > 0 ? `${workItems.length} items parsed` : "Not uploaded yet"}
            </span>
          </span>
        </div>
        <div className={"status-chip" + (entries.length > 0 ? " status-chip--done" : "")}>
          <span className="status-chip__icon">2</span>
          <span>
            <span className="status-chip__label">Backup entries</span>
            <span className="status-chip__value">
              {entries.length > 0 ? `${entries.length} accumulated` : "None added yet"}
            </span>
          </span>
        </div>
        <div className={"status-chip" + (entries.length > 0 ? " status-chip--ready" : "")}>
          <span className="status-chip__icon">3</span>
          <span>
            <span className="status-chip__label">Export</span>
            <span className="status-chip__value">
              {entries.length > 0 ? "Ready to download" : "Add at least 1 entry"}
            </span>
          </span>
        </div>
      </div>

      <UploadBq sessionId={session.id} onParsed={() => refreshWorkItems(session.id)} />

      <div className="layout">
        <div>
          <EntryForm
            sessionId={session.id}
            workItems={workItems}
            formulas={formulas}
            existingEntries={entries}
            onSubmitted={() => refreshEntries(session.id)}
          />
        </div>
        <div>
          <EntryList entries={entries} onDeleted={() => refreshEntries(session.id)} />
          <ExportPanel sessionId={session.id} entryCount={entries.length} />
        </div>
      </div>
    </div>
  );
}
