import ExcelJS from "exceljs";
import {
  CROSS_REFERENCE_RUMUS,
  getFormulaDefinition,
  type RowColumns,
} from "../../shared/formulas";
import { readImageDimensions } from "./imageDimensions";

/** Target on-sheet display box for an embedded drawing, in pixels — sized
 * to roughly fill the "Uraian Pekerjaan / Gambar" merge (C:H, ~640px wide
 * in the reference sheet). Scaled to fit preserving aspect ratio, never
 * stretched. */
const IMAGE_MAX_WIDTH_PX = 480;
const IMAGE_MAX_HEIGHT_PX = 420;
const DEFAULT_ROW_HEIGHT_PX = 20;
// Column C (0-indexed 2) — just inside the left edge of the Uraian
// Pekerjaan/Gambar merge, matching the reference sheet's drawing placement.
const IMAGE_ANCHOR_COL = 2;

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

/**
 * Column layout matching the reference BV AWAL sheet, read directly from
 * the original CCO workbook's "BV AWAL" sheet: a thin left margin (A),
 * No. (B), a wide merged Uraian Pekerjaan/Gambar block (C:H) holding both
 * the description and the drawing, then RUMUS through Ket, a spacer (V),
 * and a Deviasi Volume column (W) that live-checks Volume Terpasang
 * against the field-recorded Volume Awal.
 */
const COL = {
  no: "B",
  uraian: "C",
  rumus: "I",
  notasi: "J",
  panjang: "K",
  lebar: "L",
  tinggi: "M",
  berat: "N",
  koefisien: "O",
  unit: "P",
  sat: "Q",
  volumeBagian: "R",
  volumeTerpasang: "S",
  volumeAwal: "T",
  ket: "U",
  deviasi: "W",
} as const;
const URAIAN_MERGE_END = "H";

const ROW_COLS: RowColumns = {
  panjang: COL.panjang,
  lebar: COL.lebar,
  tinggi: COL.tinggi,
  berat: COL.berat,
  koefisien: COL.koefisien,
  unit: COL.unit,
};

// The reference sheet highlights Volume Terpasang's header with a dark navy
// fill + white bold text — the one computed column the whole workbook
// exists to produce correctly, so it's visually called out.
const VOLUME_TERPASANG_FILL = "FF002060";
const SUBCATEGORY_GRAY = "FF7F7F7F";
const NUMERIC_FMT = "0.00";

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
  category?: string | null; // e.g. "V PEKERJAAN ARSITEKTUR"
  subcategory?: string | null; // e.g. "V.1 PEKERJAAN LANTAI"
  notasi?: string | null;
  /** Field-recorded reference volume (the original sheet's VAR pull-through).
   * Optional — when present, a live Deviasi Volume (= Terpasang - Awal) is
   * written; when absent, there's nothing to compare against so it's left
   * blank rather than implying a false 100% deviation. */
  volumeAwal?: number | null;
  imageBuffer?: ArrayBuffer | null;
  imageExtension?: "png" | "jpeg";
  components: ComponentInput[];
}

export interface GenerateWorkbookInput {
  projectName: string;
  entries: EntryInput[];
}

const TITLE_ROW = 2;
const PROJECT_ROW = 3;
const HEADER_LABEL_ROW = 5;
const HEADER_UNIT_ROW = 6;
const FIRST_DATA_ROW = 8;

