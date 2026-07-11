import { api, type EntryRecord } from "../api";
import { CROSS_REFERENCE_RUMUS, getFormulaDefinition } from "../../shared/formulas";

/** Same auto-compute as the exported workbook's live SUM formula (see
 * shared/formulas.ts) — a cross-referenced component is excluded here for
 * the same reason as the EntryForm preview: it only resolves against the
 * full session at export time. */
function computeVolumeTerpasang(components: any[]): number {
  return components.reduce((sum, comp) => {
    if (comp.formula_rumus === CROSS_REFERENCE_RUMUS) return sum;
    const def = getFormulaDefinition(comp.formula_rumus);
    if (!def) return sum;
    return sum + comp.sign * def.evaluate(comp);
  }, 0);
}

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
        {entries.map((entry) => {
          const volumeTerpasang = computeVolumeTerpasang(entry.components);
          const deviasi = entry.volume_awal != null ? volumeTerpasang - entry.volume_awal : null;
          const deviationClass =
            deviasi != null && deviasi < 0
              ? " deviation-critical"
              : deviasi != null && deviasi > 0
                ? " deviation-good"
                : "";
          return (
            <li key={entry.id} className={deviationClass.trim()}>
              <img className="thumb" src={api.imageUrl(entry.image_r2_key)} alt="" />
              <div style={{ flex: 1 }}>
                <div className="entry-title">{entry.work_item_description}</div>
                <div className="entry-meta">
                  {entry.components.length} component{entry.components.length === 1 ? "" : "s"} ·{" "}
                  {entry.components.map((c: any) => c.formula_rumus).join(", ")}
                </div>
                <div className="entry-meta">
                  Volume Terpasang ={" "}
                  <strong>{volumeTerpasang.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                  {deviasi != null && (
                    <>
                      {" "}
                      ·{" "}
                      <span
                        className={
                          "pill " +
                          (deviasi > 0 ? "pill--good" : deviasi < 0 ? "pill--critical" : "pill--accent")
                        }
                      >
                        Deviasi {deviasi > 0 ? "+" : ""}
                        {deviasi.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                className="ghost ghost--danger"
                onClick={async () => {
                  await api.deleteEntry(entry.id);
                  onDeleted();
                }}
              >
                remove
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
