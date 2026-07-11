import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Download, DraftingCompass, FileStack, PencilRuler, ShieldCheck } from "lucide-react";
import { api, type EntryRecord, type FormulaTemplate, type WorkItem } from "./api";
import { UploadBq } from "./components/UploadBq";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { ExportPanel } from "./components/ExportPanel";

const DEFAULT_PROJECT_NAME = "Untitled project";

type Tab = "breakdown" | "build" | "entries";

const TAB_META: Record<Tab, { title: string; description: string }> = {
  breakdown: {
    title: "Upload the Breakdown",
    description:
      "Upload the project's Bill of Quantity (Breakdown) PDF. It's parsed into a hierarchical list of work items — category, sub-category, item — used to match drawings in the next step.",
  },
  build: {
    title: "Build a backup entry",
    description:
      "Match a blueprint drawing to a work item, pick the formula that fits its shape, and enter or auto-detect its dimensions. Volume Terpasang is always computed automatically.",
  },
  entries: {
    title: "Entries & export",
    description:
      "Review everything accumulated in this session, run a QA pass, and download the finished BV AWAL workbook.",
  },
};

export default function App() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [formulas, setFormulas] = useState<FormulaTemplate[]>([]);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [tab, setTab] = useState<Tab>("breakdown");

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

  const meta = TAB_META[tab];

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand__glyph">
            <DraftingCompass size={18} />
          </span>
          <div>
            <div className="sidebar-brand__name">BV AWAL Generator</div>
            <div className="sidebar-brand__tag">Milestone 1</div>
          </div>
        </div>
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

        <div className="sidebar-section-label">Workspace</div>
        <nav className="sidebar-nav">
          <button
            className={"sidebar-nav__item" + (tab === "breakdown" ? " sidebar-nav__item--active" : "")}
            onClick={() => setTab("breakdown")}
          >
            <span className={"sidebar-nav__icon" + (workItems.length > 0 ? " sidebar-nav__icon--done" : "")}>
              {workItems.length > 0 ? <CheckCircle2 size={13} /> : "1"}
            </span>
            <span className="sidebar-nav__label">Breakdown</span>
            <span className="sidebar-nav__meta">{workItems.length > 0 ? workItems.length : "—"}</span>
          </button>
          <button
            className={"sidebar-nav__item" + (tab === "build" ? " sidebar-nav__item--active" : "")}
            onClick={() => setTab("build")}
          >
            <span className="sidebar-nav__icon">
              <PencilRuler size={12} />
            </span>
            <span className="sidebar-nav__label">Build entry</span>
          </button>
          <button
            className={"sidebar-nav__item" + (tab === "entries" ? " sidebar-nav__item--active" : "")}
            onClick={() => setTab("entries")}
          >
            <span className={"sidebar-nav__icon" + (entries.length > 0 ? " sidebar-nav__icon--done" : "")}>
              {entries.length > 0 ? <FileStack size={13} /> : "3"}
            </span>
            <span className="sidebar-nav__label">Entries</span>
            <span className="sidebar-nav__meta">{entries.length > 0 ? entries.length : "—"}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <p>
            <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: "0.3rem" }} />
            QA and export live in the Entries tab.
          </p>
          <button className="secondary" disabled={entries.length === 0} onClick={() => setTab("entries")}>
            <Download size={14} />
            Go to export
          </button>
          <span className="stamp">SESSION {session.id.replace(/^sess_/, "").slice(0, 10).toUpperCase()}</span>
        </div>
      </aside>

      <main className="app-main">
        <div className="main-header">
          <h2>{meta.title}</h2>
          <p>{meta.description}</p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === "breakdown" && (
              <UploadBq
                sessionId={session.id}
                onParsed={(count) => {
                  refreshWorkItems(session.id);
                  if (count > 0) setTab("build");
                }}
                onProjectNameSuggested={handleProjectNameSuggested}
              />
            )}
            {tab === "build" && (
              <EntryForm
                sessionId={session.id}
                workItems={workItems}
                formulas={formulas}
                existingEntries={entries}
                onSubmitted={() => refreshEntries(session.id)}
              />
            )}
            {tab === "entries" && (
              <>
                <EntryList entries={entries} onDeleted={() => refreshEntries(session.id)} />
                <ExportPanel sessionId={session.id} entryCount={entries.length} />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
