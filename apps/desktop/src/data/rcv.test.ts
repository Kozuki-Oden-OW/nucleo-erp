import { describe, expect, it } from "vitest";
import { parseRcv, rcvPurchaseKind, rcvSaleNotOfBusiness, siiTypeFromText } from "./rcv";

// Mismos casos que nucleo-io/src/rcv.rs.
const COMPRAS = "﻿Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse;Monto Exento;Monto Neto;Monto IVA Recuperable;Monto Iva No Recuperable;Codigo IVA No Rec.;Monto Total;Monto Neto Activo Fijo;IVA Activo Fijo;IVA uso Comun;Impto. Sin Derecho a Credito;IVA No Retenido\n" +
  "1;33;Del Giro;76123456-7;Proveedor Uno SpA;1500;05/09/2026 00:00:00;06/09/2026 10:00:00;;0;100000;19000;0;;119000;0;0;0;0;0\n" +
  "2;33;Activo Fijo;76987654-3;Computadores Ltda;77;10/09/2026;;;0;1000000;0;0;;1190000;1000000;190000;0;0;0\n" +
  "3;61;Del Giro;76123456-7;Proveedor Uno SpA;20;12/09/2026;;;0;10000;1900;0;;11900;0;0;0;0;0\n" +
  "4;33;Del Giro;77111222-3;Restaurante;9;15/09/2026;;;0;50000;0;9500;3;59500;0;0;0;0;0\n" +
  ";;;;;;;;;;Total;;;;;;;;;\n";

describe("Registro de compras y ventas del SII", () => {
  it("lee compras", () => {
    const f = parseRcv(COMPRAS);
    expect(f.rows.length).toBe(4);
    expect(f.skipped.length).toBe(1);
    expect(f.rows[0]!.issue_date).toBe("2026-09-05");
    expect([f.rows[0]!.net, f.rows[0]!.tax, f.rows[0]!.total]).toEqual([100_000, 19_000, 119_000]);
    expect(f.rows.map(rcvPurchaseKind)).toEqual(["giro", "activo_fijo", "giro", "sin_derecho"]);
    expect(f.rows[1]!.tax).toBe(190_000);
  });
  it("lee ventas con montos con puntos y comillas", () => {
    const f = parseRcv("Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Monto Exento;Monto Neto;Monto IVA;Monto total\n" +
      '1;33;Del Giro;"77.334.963-0";"Cliente; con punto y coma";100;01-09-2026;0;1.000.000;190.000;1.190.000\n2;34;Activo Fijo;1-9;Otro;101;2026-09-02;50000;0;0;50000\n');
    expect(f.rows[0]!.counterpart_name).toBe("Cliente; con punto y coma");
    expect([f.rows[0]!.net, f.rows[0]!.tax]).toEqual([1_000_000, 190_000]);
    expect(rcvSaleNotOfBusiness(f.rows[1]!)).toBe(true);
  });
  it("rechaza un archivo cualquiera y reconoce tipos anotados", () => {
    expect(() => parseRcv("")).toThrow();
    expect(() => parseRcv("nombre,precio\nA,1")).toThrow(/Tipo Doc/);
    expect(siiTypeFromText("Nota de crédito", 19, 0)).toBe(61);
    expect(siiTypeFromText("Guía de despacho", 19, 0)).toBeNull();
    expect(siiTypeFromText("Boleta", 19, 0)).toBe(39);
  });
});
