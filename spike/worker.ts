import ExcelJS from "exceljs";

export default {
  async fetch(): Promise<Response> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("BV AWAL");

    sheet.getCell("B2").value = "Panjang";
    sheet.getCell("C2").value = 3.391;
    sheet.getCell("B3").value = "Lebar";
    sheet.getCell("C3").value = 1.853;
    sheet.getCell("B4").value = "Volume Terpasang";
    sheet.getCell("C4").value = { formula: "PRODUCT(C2:C3)", result: undefined };

    // 1x1 red PNG pixel, base64 - stand-in for an embedded blueprint image
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";
    const imageId = workbook.addImage({ base64: pngBase64, extension: "png" });
    sheet.addImage(imageId, "E2:F4");

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="spike.xlsx"',
      },
    });
  },
};
