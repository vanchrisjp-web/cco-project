import { useMemo, useState } from "react";
import { api, type ComponentDraft, type FormulaTemplate, type WorkItem } from "../api";

const emptyComponent = (rumus: string): ComponentDraft => ({
  formulaRumus: rumus,
  panjang: null,
  lebar: null,
  tinggi: null,
  berat: null,
  koefisien: null,
  unit: null,
  sat: null,
  sign: 1,
  ket: null,
  sameAsEntryId: null,
});

export function EntryForm({
  sessionId,
  workItems,
  formulas,
  existingEntries,
  onSubmitted,
}: {
  sessionId: string;
  workItems: WorkItem[];
  formulas: FormulaTemplate[];
  existingEntries: { id: string; work_item_description: string }[];
  onSubmitted: () => void;
}) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageR2Key, setImageR2Key] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [workItemFilter, setWorkItemFilter] = useState("");
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItem | null>(null);
  const [notasi, setNotasi] = useState("");
  const [components, setComponents] = useState<ComponentDraft[]>([
    emptyComponent(formulas[0]?.rumus ?? "U"),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null);

  const filteredWorkItems = useMemo(() => {
    if (!workItemFilter.trim()) return workItems.slice(0, 20);
    const q = workItemFilter.toLowerCase();
    return workItems.filter((w) => w.path.toLowerCase().includes(q)).slice(0, 20);
  }, [workItemFilter, workItems]);

  async function handleImageChange(file: File | null) {
    setImageFile(file);
    setImageR2Key(null);
    setImagePreviewUrl(null);
    if (!file) return;
    setImagePreviewUrl(URL.createObjectURL(file));
    const { imageR2Key } = await api.uploadImage(sessionId, file);
    setImageR2Key(imageR2Key);
  }

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setComponents((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addComponent() {
    setComponents((prev) => [...prev, emptyComponent(formulas[0]?.rumus ?? "U")]);
  }

  function removeComponent(index: number) {
    setComponents((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSuggest(index: number, mode: "free" | "accurate") {
    if (!imageR2Key) return;
    setSuggestingIndex(index);
    try {
      const { suggestion } = await api.suggestDimensions(
        sessionId,
        imageR2Key,
        components[index].formulaRumus,
        mode
      );
      updateComponent(index, suggestion as Partial<ComponentDraft>);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestingIndex(null);
    }
  }

  async function handleSubmit() {
    if (!selectedWorkItem || !imageR2Key) return;
    setBusy(true);
    setError(null);
    try {
      await api.createEntry(sessionId, {
        workItemId: selectedWorkItem.id,
        imageR2Key,
        imageFilename: imageFile?.name,
        notasi: notasi || null,
        components,
      });
      setImageFile(null);
      setImageR2Key(null);
      setImagePreviewUrl(null);
      setSelectedWorkItem(null);
      setWorkItemFilter("");
      setNotasi("");
      setComponents([emptyComponent(formulas[0]?.rumus ?? "U")]);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = selectedWorkItem && imageR2Key && components.length > 0 && !busy;

  return (
    <section className="panel">
      <div className="panel__eyebrow">
        <span className="step-num">2</span> Add a backup entry
      </div>
      <h2>Match a drawing to a work item</h2>

      <label>Drawing / blueprint image</label>
      <input
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
      />
      {imagePreviewUrl && <img className="image-preview" src={imagePreviewUrl} alt="Selected drawing" />}

      <label>Work item</label>
      <input
        type="text"
        placeholder="Search the parsed work-item list…"
        value={selectedWorkItem ? selectedWorkItem.path : workItemFilter}
        onChange={(e) => {
          setSelectedWorkItem(null);
          setWorkItemFilter(e.target.value);
        }}
      />
      {!selectedWorkItem && workItemFilter && (
        <ul className="entry-list" style={{ marginTop: "0.4rem", maxHeight: "12rem", overflowY: "auto" }}>
          {filteredWorkItems.map((w) => (
            <li
              key={w.id}
              style={{ cursor: "pointer" }}
              onClick={() => {
                setSelectedWorkItem(w);
                setWorkItemFilter("");
              }}
            >
              <span className="entry-title">{w.path}</span>
            </li>
          ))}
          {filteredWorkItems.length === 0 && <li className="muted">No matches</li>}
        </ul>
      )}

      <label>Notasi (optional legend)</label>
      <input type="text" value={notasi} onChange={(e) => setNotasi(e.target.value)} />

      <h2 style={{ marginTop: "1.4rem" }}>Volume Bagian components</h2>
      <p className="muted">
        Add one row per physical sub-component (main area, plus a recess, minus a column
        cut-out…). Each gets its own live formula in the exported workbook.
      </p>

      {components.map((comp, i) => {
        const def = formulas.find((f) => f.rumus === comp.formulaRumus);
        const fields = def?.dimension_fields ?? [];
        return (
          <div className="component-row" key={i}>
            {components.length > 1 && (
              <button className="component-row__remove" onClick={() => removeComponent(i)}>
                remove
              </button>
            )}
            <label>Formula (RUMUS)</label>
            <select
              value={comp.formulaRumus}
              onChange={(e) => updateComponent(i, { formulaRumus: e.target.value })}
            >
              {formulas.map((f) => (
                <option key={f.id} value={f.rumus}>
                  {f.rumus} — {f.label}
                </option>
              ))}
            </select>

            {comp.formulaRumus !== "sama dengan <item>" ? (
              <>
                <div className="dim-grid" style={{ marginTop: "0.6rem" }}>
                  {fields.includes("panjang") && (
                    <NumberField label="Panjang (m)" value={comp.panjang} onChange={(v) => updateComponent(i, { panjang: v })} />
                  )}
                  {fields.includes("lebar") && (
                    <NumberField label="Lebar (m)" value={comp.lebar} onChange={(v) => updateComponent(i, { lebar: v })} />
                  )}
                  {fields.includes("tinggi") && (
                    <NumberField label="Tinggi (m)" value={comp.tinggi} onChange={(v) => updateComponent(i, { tinggi: v })} />
                  )}
                  {fields.includes("berat") && (
                    <NumberField label="Berat (kg)" value={comp.berat} onChange={(v) => updateComponent(i, { berat: v })} />
                  )}
                  {fields.includes("koefisien") && (
                    <NumberField label="Koefisien" value={comp.koefisien} onChange={(v) => updateComponent(i, { koefisien: v })} />
                  )}
                  {fields.includes("unit") && (
                    <NumberField label="Unit" value={comp.unit} onChange={(v) => updateComponent(i, { unit: v })} />
                  )}
                </div>
                {imageR2Key && (
                  <div className="row" style={{ marginTop: "0.5rem" }}>
                    <button
                      className="secondary"
                      disabled={suggestingIndex === i}
                      onClick={() => handleSuggest(i, "free")}
                    >
                      {suggestingIndex === i ? "Reading…" : "Suggest from image (free)"}
                    </button>
                    <button
                      className="ghost"
                      disabled={suggestingIndex === i}
                      onClick={() => handleSuggest(i, "accurate")}
                    >
                      Suggest (high-accuracy)
                    </button>
                    <span className="muted">Always review before submit — never auto-accepted.</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <label>Same volume as</label>
                <select
                  value={comp.sameAsEntryId ?? ""}
                  onChange={(e) => updateComponent(i, { sameAsEntryId: e.target.value || null })}
                >
                  <option value="">Select an existing entry…</option>
                  {existingEntries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.work_item_description}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div className="dim-grid" style={{ marginTop: "0.6rem" }}>
              <div>
                <label>Sat</label>
                <input type="text" value={comp.sat ?? ""} onChange={(e) => updateComponent(i, { sat: e.target.value || null })} />
              </div>
              <div>
                <label>Sign</label>
                <select value={comp.sign} onChange={(e) => updateComponent(i, { sign: Number(e.target.value) as 1 | -1 })}>
                  <option value={1}>+ (add)</option>
                  <option value={-1}>− (subtract, e.g. cut-out)</option>
                </select>
              </div>
            </div>
            <label>Ket (note)</label>
            <input type="text" value={comp.ket ?? ""} onChange={(e) => updateComponent(i, { ket: e.target.value || null })} />
          </div>
        );
      })}

      <div style={{ marginTop: "0.9rem" }}>
        <button className="secondary" onClick={addComponent}>
          + Add another component
        </button>
      </div>

      <div style={{ marginTop: "1.2rem" }}>
        <button disabled={!canSubmit} onClick={handleSubmit}>
          {busy ? "Saving…" : "Add entry to session"}
        </button>
      </div>
      {error && (
        <p className="muted" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label>{label}</label>
      <input
        type="number"
        step="any"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </div>
  );
}
