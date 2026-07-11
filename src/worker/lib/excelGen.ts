import ExcelJS from "exceljs";
import {
  CROSS_REFERENCE_RUMUS,
  getFormulaDefinition,
  type RowColumns,
} from "./formulas";
import { readImageDimensions } from "./imageDimensions";

/** Target on-sheet display box for an embedded drawing, in pixels.
 * The image is scaled to fit inside this box preserving its aspect
 * ratio — never stretched to fill it, which is what a plain cell-range
 * anchor does by default and was distorting every embedded blueprint. */
const IMAGE_MAX_WIDTH_PX = 280;
const IMAGE_MAX_HEIGHT_PX = 260;
const DEFAULT_ROW_HEIGHT_PX = 20;
const IMAGE_ANCHOR_COL = 16; // column Q (0-indexed), right of the data table

function computeImageDisplaySize(
  natural: { width: number; height: number } | null
): { width: number; height: number } {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { width: IMAGE_MAX_WIDTH_PX, height: IMAGE_MAX_HEIGHT_PX };
  }
  const scale = Math.min(
    IMAGE_MAX_WIDTH_PX / natural.width,
    IMAGE_MAX_HEIGHT_PX / natural.height,
    1 // never upscale a small source image past its native size
  );
  return {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale),
  };
}

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

  return row; // first free row right after this entry's last component
}

export async function generateBvAwalWorkbook(input: GenerateWorkbookInput): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BV AWAL Generator";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("BV AWAL");
  writeHeader(sheet, input.projectName);

  // Precompute each entry's image display size once (aspect-ratio-preserving,
  // never stretched) so the row-reservation pass can size the row block to
  // fit the image, not just the component rows.
  const imageSizes = input.entries.map((entry) =>
    entry.imageBuffer ? computeImageDisplaySize(readImageDimensions(entry.imageBuffer)) : null
  );

  let currentRow = FIRST_DATA_ROW;
  const componentRowOfEntry = new Map<number, number>();

  // First pass: reserve header rows so "sama dengan <item>" cross-refs
  // (which may point forward or backward) can resolve on the second pass.
  // Reserve enough rows for whichever is taller: the component list, or
  // the image at its real aspect ratio.
  const reservedRows: number[] = [];
  input.entries.forEach((entry, i) => {
    reservedRows.push(currentRow);
    const componentRows = Math.max(entry.components.length, 1) + 1;
    const imageRows = imageSizes[i]
      ? Math.ceil(imageSizes[i]!.height / DEFAULT_ROW_HEIGHT_PX) + 1
      : 0;
    currentRow += Math.max(componentRows, imageRows) + 1; // + spacer row after
  });
  input.entries.forEach((_, i) => componentRowOfEntry.set(i, reservedRows[i]));

  input.entries.forEach((entry, i) => {
    const headerRow = reservedRows[i];
    writeEntry(sheet, entry, headerRow, componentRowOfEntry);

    const displaySize = imageSizes[i];
    if (entry.imageBuffer && displaySize) {
      const imageId = workbook.addImage({
        buffer: entry.imageBuffer as any,
        extension: entry.imageExtension ?? "png",
      });
      // Anchored at a fixed top-left cell with an explicit pixel size —
      // this scales the image to its real aspect ratio instead of
      // stretching it to fill a cell range (the earlier, distorting
      // approach). Row is 0-indexed for ExcelJS's position anchor.
      sheet.addImage(imageId, {
        tl: { col: IMAGE_ANCHOR_COL, row: headerRow - 1 },
        ext: { width: displaySize.width, height: displaySize.height },
      } as ExcelJS.ImagePosition);
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