function writeHeader(sheet: ExcelJS.Worksheet, projectName: string) {
  sheet.getCell(`B${TITLE_ROW}`).value = "BACKUP VOLUME AWAL (BV AWAL)";
  sheet.getCell(`B${TITLE_ROW}`).font = { bold: true, size: 14 };
  sheet.getCell(`B${PROJECT_ROW}`).value = projectName;

  const labelHeaders: [string, string][] = [
    [COL.no, "No."],
    [COL.uraian, "Uraian Pekerjaan / Gambar"],
    [COL.rumus, "RUMUS"],
    [COL.notasi, "Notasi"],
    [COL.panjang, "Panjang"],
    [COL.lebar, "Lebar"],
    [COL.tinggi, "Tinggi"],
    [COL.berat, "Berat"],
    [COL.koefisien, "Koefisien"],
    [COL.unit, "Unit"],
    [COL.sat, "Sat"],
    [COL.volumeBagian, "Volume Bagian"],
    [COL.volumeTerpasang, "Volume Terpasang"],
    [COL.volumeAwal, "Volume Awal"],
    [COL.ket, "Ket"],
    [COL.deviasi, "Deviasi Volume"],
  ];
  for (const [col, label] of labelHeaders) {
    const cell = sheet.getCell(`${col}${HEADER_LABEL_ROW}`);
    cell.value = label;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (col === COL.volumeTerpasang) {
      cell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VOLUME_TERPASANG_FILL } };
    } else {
      cell.font = { bold: true, size: 12 };
    }
  }
  sheet.mergeCells(`${COL.uraian}${HEADER_LABEL_ROW}:${URAIAN_MERGE_END}${HEADER_LABEL_ROW}`);
  sheet.mergeCells(`${COL.uraian}${HEADER_UNIT_ROW}:${URAIAN_MERGE_END}${HEADER_UNIT_ROW}`);

  const unitHeaders: [string, string][] = [
    [COL.panjang, "(m)"],
    [COL.lebar, "(m)"],
    [COL.tinggi, "(m)"],
    [COL.berat, "(kg)"],
  ];
  for (const [col, label] of unitHeaders) {
    const cell = sheet.getCell(`${col}${HEADER_UNIT_ROW}`);
    cell.value = label;
    cell.font = { italic: true, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  sheet.getColumn("A").width = 2.2;
  sheet.getColumn(COL.no).width = 6;
  for (const c of ["C", "D", "E", "F", "G", "H"]) sheet.getColumn(c).width = 15;
  sheet.getColumn(COL.rumus).width = 20;
  sheet.getColumn(COL.notasi).width = 16;
  for (const c of [COL.panjang, COL.lebar, COL.tinggi, COL.berat, COL.koefisien, COL.unit]) {
    sheet.getColumn(c).width = 10;
  }
  sheet.getColumn(COL.sat).width = 9;
  sheet.getColumn(COL.volumeBagian).width = 13;
  sheet.getColumn(COL.volumeTerpasang).width = 14;
  sheet.getColumn(COL.volumeAwal).width = 13;
  sheet.getColumn(COL.ket).width = 22;
  sheet.getColumn("V").width = 2.2;
  sheet.getColumn(COL.deviasi).width = 13;

  sheet.views = [{ state: "frozen", xSplit: 0, ySplit: HEADER_UNIT_ROW }];

  // Deviasi Volume: red when under the field-recorded volume, green when
  // over — the reference sheet's exact convention (an exact match, 0,
  // stays unhighlighted).
  sheet.addConditionalFormatting({
    ref: `${COL.deviasi}${FIRST_DATA_ROW}:${COL.deviasi}1048576`,
    rules: [
      {
        type: "cellIs",
        operator: "lessThan",
        priority: 1,
        formulae: ["0"],
        style: {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } } as any,
          font: { color: { argb: "FF9C0006" } },
        },
      },
      {
        type: "cellIs",
        operator: "greaterThan",
        priority: 2,
        formulae: ["0"],
        style: {
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } } as any,
          font: { color: { argb: "FF006100" } },
        },
      },
    ],
  });
}

/** Splits "V PEKERJAAN ARSITEKTUR" -> ["V", "PEKERJAAN ARSITEKTUR"] so the
 * marker and name can go in separate cells, matching the reference sheet's
 * category/sub-category banner rows. */
function splitMarkerAndName(label: string): [string, string] {
  const match = label.match(/^([IVXLCM]+(?:\.\d+)?)\s+(.*)$/);
  return match ? [match[1], match[2]] : ["", label];
}

function writeBanner(
  sheet: ExcelJS.Worksheet,
  row: number,
  label: string,
  kind: "category" | "subcategory"
) {
  const [marker, name] = splitMarkerAndName(label);
  const markerCell = sheet.getCell(`${COL.no}${row}`);
  markerCell.value = marker;
  markerCell.alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells(`${COL.uraian}${row}:${URAIAN_MERGE_END}${row}`);
  const nameCell = sheet.getCell(`${COL.uraian}${row}`);
  nameCell.value = name;

  const font =
    kind === "category"
      ? { bold: true, size: 12 }
      : { bold: true, size: 11, color: { argb: SUBCATEGORY_GRAY } };
  markerCell.font = font;
  nameCell.font = font;
}

/**
 * Builds one entry's row block: a header row (No/Uraian/Volume Terpasang/
 * Volume Awal/Deviasi) followed by one row per Volume Bagian component.
 * Volume Terpasang is a live =SUM(...) over the component rows' Volume
 * Bagian cells — never a static number. Returns the next free row index.
 */
