import { describe, expect, it } from "vitest";
import type { Report } from "../data/types";
import { crc32, reportToCsv, reportToXlsx } from "./export";

const report: Report = {
  id: "ventas_producto", title: "Ventas por producto", description: "", from: "2026-10-01", to: "2026-10-31", uses_period: true,
  columns: [
    { key: "producto", label: "Producto", kind: "text" }, { key: "cantidad", label: "Cantidad", kind: "qty" },
    { key: "neto", label: "Neto", kind: "money" }, { key: "pct", label: "Margen %", kind: "pct" }, { key: "fecha", label: "Fecha", kind: "date" },
  ],
  rows: [["Taladro; 18 V \"pro\"", 2500, 64990, 365432, "2026-10-05"], ["Martillo", 1000, 6990, null, null]],
  totals: ["Total", null, 71980, 400000, null], links: [null, null], kpis: [], notes: ["Nota de prueba"], chart: null,
};

describe("exportar reportes", () => {
  it("CRC-32 estándar", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("CSV con punto y coma, BOM y números chilenos", () => {
    const bytes = reportToCsv(report);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("Producto;Cantidad;Neto;Margen %;Fecha");
    expect(lines[1]).toBe('"Taladro; 18 V ""pro""";2,5;64990;36,54;05-10-2026');
    expect(lines[3]).toBe("Total;;71980;40;");
  });
  it("XLSX es un ZIP válido con la hoja", () => {
    const z = reportToXlsx(report, "Ferretería");
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(z);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("<v>2.5</v>");
    expect(text).toContain("<v>0.365432</v>");
  });
});
