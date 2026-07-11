/**
 * The predefined RUMUS (formula) library — catalogued from real BV AWAL
 * workbooks. Each formula defines which dimension fields it needs and how
 * to turn a component row's dimension cells into a live Excel formula
 * string for the "Volume Bagian" cell. Nothing here should ever compute a
 * plain number for the workbook itself — the numeric `evaluate()` output
 * is only for in-app preview before export.
 *
 * Shared between worker (workbook generation) and client (live Volume
 * Terpasang preview while building an entry) — pure logic, no
 * environment-specific APIs, safe to import from either bundle.
 *
 * Note: ExcelJS formula strings must NOT include a leading "=" — that's
 * added by Excel's own display layer, not stored in the underlying XML.
 */

export type DimensionField =
  | "panjang"
  | "lebar"
  | "tinggi"
  | "berat"
  | "koefisien"
  | "unit";

export interface Dimensions {
  panjang?: number | null;
  lebar?: number | null;
  tinggi?: number | null;
  berat?: number | null;
  koefisien?: number | null;
  unit?: number | null;
}

/** Column letters for a component row in the generated sheet (see Section 4.1). */
export interface RowColumns {
  panjang: string; // K
  lebar: string; // L
  tinggi: string; // M
  berat: string; // N
  koefisien: string; // O
  unit: string; // P
}

export interface FormulaDefinition {
  rumus: string;
  label: string;
  fields: DimensionField[];
  /** Build the live Excel formula string (no leading "=") for one component row. */
  toExcelFormula(cols: RowColumns, row: number): string;
  /** In-app numeric preview only — never written to the workbook as a value. */
  evaluate(d: Dimensions): number;
}

const num = (v: number | null | undefined) => v ?? 0;

export const FORMULA_LIBRARY: FormulaDefinition[] = [
  {
    rumus: "U",
    label: "Simple unit/quantity count, no geometry",
    fields: ["unit"],
    toExcelFormula: (c, r) => `${c.unit}${r}`,
    evaluate: (d) => num(d.unit),
  },
  {
    rumus: "area",
    label: "Direct area value (pre-known, not computed from P×L)",
    fields: ["panjang"],
    toExcelFormula: (c, r) => `${c.panjang}${r}`,
    evaluate: (d) => num(d.panjang),
  },
  {
    rumus: "P x U",
    label: "Length × quantity (linear-meter items)",
    fields: ["panjang", "unit"],
    toExcelFormula: (c, r) => `PRODUCT(${c.panjang}${r},${c.unit}${r})`,
    evaluate: (d) => num(d.panjang) * num(d.unit),
  },
  {
    rumus: "P x T x U",
    label: "Length × height × quantity (wall/partition area)",
    fields: ["panjang", "tinggi", "unit"],
    toExcelFormula: (c, r) =>
      `PRODUCT(${c.panjang}${r},${c.tinggi}${r},${c.unit}${r})`,
    evaluate: (d) => num(d.panjang) * num(d.tinggi) * num(d.unit),
  },
  {
    rumus: "P x L x U",
    label: "Length × width × quantity (floor/ceiling area)",
    fields: ["panjang", "lebar", "unit"],
    toExcelFormula: (c, r) =>
      `PRODUCT(${c.panjang}${r},${c.lebar}${r},${c.unit}${r})`,
    evaluate: (d) => num(d.panjang) * num(d.lebar) * num(d.unit),
  },
  {
    rumus: "P x L x U / 2",
    label: "Half of length × width × quantity (triangular/diagonal area)",
    fields: ["panjang", "lebar", "unit"],
    toExcelFormula: (c, r) =>
      `PRODUCT(${c.panjang}${r},${c.lebar}${r},${c.unit}${r})/2`,
    evaluate: (d) => (num(d.panjang) * num(d.lebar) * num(d.unit)) / 2,
  },
  {
    rumus: "koef x P^2 x U",
    label: "Coefficient × length² × quantity (circular area, koef = π)",
    fields: ["koefisien", "panjang", "unit"],
    toExcelFormula: (c, r) =>
      `${c.koefisien}${r}*${c.panjang}${r}^2*${c.unit}${r}`,
    evaluate: (d) => num(d.koefisien) * num(d.panjang) ** 2 * num(d.unit),
  },
  {
    rumus: "2 x koef x P",
    label: "Coefficient × length × 2 (circumference-style)",
    fields: ["koefisien", "panjang"],
    toExcelFormula: (c, r) => `2*${c.koefisien}${r}*${c.panjang}${r}`,
    evaluate: (d) => 2 * num(d.koefisien) * num(d.panjang),
  },
  {
    rumus: "(P + L) x T x U",
    label: "(length + width) × height × quantity",
    fields: ["panjang", "lebar", "tinggi", "unit"],
    toExcelFormula: (c, r) =>
      `(${c.panjang}${r}+${c.lebar}${r})*${c.tinggi}${r}*${c.unit}${r}`,
    evaluate: (d) => (num(d.panjang) + num(d.lebar)) * num(d.tinggi) * num(d.unit),
  },
  {
    rumus: "(P + L + T) x U",
    label: "Sum of three dimensions × quantity",
    fields: ["panjang", "lebar", "tinggi", "unit"],
    toExcelFormula: (c, r) =>
      `(${c.panjang}${r}+${c.lebar}${r}+${c.tinggi}${r})*${c.unit}${r}`,
    evaluate: (d) => (num(d.panjang) + num(d.lebar) + num(d.tinggi)) * num(d.unit),
  },
  {
    rumus: "2 x (P + L)",
    label: "Rectangle perimeter",
    fields: ["panjang", "lebar"],
    toExcelFormula: (c, r) => `2*(${c.panjang}${r}+${c.lebar}${r})`,
    evaluate: (d) => 2 * (num(d.panjang) + num(d.lebar)),
  },
  {
    rumus: "2 x K x P",
    label: "Coefficient-scaled length, doubled",
    fields: ["koefisien", "panjang"],
    toExcelFormula: (c, r) => `2*${c.koefisien}${r}*${c.panjang}${r}`,
    evaluate: (d) => 2 * num(d.koefisien) * num(d.panjang),
  },
  {
    rumus: "P x L + 2 x T x (P + L) + K x T^2",
    label: "Compound surface-area formula",
    fields: ["panjang", "lebar", "tinggi", "koefisien"],
    toExcelFormula: (c, r) =>
      `${c.panjang}${r}*${c.lebar}${r}+2*${c.tinggi}${r}*(${c.panjang}${r}+${c.lebar}${r})+${c.koefisien}${r}*${c.tinggi}${r}^2`,
    evaluate: (d) =>
      num(d.panjang) * num(d.lebar) +
      2 * num(d.tinggi) * (num(d.panjang) + num(d.lebar)) +
      num(d.koefisien) * num(d.tinggi) ** 2,
  },
];

/** "sama dengan <item>" is handled separately since it references another
 * entry's Volume Terpasang cell rather than its own dimension row — see
 * excelGen.ts buildComponentFormula(). */
export const CROSS_REFERENCE_RUMUS = "sama dengan <item>";

export function getFormulaDefinition(rumus: string): FormulaDefinition | undefined {
  return FORMULA_LIBRARY.find((f) => f.rumus === rumus);
}
