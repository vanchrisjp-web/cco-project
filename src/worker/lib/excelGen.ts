import ExcelJS from "exceljs";
import {
  CROSS_REFERENCE_RUMUS,
  getFormulaDefinition,
  type RowColumns,
} from "../../shared/formulas";
import { readImageDimensions } from "./imageDimensions";

/** Target on-sheet display box for the entry's own overview drawing, in
 * pixels — sized to roughly fill the "Uraian Pekerjaan / Gambar" merge
 * (C:H, ~640px wide in the reference sheet). A component's own detail
 * drawing gets a smaller box (COMPONENT_IMAGE_*) since an entry can have
 * several of these stacked — full-size would make the sheet unreasonably
 * tall. Both are scaled to fit preserving aspect ratio, never stretched. */
const IMAGE_MAX_WIDTH_PX = 480;
const IMAGE_MAX_HEIGHT_PX = 420;
const COMPONENT_IMAGE_MAX_WIDTH_PX = 320;
const COMPONENT_IMAGE_MAX_HEIGHT_PX = 260;
const DEFAULT_ROW_HEIGHT_PX = 20;
// Column C (0-indexed 2) — just inside the left edge of the Uraian
// Pekerjaan/Gambar merge, matching the reference sheet's drawing placement.
const IMAGE_ANCHOR_COL = 2;

interface ImageSize {
  width: number;
  height: number;
}

function computeImageDisplaySize(
  natural: { width: number; height: number } | null,
  maxWidth: number,
  maxHeight: number
): ImageSize {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { width: maxWidth, height: maxHeight };
  }
  const scale = Math.min(
    maxWidth / natural.width,
    maxHeight / natural.height,
    1 // never upscale a small source image past its native size
  );
  return {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale),
  };
}

function imageRowSpan(size: ImageSize | null): number {
  return size ? Math.ceil(size.height / DEFAULT_ROW_HEIGHT_PX) : 0;
}

/**
 * Column layout matching the reference BV AWAL sheet, read directly from
 * the original CCO workbook's "BV AWAL" sheet: a thin left margin (A),
 * No. (B), a wide merged Uraian Pekerjaan/Gambar block (C:H) holding both
 * the description and the drawing(s), then RUMUS through Ket, a spacer
 * (V), and a Deviasi Volume column (W) that live-checks Volume Terpasang
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
  /** This sub-component's own detail drawing (e.g. a crop of just the
   * recess or cut-out it represents) — independent of, and in addition
   * to, the entry's overview image below. */
  imageBuffer?: ArrayBuffer | null;
  imageExtension?: "png" | "jpeg";
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
 * category/sub-category banner rows. Tier 1 never punctuates the roman
 * numeral ("V", "V.1"); Tier 3 (Claude) sometimes adds a trailing period
 * ("V.", "V.1.") — the optional trailing `\.?` here tolerates both. */
