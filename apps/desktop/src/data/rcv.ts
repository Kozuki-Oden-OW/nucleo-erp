// Lectura del Registro de Compras y Ventas del SII (CSV) — espejo de `nucleo-io/src/rcv.rs`.
// Lo usa el backend de demostración; el escritorio lee el archivo en Rust.
import type { PurchaseKind } from "./f29";

export interface RcvRow {
  sii_type: number; folio: string | null; counterpart_rut: string | null; counterpart_name: string | null; issue_date: string | null;
  count: number; exempt: number; net: number; tax: number; tax_non_recoverable: number; common_use_tax: number; fixed_asset: boolean;
  total: number; operation_type: string | null;
}
export interface RcvFile { rows: RcvRow[]; skipped: [number, string][] }

const norm = (h: string) => h.trim().replace(/^﻿/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"' && quoted && line[i + 1] === '"') { cur += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function amount(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const neg = t.startsWith("-");
  let intPart = t;
  const i = t.lastIndexOf(",");
  if (i >= 0 && /^\d{1,2}$/.test(t.slice(i + 1))) intPart = t.slice(0, i);
  const digits = intPart.replace(/\D/g, "");
  const v = digits ? Number(digits) : 0;
  return neg ? -v : v;
}

function date(s: string): string | null {
  const first = s.trim().split(/\s+/)[0] ?? "";
  const p = first.split(/[/-]/);
  if (p.length !== 3) return null;
  const [d, m, y] = p[0]!.length === 4 ? [p[2]!, p[1]!, p[0]!] : [p[0]!, p[1]!, p[2]!];
  const dd = Number(d), mm = Number(m), yy = Number(y);
  if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy >= 1900)) return null;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function parseRcv(text: string): RcvFile {
  const lines = text.split(/\r?\n/).map((l, i) => [i, l] as const).filter(([, l]) => l.trim());
  if (!lines.length) throw new Error("el archivo está vacío");
  const header = lines[0]![1];
  const sep = [";", "\t", ","].reduce((best, c) => (header.split(c).length > header.split(best).length ? c : best), ";");
  const idx = splitLine(header, sep).map(norm);
  const find = (prefixes: string[]): number | null => {
    for (const p of prefixes) { const i = idx.indexOf(p); if (i >= 0) return i; }
    for (const p of prefixes) { const i = idx.findIndex((h) => h.startsWith(p)); if (i >= 0) return i; }
    return null;
  };
  const cType = find(["tipodoc", "tipodocumento", "tipodte"]);
  if (cType === null) throw new Error("no parece un registro de compras o ventas del SII: falta la columna «Tipo Doc»");
  const c = {
    folio: find(["folio"]), rut: find(["rutproveedor", "rutcliente", "rutcontraparte", "rut"]), name: find(["razonsocial"]),
    date: find(["fechadocto", "fechaemision", "fechadocumento", "fecha"]), exempt: find(["montoexento"]), net: find(["montoneto"]),
    tax: find(["montoivarecuperable", "montoiva", "iva"]), nonrec: find(["montoivanorecuperable", "montoivanorec"]), common: find(["ivausocomun"]),
    faNet: find(["montonetoactivofijo", "montoactivofijo"]), faTax: find(["ivaactivofijo", "montoivaactivofijo"]), total: find(["montototal"]),
    count: find(["totaldocumentos", "cantidaddocumentos", "cantidad"]), op: find(["tipocompra", "tipoventa", "tipotransaccion"]),
  };
  if (c.net === null && c.exempt === null) throw new Error("no parece un registro de compras o ventas del SII: falta la columna «Monto Neto»");
  const rows: RcvRow[] = [];
  const skipped: [number, string][] = [];
  for (const [n, line] of lines.slice(1)) {
    const f = splitLine(line, sep);
    const get = (i: number | null) => (i === null ? "" : f[i] ?? "");
    const raw = get(cType);
    const m = raw.match(/\d+/);
    if (!m) { skipped.push([n + 1, `sin tipo de documento («${raw}»)`]); continue; }
    const faTax = amount(get(c.faTax));
    let tax = amount(get(c.tax));
    if (tax === 0 && faTax > 0) tax = faTax;
    const opt = (i: number | null) => get(i) || null;
    rows.push({
      sii_type: Number(m[0]), folio: opt(c.folio), counterpart_rut: opt(c.rut), counterpart_name: opt(c.name), issue_date: date(get(c.date)),
      count: Math.max(amount(get(c.count)), 1), exempt: amount(get(c.exempt)), net: amount(get(c.net)), tax,
      tax_non_recoverable: amount(get(c.nonrec)), common_use_tax: amount(get(c.common)), fixed_asset: faTax > 0 || amount(get(c.faNet)) > 0,
      total: amount(get(c.total)), operation_type: opt(c.op),
    });
  }
  return { rows, skipped };
}

export function rcvPurchaseKind(r: RcvRow): PurchaseKind {
  const op = norm(r.operation_type ?? "");
  if (r.fixed_asset || op.includes("activo") || op === "4") return "activo_fijo";
  if (op.includes("super") || op === "2") return "supermercado";
  if (op.includes("bienraiz") || op.includes("bienesraices") || op === "3") return "bien_raiz";
  if (r.common_use_tax > 0 || op.includes("comun") || op === "5") return "uso_comun";
  if ((r.tax === 0 && r.tax_non_recoverable > 0) || op.includes("sinderecho") || op.includes("norecuperable") || op === "6") return "sin_derecho";
  return "giro";
}

export function rcvSaleNotOfBusiness(r: RcvRow): boolean {
  const op = norm(r.operation_type ?? "");
  return op.includes("activo") || op.includes("raiz") || op.includes("raices");
}

/** Tipo de documento del SII desde el texto anotado ("Factura", "Boleta"…); `null` = no tributario. */
export function siiTypeFromText(kind: string | null, tax: number, exempt: number): number | null {
  const k = (kind ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = k.split(/\s+/);
  if (k.includes("credito") || words.includes("nc")) return 61;
  if (k.includes("debito") || words.includes("nd")) return 56;
  if (k.includes("guia")) return null;
  if (k.includes("boleta")) return tax > 0 ? 39 : 41;
  if (k.includes("export")) return 110;
  if (k.includes("comprobante") || k.includes("voucher")) return 48;
  if (k.includes("exent") || (tax <= 0 && exempt > 0)) return 34;
  return 33;
}