function writeEntry(
  sheet: ExcelJS.Worksheet,
  entry: EntryInput,
  entryHeaderRow: number,
  componentRowOfEntry: Map<number, number> // entryIndex -> its header row, for cross-refs
): number {
  sheet.getCell(`${COL.no}${entryHeaderRow}`).value = entry.no;
  sheet.getCell(`${COL.no}${entryHeaderRow}`).alignment = { horizontal: "center", vertical: "top" };

  sheet.mergeCells(`${COL.uraian}${entryHeaderRow}:${URAIAN_MERGE_END}${entryHeaderRow}`);
  const uraianCell = sheet.getCell(`${COL.uraian}${entryHeaderRow}`);
  uraianCell.value = entry.uraian;
  uraianCell.font = { bold: true };
  uraianCell.alignment = { wrapText: true, vertical: "top" };
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
      const dims: [string, number | null | undefined][] = [
        [COL.panjang, comp.panjang],
        [COL.lebar, comp.lebar],
        [COL.tinggi, comp.tinggi],
        [COL.berat, comp.berat],
        [COL.koefisien, comp.koefisien],
        [COL.unit, comp.unit],
      ];
      for (const [col, value] of dims) {
        if (value != null) {
          const cell = sheet.getCell(`${col}${row}`);
          cell.value = value;
          cell.numFmt = NUMERIC_FMT;
        }
      }

      const rawFormula = def.toExcelFormula(ROW_COLS, row);
      const signedFormula = comp.sign === -1 ? `-(${rawFormula})` : rawFormula;
      sheet.getCell(`${COL.volumeBagian}${row}`).value = { formula: signedFormula };
    }

    sheet.getCell(`${COL.volumeBagian}${row}`).numFmt = NUMERIC_FMT;
    if (comp.sat) sheet.getCell(`${COL.sat}${row}`).value = comp.sat;
    if (comp.ket) sheet.getCell(`${COL.ket}${row}`).value = comp.ket;
    row += 1;
  }

  const lastComponentRow = row - 1;
  // Volume Terpasang = live SUM over this entry's own Volume Bagian rows —
  // the generated output the whole system exists to produce correctly.
  const volumeTerpasangCell = sheet.getCell(`${COL.volumeTerpasang}${entryHeaderRow}`);
  volumeTerpasangCell.value =
    lastComponentRow >= firstComponentRow
      ? { formula: `SUM(${COL.volumeBagian}${firstComponentRow}:${COL.volumeBagian}${lastComponentRow})` }
      : 0;
  volumeTerpasangCell.font = { bold: true };
  volumeTerpasangCell.numFmt = NUMERIC_FMT;
  volumeTerpasangCell.alignment = { horizontal: "center", vertical: "top" };

  if (entry.volumeAwal != null) {
    const volumeAwalCell = sheet.getCell(`${COL.volumeAwal}${entryHeaderRow}`);
    volumeAwalCell.value = entry.volumeAwal;
    volumeAwalCell.numFmt = NUMERIC_FMT;
    volumeAwalCell.alignment = { horizontal: "center", vertical: "top" };

    const deviasiCell = sheet.getCell(`${COL.deviasi}${entryHeaderRow}`);
    deviasiCell.value = {
      formula: `${COL.volumeTerpasang}${entryHeaderRow}-${COL.volumeAwal}${entryHeaderRow}`,
    };
    deviasiCell.font = { bold: true };
    deviasiCell.numFmt = NUMERIC_FMT;
    deviasiCell.alignment = { horizontal: "center", vertical: "top" };
  }

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

  // Plan every row up front — banner rows (category/sub-category, printed
  // whenever they change from the previous entry, matching the reference
  // sheet's grouping) and each entry's header row — computed exactly once,
  // so the "how many banners precede this entry" decision can't diverge
  // between a reservation pass and a writing pass. "sama dengan <item>"
  // cross-refs (which may point forward or backward) need every entry's
  // header row resolved before any cell is written.
  let currentRow = FIRST_DATA_ROW;
  const reservedRows: number[] = [];
  const banners: { row: number; label: string; kind: "category" | "subcategory" }[] = [];
  let lastCategory: string | null | undefined;
  let lastSubcategory: string | null | undefined;
  input.entries.forEach((entry, i) => {
    if (entry.category && entry.category !== lastCategory) {
      banners.push({ row: currentRow, label: entry.category, kind: "category" });
      currentRow += 1;
      lastCategory = entry.category;
      lastSubcategory = undefined; // force the sub-category banner to reprint too
    }
    if (entry.subcategory && entry.subcategory !== lastSubcategory) {
      banners.push({ row: currentRow, label: entry.subcategory, kind: "subcategory" });
      currentRow += 1;
      lastSubcategory = entry.subcategory;
    }

    reservedRows.push(currentRow);
    const componentRows = Math.max(entry.components.length, 1) + 1;
    const imageRows = imageSizes[i]
      ? Math.ceil(imageSizes[i]!.height / DEFAULT_ROW_HEIGHT_PX)
      : 0;
    currentRow += componentRows + imageRows + 1; // + spacer row after
  });
  const componentRowOfEntry = new Map<number, number>();
  input.entries.forEach((_, i) => componentRowOfEntry.set(i, reservedRows[i]));

  for (const banner of banners) writeBanner(sheet, banner.row, banner.label, banner.kind);

  input.entries.forEach((entry, i) => {
    const headerRow = reservedRows[i];
    const nextFreeRow = writeEntry(sheet, entry, headerRow, componentRowOfEntry);

    const displaySize = imageSizes[i];
    if (entry.imageBuffer && displaySize) {
      const imageId = workbook.addImage({
        buffer: entry.imageBuffer as any,
        extension: entry.imageExtension ?? "png",
      });
      // Anchored at a fixed top-left cell with an explicit pixel size —
      // this scales the image to its real aspect ratio instead of
      // stretching it to fill a cell range (the earlier, distorting
      // approach). Row is 0-indexed for ExcelJS's position anchor; using
      // `nextFreeRow` (1-indexed, right after the last component row)
      // places the image directly below the entry's data, inside the
      // Uraian Pekerjaan/Gambar merge.
      sheet.addImage(imageId, {
        tl: { col: IMAGE_ANCHOR_COL, row: nextFreeRow - 1 },
        ext: { width: displaySize.width, height: displaySize.height },
      } as ExcelJS.ImagePosition);
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
