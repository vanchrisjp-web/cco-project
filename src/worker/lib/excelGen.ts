import ExcelJS from "exceljs";
import {
  CROSS_REFERENCE_RUMUS,
  getFormulaDefinition,
  type RowColumns,
} from "./formulas";

/** Column layout for the generated BV AWAL sheet — see Section 4.1. */
const COL = {
  no: "A",
  uraian: "B",
  rumus: "C",
  notasi: "D",
  panjang: "E",
  lebar: "F",
  tinggi: "G",
  berat: "H",
  koefisien: "I",
  unit: "J",
  sat: "K",
  volumeBagian: "L",
  volumeTerpasang: "M",
  volumeAwal: "N",
  ket: "O",
} as const;

const ROW_COLS: RowColumns = {
  panjang: COL.panjang,
  lebar: COL.lebar,
  tinggi: COL.tinggi,
  berat: COL.berat,
  koefisien: COL.koefisien,
  unit: COL.unit,
};

export interface ComponentInput {
  formulaRumus: string;
  panjang?: number | null;
  lebar?: number | null;
  tinggi?: number | null;
  berat?: number | null;
  koefisien?: number | null;
  unit?: number | null;
  sat?: string | null;
  sign: 1 | -1;
  ket?: string | null;
  sameAsEntryIndex?: number | null; // index into `entries` for "sama dengan <item>"
}

export interface EntryInput {
  no: string | number;
  uraian: string;
  notasi?: string | null;
  imageBuffer?: ArrayBuffer | null;
  imageExtension?: "png" | "jpeg";
  components: ComponentInput[];
}

export interface GenerateWorkbookInput {
  projectName: string;
  entries: EntryInput[];
}

const HEADER_ROW = 3;
const FIRST_DATA_ROW = 5;
const ROWS_PER_IMAGE = 3; // image spans ~3 rows tall next to its entry header

function writeHeader(sheet: ExcelJS.Worksheet, projectName: string) {
  sheet.getCell("A1").value = "BACKUP VOLUME AWAL (BV AWAL)";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value = projectName;

  const headers: [string, string][] = [
    [COL.no, "No."],
    [COL.uraian, "Uraian Pekerjaan / Gambar"],
    [COL.rumus, "RUMUS"],
    [COL.notasi, "Notasi"],
    [COL.panjang, "Panjang (m)"],
    [COL.lebar, "Lebar (m)"],
    [COL.tinggi, "Tinggi (m)"],
    [COL.berat, "Berat (kg)"],
    [COL.koefisien, "Koefisien"],
    [COL.unit, "Unit"],
    [COL.sat, "Sat"],
    [COL.volumeBagian, "Volume Bagian"],
    [COL.volumeTerpasang, "Volume Terpasang"],
    [COL.volumeAwal, "Volume Awal"],
    [COL.ket, "Ket"],
  ];
  for (const [col, label] of headers) {
    const cell = sheet.getCell(`${col}${HEADER_ROW}`);
    cell.value = label;
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "middle" };
  }
  sheet.getColumn(COL.uraian).width = 42;
  sheet.getColumn(COL.rumus).width = 22;
  sheet.getColumn(COL.notasi).width = 16;
  for (const c of [COL.panjang, COL.lebar, COL.tinggi, COL.berat, COL.koefisien, COL.unit]) {
    sheet.getColumn(c).width = 11;
  }
  sheet.getColumn(COL.volumeBagian).width = 15;
  sheet.getColumn(COL.volumeTerpasang).width = 16;
  sheet.getColumn(COL.volumeAwal).width = 13;
  sheet.getColumn(COL.ket).width = 24;
}

/**
 * Builds one entry's row block: a header row (No/Uraian/Volume Terpasang)
 * followed by one row per Volume Bagian component. Volume Terpasang is a
 * live =SUM(...) over the component rows' Volume Bagian cells — never a
 * static number. Returns the next free row index.
 */