function splitMarkerAndName(label: string): [string, string] {
  const match = label.match(/^([IVXLCM]+\.?\d*\.?)\s+(.*)$/);
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

/** Numeric result for one component, independent of Excel — the same
 * `evaluate()` used for the in-app live preview (shared/formulas.ts),
 * reused here so every formula cell can carry a correct cached `result`
 * alongside its formula string (see the comment on `resolveEntryResults`
 * for why that cached value matters as much as the formula itself). */
function computeComponentResult(comp: ComponentInput, entryResults: number[]): number {
  if (comp.formulaRumus === CROSS_REFERENCE_RUMUS) {
    return comp.sameAsEntryIndex != null ? entryResults[comp.sameAsEntryIndex] ?? 0 : 0;
  }
  const def = getFormulaDefinition(comp.formulaRumus);
  return def ? comp.sign * def.evaluate(comp) : 0;
}

/**
 * Resolves every entry's Volume Terpasang total as a plain number, up
 * front, before any cell is written. Excel is supposed to recalculate a
 * formula cell that has no cached value on open (`fullCalcOnLoad`), but
 * files downloaded from a browser commonly open in Protected View, which
 * skips calculation entirely until the user clicks "Enable Editing" — the
 * cell just shows blank until then. Rather than depend on that, every
 * formula cell below gets a real cached `result` so the correct number is
 * visible immediately; the formula itself stays live and still
 * recalculates normally on any future edit.
 *
 * Two passes because a "sama dengan <item>" component's value depends on
 * another entry's total: pass 1 resolves every entry with no cross-ref
 * component (the vast majority), pass 2 resolves entries that do, using
 * whatever pass 1 (or an earlier entry in this same pass) already
 * produced. A cross-ref chain pointing at a later, still-unresolved
 * cross-ref entry falls back to 0 for just the cached value — the live
 * formula is unaffected and settles to the right number the moment Excel
 * recalculates.
 */
function resolveEntryResults(entries: EntryInput[]): number[] {
  const results: number[] = new Array(entries.length).fill(0);
  const resolved: boolean[] = new Array(entries.length).fill(false);

  entries.forEach((entry, i) => {
    if (entry.components.every((c) => c.formulaRumus !== CROSS_REFERENCE_RUMUS)) {
      results[i] = entry.components.reduce((sum, c) => sum + computeComponentResult(c, results), 0);
      resolved[i] = true;
    }
  });
  entries.forEach((entry, i) => {
    if (resolved[i]) return;
    results[i] = entry.components.reduce((sum, c) => sum + computeComponentResult(c, results), 0);
  });

  return results;
}

interface EntryLayout {
  headerRow: number; // 1-indexed
  componentDataRows: number[]; // 1-indexed, one per component
  componentImagePlacements: (({ row: number } & ImageSize) | null)[]; // one per component, null when that component has no image of its own
  mainImage: ({ row: number } & ImageSize) | null;
  nextRow: number; // where the next banner/entry should start
}

/**
 * Lays out one entry's rows without writing anything — a header row, then
 * one row per component (each optionally followed by its own detail
 * image's rows), then the entry's overview image (if any), then a spacer.
 * Computed once, up front, so "sama dengan <item>" cross-refs (which may
 * point forward or backward) can resolve every entry's header row before
 * any cell is written, and so a later component's image never overlaps
 * an earlier one purely because of read-order accidents.
 */
function planEntry(entry: EntryInput, startRow: number): EntryLayout {
  let row = startRow;
  const headerRow = row;
  row += 1;

  const componentDataRows: number[] = [];
  const componentImagePlacements: (({ row: number } & ImageSize) | null)[] = [];
  for (const comp of entry.components) {
    componentDataRows.push(row);
    row += 1;
    if (comp.imageBuffer) {
      const size = computeImageDisplaySize(
        readImageDimensions(comp.imageBuffer),
        COMPONENT_IMAGE_MAX_WIDTH_PX,
        COMPONENT_IMAGE_MAX_HEIGHT_PX
      );
      componentImagePlacements.push({ row, ...size });
      row += imageRowSpan(size);
    } else {
      componentImagePlacements.push(null);
    }
  }

  let mainImage: ({ row: number } & ImageSize) | null = null;
  if (entry.imageBuffer) {
    const size = computeImageDisplaySize(
      readImageDimensions(entry.imageBuffer),
      IMAGE_MAX_WIDTH_PX,
      IMAGE_MAX_HEIGHT_PX
    );
    mainImage = { row, ...size };
    row += imageRowSpan(size);
  }

  row += 1; // spacer before the next entry/banner
  return { headerRow, componentDataRows, componentImagePlacements, mainImage, nextRow: row };
}

/** Embeds one image at a fixed top-left cell with an explicit pixel size —
 * this scales the image to its real aspect ratio instead of stretching it
 * to fill a cell range. Row is 0-indexed for ExcelJS's position anchor. */
function placeImage(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
  buffer: ArrayBuffer,
  extension: "png" | "jpeg" | undefined,
  placement: { row: number } & ImageSize
) {
  const imageId = workbook.addImage({ buffer: buffer as any, extension: extension ?? "png" });
  sheet.addImage(imageId, {
    tl: { col: IMAGE_ANCHOR_COL, row: placement.row - 1 },
    ext: { width: placement.width, height: placement.height },
  } as ExcelJS.ImagePosition);
}

/**
 * Writes one entry's row block using its precomputed layout: the header
 * row (No/Uraian/Volume Terpasang/Volume Awal/Deviasi), one row per
 * Volume Bagian component (each with its own optional detail image right
 * below it), and the entry's own overview image last. Volume Terpasang is
 * a live =SUM(...) over the component rows' Volume Bagian cells — never a
 * static number; image-only rows in between contribute 0 to that SUM, so
 * they don't need to be excluded from the range.
 */
function writeEntry(
  sheet: ExcelJS.Worksheet,
  workbook: ExcelJS.Workbook,
  entry: EntryInput,
  entryIndex: number,
  layout: EntryLayout,
  componentRowOfEntry: Map<number, number>, // entryIndex -> its header row, for cross-refs
  entryResults: number[] // entryIndex -> resolved Volume Terpasang total, for cached formula results
): void {
  const entryHeaderRow = layout.headerRow;
  sheet.getCell(`${COL.no}${entryHeaderRow}`).value = entry.no;
  sheet.getCell(`${COL.no}${entryHeaderRow}`).alignment = { horizontal: "center", vertical: "top" };

  sheet.mergeCells(`${COL.uraian}${entryHeaderRow}:${URAIAN_MERGE_END}${entryHeaderRow}`);
  const uraianCell = sheet.getCell(`${COL.uraian}${entryHeaderRow}`);
  uraianCell.value = entry.uraian;
  uraianCell.font = { bold: true };
  uraianCell.alignment = { wrapText: true, vertical: "top" };
  if (entry.notasi) sheet.getCell(`${COL.notasi}${entryHeaderRow}`).value = entry.notasi;

  entry.components.forEach((comp, ci) => {
    const row = layout.componentDataRows[ci];
    const componentResult = computeComponentResult(comp, entryResults);

    if (comp.formulaRumus === CROSS_REFERENCE_RUMUS) {
      const refHeaderRow =
        comp.sameAsEntryIndex != null ? componentRowOfEntry.get(comp.sameAsEntryIndex) : undefined;
      sheet.getCell(`${COL.rumus}${row}`).value = CROSS_REFERENCE_RUMUS;
      sheet.getCell(`${COL.volumeBagian}${row}`).value = refHeaderRow
        ? { formula: `${COL.volumeTerpasang}${refHeaderRow}`, result: componentResult }
        : componentResult;
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
      sheet.getCell(`${COL.volumeBagian}${row}`).value = { formula: signedFormula, result: componentResult };
    }

    sheet.getCell(`${COL.volumeBagian}${row}`).numFmt = NUMERIC_FMT;
    if (comp.sat) sheet.getCell(`${COL.sat}${row}`).value = comp.sat;
    if (comp.ket) sheet.getCell(`${COL.ket}${row}`).value = comp.ket;

    const placement = layout.componentImagePlacements[ci];
    if (comp.imageBuffer && placement) {
      placeImage(sheet, workbook, comp.imageBuffer, comp.imageExtension, placement);
    }
  });

  const firstComponentRow = layout.componentDataRows[0];
  const lastComponentRow = layout.componentDataRows[layout.componentDataRows.length - 1];
  const volumeTerpasangResult = entryResults[entryIndex] ?? 0;
  // Volume Terpasang = live SUM over this entry's own Volume Bagian rows —
  // the generated output the whole system exists to produce correctly.
  // Carries a cached `result` (see resolveEntryResults) so it displays
  // right away even if Excel never gets to recalculate it.
  const volumeTerpasangCell = sheet.getCell(`${COL.volumeTerpasang}${entryHeaderRow}`);
  volumeTerpasangCell.value =
    firstComponentRow != null
      ? {
          formula: `SUM(${COL.volumeBagian}${firstComponentRow}:${COL.volumeBagian}${lastComponentRow})`,
          result: volumeTerpasangResult,
        }
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
      result: volumeTerpasangResult - entry.volumeAwal,
    };
    deviasiCell.font = { bold: true };
    deviasiCell.numFmt = NUMERIC_FMT;
    deviasiCell.alignment = { horizontal: "center", vertical: "top" };
  }

  if (entry.imageBuffer && layout.mainImage) {
    placeImage(sheet, workbook, entry.imageBuffer, entry.imageExtension, layout.mainImage);
  }
}

