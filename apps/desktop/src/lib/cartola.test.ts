import { describe, expect, it } from "vitest";
import { parseAmount, parseBankDate, parseCsv, parseHtmlTable, parseRows, parseXlsx } from "./cartola";
import { reportToXlsx } from "./export";
import type { Report } from "../data/types";

const TODAY = "2026-10-17";

describe("montos y fechas de cartolas", () => {
  it("lee montos chilenos y con signo", () => {
    expect(parseAmount("1.234.567")).toBe(1234567);
    expect(parseAmount("-35.990")).toBe(-35990);
    expect(parseAmount("(1.200)")).toBe(-1200);
    expect(parseAmount("$ 12.500,00")).toBe(12500);
    expect(parseAmount("1,234.50")).toBe(1235);
    expect(parseAmount("9990")).toBe(9990);
    expect(parseAmount("12,5")).toBe(13);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("lee fechas en varios formatos", () => {
    expect(parseBankDate("31/10/2025", TODAY)).toBe("2025-10-31");
    expect(parseBankDate("05-10-26", TODAY)).toBe("2026-10-05");
    expect(parseBankDate("2026-10-05", TODAY)).toBe("2026-10-05");
    expect(parseBankDate("15/12", TODAY)).toBe("2025-12-15");
    expect(parseBankDate("03/10", TODAY)).toBe("2026-10-03");
    expect(parseBankDate("05 oct 2026", TODAY)).toBe("2026-10-05");
    expect(parseBankDate("46300", TODAY)).toBe("2026-10-05");
    expect(parseBankDate("31/02/2026", TODAY)).toBeNull();
    expect(parseBankDate("Saldo", TODAY)).toBeNull();
  });
});

describe("cartolas", () => {
  it("CSV con cargos y abonos, encabezado después de unas filas", () => {
    const csv = [
      "Cartola de Cuenta Corriente;;;;;",
      "Titular: Ferretería Los Andes SpA;;;;;",
      "",
      "Fecha;Descripción;N° Documento;Cargos;Abonos;Saldo",
      "01/10/2026;SALDO INICIAL;;;;1.000.000",
      '02/10/2026;"COMPRA COPEC; LOS LAGOS";123;35.990;;964.010',
      "03/10/2026;TRANSF DE CLINICA LOS LAGOS;;;119.000;1.083.010",
      ";Total;;35.990;119.000;",
    ].join("\r\n");
    const p = parseRows(parseCsv(csv), TODAY);
    expect(p.lines).toEqual([
      { date: "2026-10-02", description: "COMPRA COPEC; LOS LAGOS", reference: "123", amount_minor: -35990, balance_minor: 964010 },
      { date: "2026-10-03", description: "TRANSF DE CLINICA LOS LAGOS", reference: null, amount_minor: 119000, balance_minor: 1083010 },
    ]);
    expect(p.skipped).toBe(2);
    expect(p.columns).toContain("Descripción");
  });
  it("monto único con columna de tipo", () => {
    const csv = "Fecha,Detalle,Monto,Cargo/Abono\n05-10-2026,PAC ENTEL,9.990,C\n06-10-2026,DEPOSITO,50.000,A";
    const p = parseRows(parseCsv(csv), TODAY);
    expect(p.lines.map((l) => l.amount_minor)).toEqual([-9990, 50000]);
  });
  it("monto con signo", () => {
    const p = parseRows(parseCsv("fecha\tglosa\tmonto\n2026-10-01\tComisión\t-1.200\n"), TODAY);
    expect(p.lines[0]).toMatchObject({ description: "Comisión", amount_minor: -1200 });
  });
  it("tabla HTML disfrazada de .xls", () => {
    const html = "<table><tr><th>Fecha</th><th>Descripci&oacute;n</th><th>Cargo</th><th>Abono</th></tr><tr><td>07/10/2026</td><td>PAGO&nbsp;ARRIENDO</td><td>50.000</td><td></td></tr></table>";
    const p = parseRows(parseHtmlTable(html), TODAY);
    expect(p.lines[0]).toMatchObject({ date: "2026-10-07", description: "PAGO ARRIENDO", amount_minor: -50000 });
  });
  it("sin encabezados reconocibles", () => {
    expect(() => parseRows([["a", "b"], ["1", "2"]], TODAY)).toThrow(/encabezados/);
  });
  it("Excel .xlsx (hecho con el exportador de NÚCLEO)", async () => {
    const rep: Report = {
      id: "x", title: "Cartola", description: "", from: TODAY, to: TODAY, uses_period: false,
      columns: [{ key: "f", label: "Fecha", kind: "text" }, { key: "d", label: "Descripción", kind: "text" }, { key: "c", label: "Cargos", kind: "money" }, { key: "a", label: "Abonos", kind: "money" }],
      rows: [["08/10/2026", "COMPRA SODIMAC", 25000, null], ["09/10/2026", "DEPOSITO", null, 70000]], totals: null, links: [], kpis: [], notes: [], chart: null,
    };
    const bytes = reportToXlsx(rep, "Prueba");
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const p = parseRows(await parseXlsx(ab), TODAY);
    expect(p.lines.map((l) => [l.date, l.amount_minor])).toEqual([["2026-10-08", -25000], ["2026-10-09", 70000]]);
  });
});
