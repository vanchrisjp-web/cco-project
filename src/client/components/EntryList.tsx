import { api, type EntryRecord } from "../api";

export function EntryList({
  entries,
  onDeleted,
}: {
  entries: EntryRecord[];
  onDeleted: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel__eyebrow">
        <span className="step-num">3</span> Accumulated entries
      </div>
      <h2>
        This session <span className="pill pill--accent">{entries.length}</span>
      </h2>
      {entries.length === 0 && <p className="muted">Nothing added yet — build your first entry on the left.</p>}
      <ul className="entry-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <img className="thumb" src={api.imageUrl(entry.image_r2_key)} alt="" />
            <div style={{ flex: 1 }}>
              <div className="entry-title">{entry.work_item_description}</div>
              <div className="entry-meta">
                {entry.components.length} component{entry.components.length === 1 ? "" : "s"} ·{" "}
                {entry.components.map((c: any) => c.formula_rumus).join(", ")}
              </div>
            </div>
            <button
              className="ghost"
              onClick={async () => {
                await api.deleteEntry(entry.id);
                onDeleted();
              }}
            >
              remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
