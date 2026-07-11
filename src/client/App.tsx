import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, ChevronDown, Download, DraftingCompass, FileStack, PencilRuler, ShieldCheck } from "lucide-react";
import { api, type EntryRecord, type FormulaTemplate, type WorkItem } from "./api";
import { UploadBq } from "./components/UploadBq";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { ExportPanel } from "./components/ExportPanel";

const DEFAULT_PROJECT_NAME = "Untitled project";

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

export default function App() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [formulas, setFormulas] = useState<FormulaTemplate[]>([]);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  // The Breakdown card collapses to a one-line summary once parsed, so the
  // build/entries workspace below — the part used over and over — gets the
  // room. Re-expandable any time to replace the file.
  const [breakdownExpanded, setBreakdownExpanded] = useState(true);

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

        <div className="sidebar-section-label">This session</div>
        <nav className="sidebar-nav">
          <a href="#section-breakdown" className="sidebar-nav__item">
            <span className={"sidebar-nav__icon" + (workItems.length > 0 ? " sidebar-nav__icon--done" : "")}>
              {workItems.length > 0 ? <CheckCircle2 size={13} /> : "1"}
            </span>
            <span className="sidebar-nav__label">Breakdown</span>
            <span className="sidebar-nav__meta">{workItems.length > 0 ? workItems.length : "—"}</span>
          </a>
          <a href="#section-build" className="sidebar-nav__item">
            <span className="sidebar-nav__icon">
              <PencilRuler size={12} />
            </span>
            <span className="sidebar-nav__label">Build entry</span>
          </a>
          <a href="#section-entries" className="sidebar-nav__item">
            <span className={"sidebar-nav__icon" + (entries.length > 0 ? " sidebar-nav__icon--done" : "")}>
              {entries.length > 0 ? <FileStack size={13} /> : "3"}
            </span>
            <span className="sidebar-nav__label">Entries</span>
            <span className="sidebar-nav__meta">{entries.length > 0 ? entries.length : "—"}</span>
          </a>
        </nav>

        <div className="sidebar-footer">
          <p>
            <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: "0.3rem" }} />
            QA check and download are at the bottom of Entries.
          </p>
          <a href="#section-entries">
            <button className="secondary" disabled={entries.length === 0}>
              <Download size={14} />
              Jump to export
            </button>
          </a>
          <span className="stamp">SESSION {session.id.replace(/^sess_/, "").slice(0, 10).toUpperCase()}</span>
        </div>
      </aside>

      <main className="app-main">
        <section id="section-breakdown" style={{ scrollMarginTop: "1.5rem" }}>
          {/* UploadBq stays mounted at all times — even while collapsed —
              so its own state (the file that was selected, the "N items
              parsed" success message) survives collapsing and re-expanding.
              Conditionally rendering it here instead would unmount it on
              collapse and hand back a blank instance on re-expand, which is
              exactly the "my upload disappeared" bug this replaced. */}
          <div style={{ display: breakdownExpanded || workItems.length === 0 ? "block" : "none" }}>
            <UploadBq
              sessionId={session.id}
              onParsed={(count) => {
                refreshWorkItems(session.id);
                if (count > 0) setBreakdownExpanded(false);
              }}
              onProjectNameSuggested={handleProjectNameSuggested}
            />
          </div>
          {!breakdownExpanded && workItems.length > 0 && (
            <motion.button
              className="breakdown-summary"
              onClick={() => setBreakdownExpanded(true)}
              initial="initial"
              animate="animate"
              variants={fadeUp}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="breakdown-summary__icon">
                <CheckCircle2 size={16} />
              </span>
              <span className="breakdown-summary__text">
                <strong>{workItems.length} work items</strong> parsed from the Breakdown
              </span>
              <span className="breakdown-summary__action">
                Show <ChevronDown size={14} />
              </span>
            </motion.button>
          )}
        </section>

        <div className="layout">
          <motion.div id="section-build" style={{ scrollMarginTop: "1.5rem" }} initial="initial" animate="animate" variants={fadeUp} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
            <EntryForm
              sessionId={session.id}
              workItems={workItems}
              formulas={formulas}
              existingEntries={entries}
              onSubmitted={() => refreshEntries(session.id)}
            />
          </motion.div>
          <motion.div id="section-entries" style={{ scrollMarginTop: "1.5rem" }} initial="initial" animate="animate" variants={fadeUp} transition={{ duration: 0.3, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}>
            <EntryList entries={entries} onDeleted={() => refreshEntries(session.id)} />
            <ExportPanel sessionId={session.id} entryCount={entries.length} />
          </motion.div>
        </div>
      </main>
    </div>
  );
}
