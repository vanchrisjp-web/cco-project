import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, DraftingCompass } from "lucide-react";
import { api, type EntryRecord, type FormulaTemplate, type WorkItem } from "./api";
import { UploadBq } from "./components/UploadBq";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { ExportPanel } from "./components/ExportPanel";

const DEFAULT_PROJECT_NAME = "Untitled project";

const panelMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

export default function App() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [formulas, setFormulas] = useState<FormulaTemplate[]>([]);
  const [entries, setEntries] = useState<EntryRecord[]>([]);

  useEffect(() => {
    api.createSession(DEFAULT_PROJECT_NAME).then((s) => {
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

  async function saveProjectName(name: string) {
    if (!session) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === session.name) {
      setProjectName(session.name);
      return;
    }
    const updated = await api.renameSession(session.id, trimmed);
    setSession(updated);
    setProjectName(updated.name);
  }

  // Only auto-fill from the uploaded PDF's filename while the project still
  // has its placeholder name — a name the user deliberately typed is never
  // overwritten by this.
  function handleProjectNameSuggested(name: string) {
    if (!session || session.name !== DEFAULT_PROJECT_NAME) return;
    setProjectName(name);
    saveProjectName(name);
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
        <div className="app-header__glow" />
        <div className="app-header__mark">
          <span className="app-header__mark-glyph">
            <DraftingCompass size={22} />
          </span>
          <div className="app-header__titles">
            <h1>BV AWAL Generator</h1>
            <input
              className="project-name-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={(e) => saveProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="Project name"
              placeholder="Name this project…"
            />
          </div>
        </div>
        <div className="app-header__meta">
          <span className="subtitle">Milestone 1 · backup-volume workbook builder</span>
          <span className="app-header__stamp">SESSION {session.id.replace(/^sess_/, "").slice(0, 10).toUpperCase()}</span>
        </div>
      </header>

      <motion.div className="status-bar" initial="initial" animate="animate">
        <motion.div
          className={"status-chip" + (workItems.length > 0 ? " status-chip--done" : "")}
          variants={panelMotion}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="status-chip__icon">{workItems.length > 0 ? <CheckCircle2 size={16} /> : "1"}</span>
          <span>
            <span className="status-chip__label">Bill of Quantity</span>
            <span className="status-chip__value">
              {workItems.length > 0 ? `${workItems.length} items parsed` : "Not uploaded yet"}
            </span>
          </span>
        </motion.div>
        <motion.div
          className={"status-chip" + (entries.length > 0 ? " status-chip--done" : "")}
          variants={panelMotion}
          transition={{ duration: 0.3, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="status-chip__icon">{entries.length > 0 ? <CheckCircle2 size={16} /> : "2"}</span>
          <span>
            <span className="status-chip__label">Backup entries</span>
            <span className="status-chip__value">
              {entries.length > 0 ? `${entries.length} accumulated` : "None added yet"}
            </span>
          </span>
        </motion.div>
        <motion.div
          className={"status-chip" + (entries.length > 0 ? " status-chip--ready" : "")}
          variants={panelMotion}
          transition={{ duration: 0.3, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="status-chip__icon">3</span>
          <span>
            <span className="status-chip__label">Export</span>
            <span className="status-chip__value">
              {entries.length > 0 ? "Ready to download" : "Add at least 1 entry"}
            </span>
          </span>
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
        <UploadBq
          sessionId={session.id}
          onParsed={() => refreshWorkItems(session.id)}
          onProjectNameSuggested={handleProjectNameSuggested}
        />
      </motion.div>

      <div className="layout">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <EntryForm
            sessionId={session.id}
            workItems={workItems}
            formulas={formulas}
            existingEntries={entries}
            onSubmitted={() => refreshEntries(session.id)}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <EntryList entries={entries} onDeleted={() => refreshEntries(session.id)} />
          <ExportPanel sessionId={session.id} entryCount={entries.length} />
        </motion.div>
      </div>
    </div>
  );
}