function writeEntry(
  sheet: ExcelJS.Worksheet,
  entry: EntryInput,
  entryHeaderRow: number,
  componentRowOfEntry: Map<number, number> // entryIndex -> its header row, for cross-refs
): number {
  sheet.getCell(`${COL.no}${entryHeaderRow}`).value = entry.no;
  sheet.getCell(`${COL.uraian}${entryHeaderRow}`).value = entry.uraian;
  sheet.getCell(`${COL.uraian}${entryHeaderRow}`).font = { bold: true };
  if (entry.notasi) sheet.getCell(`${COL.notasi}${entryHeaderRow}`).value = entry.notasi;

  const firstComponentRow = entryHeaderRow + 1;
  let row = firstComponentRow;

  for (const comp of entry.components) {
    if (comp.formulaRumus === CROSS_REFERENCE_RUMUS) {
      const refHeaderRow =
        comp.sameAsEntryIndex != null ? componentRowOfEntry.get(comp.sameAsEntryIndex) : undefined;
      sheet.getCell(`${COL.rumus}${row}`).value = CROSS_REFERENCE_RUMUS;
      sheet.getCell(`${COL.volumeBagian}${row}`).value = refHeaderRow
        ? { formula: `${COL.volumeTerpasang}${refHeaderRow}` }
        : 0;
    } else {
      const def = getFormulaDefinition(comp.formulaRumus);
      if (!def) throw new Error(`Unknown RUMUS: ${comp.formulaRumus}`);

      sheet.getCell(`${COL.rumus}${row}`).value = comp.formulaRumus;
      if (comp.panjang != null) sheet.getCell(`${COL.panjang}${row}`).value = comp.panjang;
      if (comp.lebar != null) sheet.getCell(`${COL.lebar}${row}`).value = comp.lebar;
      if (comp.tinggi != null) sheet.getCell(`${COL.tinggi}${row}`).value = comp.tinggi;
      if (comp.berat != null) sheet.getCell(`${COL.berat}${row}`).value = comp.berat;
      if (comp.koefisien != null) sheet.getCell(`${COL.koefisien}${row}`).value = comp.koefisien;
      if (comp.unit != null) sheet.getCell(`${COL.unit}${row}`).value = comp.unit;

      const rawFormula = def.toExcelFormula(ROW_COLS, row);
      const signedFormula = comp.sign === -1 ? `-(${rawFormula})` : rawFormula;
      sheet.getCell(`${COL.volumeBagian}${row}`).value = { formula: signedFormula };
    }

    if (comp.sat) sheet.getCell(`${COL.sat}${row}`).value = comp.sat;
    if (comp.ket) sheet.getCell(`${COL.ket}${row}`).value = comp.ket;
    row += 1;
  }

  const lastComponentRow = row - 1;
  // Volume Terpasang = live SUM over this entry's own Volume Bagian rows —
  // the generated output the whole system exists to produce correctly.
  sheet.getCell(`${COL.volumeTerpasang}${entryHeaderRow}`).value =
    lastComponentRow >= firstComponentRow
      ? { formula: `SUM(${COL.volumeBagian}${firstComponentRow}:${COL.volumeBagian}${lastComponentRow})` }
      : 0;
  sheet.getCell(`${COL.volumeTerpasang}${entryHeaderRow}`).font = { bold: true };

  return Math.max(row, entryHeaderRow + ROWS_PER_IMAGE) + 1; // blank spacer row after each entry
}

export async function generateBvAwalWorkbook(input: GenerateWorkbookInput): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BV AWAL Generator";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("BV AWAL");
  writeHeader(sheet, input.projectName);

  let currentRow = FIRST_DATA_ROW;
  const entryHeaderRows: number[] = [];
  const componentRowOfEntry = new Map<number, number>();

  // First pass: reserve header rows so "sama dengan <item>" cross-refs
  // (which may point forward or backward) can resolve on the second pass.
  const reservedRows: number[] = [];
  for (const entry of input.entries) {
    reservedRows.push(currentRow);
    const rowsNeeded = Math.max(entry.components.length, 1) + 2;
    currentRow += rowsNeeded;
  }
  input.entries.forEach((_, i) => componentRowOfEntry.set(i, reservedRows[i]));

  currentRow = FIRST_DATA_ROW;
  input.entries.forEach((entry, i) => {
    const headerRow = reservedRows[i];
    entryHeaderRows.push(headerRow);
    writeEntry(sheet, entry, headerRow, componentRowOfEntry);

    if (entry.imageBuffer) {
      const imageId = workbook.addImage({
        buffer: entry.imageBuffer as any,
        extension: entry.imageExtension ?? "png",
      });
      const anchorToRow = headerRow + ROWS_PER_IMAGE;
      // "Q{row}:U{row}" — anchored a few columns right of the data table,
      // spanning the entry's row block. String ranges are the simplest
      // ExcelJS anchor form and are what the Workers-runtime spike verified.
      sheet.addImage(imageId, `Q${headerRow}:U${anchorToRow}`);
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
