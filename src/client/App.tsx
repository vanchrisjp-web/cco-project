import { useEffect, useState } from "react";
import { api, type EntryRecord, type FormulaTemplate, type WorkItem } from "./api";
import { UploadBq } from "./components/UploadBq";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { ExportPanel } from "./components/ExportPanel";

export default function App() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [formulas, setFormulas] = useState<FormulaTemplate[]>([]);
  const [entries, setEntries] = useState<EntryRecord[]>([]);

  useEffect(() => {
    api.createSession("Untitled project").then(setSession);
    api.listFormulas().then(setFormulas);
  }, []);

  async function refreshEntries(sessionId: string) {
    setEntries(await api.listEntries(sessionId));
  }

  async function refreshWorkItems(sessionId: string) {
    setWorkItems(await api.listWorkItems(sessionId));
  }

  if (!session) {
    return (
      <div>
        <p className="muted">Starting session…</p>
      </div>
    );
  }

  return (
    <div>
      <header className="app-header">
        <h1>BV AWAL Generator</h1>
        <span className="subtitle">Milestone 1 · backup-volume workbook builder</span>
      </header>

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
