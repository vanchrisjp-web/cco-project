export interface WorkItem {
  id: string;
  path: string;
  description: string;
  unit: string | null;
  source_category: string | null;
}

export interface FormulaTemplate {
  id: string;
  rumus: string;
  label: string;
  dimension_fields: string[];
}

export interface ComponentDraft {
  formulaRumus: string;
  panjang: number | null;
  lebar: number | null;
  tinggi: number | null;
  berat: number | null;
  koefisien: number | null;
  unit: number | null;
  sat: string | null;
  sign: 1 | -1;
  ket: string | null;
  sameAsEntryId: string | null;
}

export interface EntryRecord {
  id: string;
  work_item_path: string;
  work_item_description: string;
  work_item_unit: string | null;
  image_r2_key: string;
  notasi: string | null;
  components: any[];
}

async function json<T>(resPromise: Response | Promise<Response>): Promise<T> {
  const res = await resPromise;
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(typeof body.error === "string" ? body.error : JSON.stringify(body.error));
  }
  return res.json();
}

export const api = {
  createSession: (name: string) =>
    json<{ id: string; name: string }>(
      fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
    ),

  uploadBq: (sessionId: string, file: File, mode: "free" | "accurate") => {
    const form = new FormData();
    form.append("file", file);
    return json<{ mode: string; itemCount: number }>(
      fetch(`/api/sessions/${sessionId}/bq?mode=${mode}`, { method: "POST", body: form })
    );
  },

  listWorkItems: (sessionId: string) =>
    json<WorkItem[]>(fetch(`/api/sessions/${sessionId}/work-items`)),

  listFormulas: () => json<FormulaTemplate[]>(fetch("/api/formulas")),

  uploadImage: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return json<{ imageR2Key: string; imageFilename: string }>(
      fetch(`/api/sessions/${sessionId}/images`, { method: "POST", body: form })
    );
  },

  imageUrl: (r2Key: string) => `/api/images/${r2Key}`,

  suggestDimensions: (
    sessionId: string,
    imageR2Key: string,
    formulaRumus: string,
    mode: "free" | "accurate"
  ) =>
    json<{ suggestion: Record<string, number | null>; fields: string[] }>(
      fetch(`/api/sessions/${sessionId}/suggest-dimensions?mode=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageR2Key, formulaRumus }),
      })
    ),

  createEntry: (
    sessionId: string,
    body: {
      workItemId: string;
      imageR2Key: string;
      imageFilename?: string;
      notasi?: string | null;
      components: ComponentDraft[];
    }
  ) =>
    json<{ id: string }>(
      fetch(`/api/sessions/${sessionId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ),

  listEntries: (sessionId: string) =>
    json<EntryRecord[]>(fetch(`/api/sessions/${sessionId}/entries`)),

  deleteEntry: (entryId: string) =>
    json<{ ok: true }>(fetch(`/api/entries/${entryId}`, { method: "DELETE" })),

  runQa: (sessionId: string) =>
    json<{ findings: { severity: string; entryId: string; message: string }[]; checkedEntries: number }>(
      fetch(`/api/sessions/${sessionId}/qa`, { method: "POST" })
    ),

  exportUrl: (sessionId: string) => `/api/sessions/${sessionId}/export`,
};