export async function generateBvAwalWorkbook(input: GenerateWorkbookInput): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BV AWAL Generator";
  workbook.created = new Date();
  // ExcelJS writes formula cells with no cached result. Without this,
  // Excel has nothing to display until the user forces a recalculation
  // (F9) — every Volume Bagian/Terpasang/Deviasi cell would show blank on
  // first open, which is exactly the bug this fixes.
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet("BV AWAL");
  writeHeader(sheet, input.projectName);

  // Plan every row up front — banner rows (category/sub-category, printed
  // whenever they change from the previous entry, matching the reference
  // sheet's grouping) and each entry's full layout (header, component
  // rows, each component's own image, the entry's overview image) —
  // computed exactly once, so "how many rows does this entry take" can't
  // diverge between a reservation pass and a writing pass. "sama dengan
  // <item>" cross-refs (which may point forward or backward) need every
  // entry's header row resolved before any cell is written.
  let currentRow = FIRST_DATA_ROW;
  const entryLayouts: EntryLayout[] = [];
  const banners: { row: number; label: string; kind: "category" | "subcategory" }[] = [];
  let lastCategory: string | null | undefined;
  let lastSubcategory: string | null | undefined;
  input.entries.forEach((entry) => {
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

    const layout = planEntry(entry, currentRow);
    entryLayouts.push(layout);
    currentRow = layout.nextRow;
  });
  const componentRowOfEntry = new Map<number, number>();
  entryLayouts.forEach((layout, i) => componentRowOfEntry.set(i, layout.headerRow));
  const entryResults = resolveEntryResults(input.entries);

  for (const banner of banners) writeBanner(sheet, banner.row, banner.label, banner.kind);

  input.entries.forEach((entry, i) => {
    writeEntry(sheet, workbook, entry, i, entryLayouts[i], componentRowOfEntry, entryResults);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
