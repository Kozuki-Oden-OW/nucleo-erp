// Borrador del F29 — espejo exacto de `nucleo-domain/src/f29.rs` (mismas reglas y enteros).
// Lo usan la vista previa en vivo y el backend de demostración; `golden/f29.json` se ejecuta contra
// ambas implementaciones. Ninguna tasa está escrita aquí.

export type Direction = "venta" | "compra";
export type PurchaseKind = "giro" | "supermercado" | "activo_fijo" | "uso_comun" | "sin_derecho" | "bien_raiz";
export interface TaxDoc {
  direction: Direction; sii_type: number; count?: number; exempt?: number; net?: number; tax?: number;
  tax_non_recoverable?: number; common_use_tax?: number; kind?: PurchaseKind | null; not_of_business?: boolean;
}
export interface Remnant { amount: number; utm_prev: number; utm_cur: number; utm_decimals?: number | null }
export interface Ppm { rate_ppm: number; credit?: number; loss?: boolean; base_override?: number | null }
export interface F29Input { docs?: TaxDoc[]; remnant?: Remnant | null; ppm?: Ppm | null; common_use_ppm?: number | null; manual?: Record<string, number> }
export type Severity = "info" | "aviso" | "falta";
export interface F29Note { code: number | null; severity: Severity; text: string }
export interface F29Result { codes: Record<string, number>; notes: F29Note[]; complete: boolean }

export const MANUAL_CODES = [48, 151, 49, 155, 50, 153, 156] as const;

const B = BigInt;
function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) { n = -n; d = -d; }
  return n >= 0n ? (n + d / 2n) / d : -((-n + d / 2n) / d);
}
const mulDiv = (a: number, b: number, d: number) => Number(divRound(B(a) * B(b), B(d)));

function ppmSign(t: number): number {
  if ([30, 33, 32, 34, 35, 38, 39, 41, 48, 55, 56, 110, 111].includes(t)) return 1;
  if ([60, 61, 112].includes(t)) return -1;
  return 0;
}

export function computeF29(input: F29Input): F29Result {
  const codes = new Map<number, number>();
  const add = (c: number, v: number) => codes.set(c, (codes.get(c) ?? 0) + v);
  const get = (c: number) => codes.get(c) ?? 0;
  const notes: F29Note[] = [];
  const note = (code: number | null, severity: Severity, text: string) => { if (!notes.some((n) => n.text === text)) notes.push({ code, severity, text }); };
  let complete = true;
  let commonUseTax = 0, commonUseDocs = 0, ppmBase = 0;
  const unsupported = new Map<number, number>();
  const skip = (t: number, n: number) => unsupported.set(t, (unsupported.get(t) ?? 0) + n);

  for (const d of input.docs ?? []) {
    const n = d.count ?? 1, net = d.net ?? 0, ex = d.exempt ?? 0, tax = d.tax ?? 0, t = d.sii_type, nob = !!d.not_of_business;
    if (d.direction === "venta") {
      if (!nob) ppmBase += ppmSign(t) * (net + ex);
      if ((t === 30 || t === 33) && !nob) { add(503, n); add(502, tax); }
      else if (t === 30 || t === 33) { add(716, n); add(717, tax); }
      else if ([32, 34, 38, 41].includes(t) && !nob) { add(586, n); add(142, ex + net); }
      else if ([32, 34, 38, 41].includes(t)) { add(714, n); add(715, ex + net); }
      else if (t === 35 || t === 39) { add(110, n); add(111, tax); }
      else if (t === 48) { add(758, n); add(759, tax); }
      else if (t === 55 || t === 56) { add(512, n); add(513, tax); }
      else if ((t === 60 || t === 61) && !nob) { add(509, n); add(510, tax); }
      else if (t === 60 || t === 61) { add(733, n); add(734, tax); }
      else if (t === 110 || t === 111) { add(585, n); add(20, ex + net); }
      else if (t === 112) { add(585, n); add(20, -(ex + net)); }
      else skip(t, n);
    } else {
      if (t === 30 || t === 33) {
        const k = d.kind ?? "giro";
        if (k === "giro") {
          add(519, n); add(520, tax);
          if ((d.tax_non_recoverable ?? 0) > 0 && tax === 0) note(520, "aviso", "Hay facturas con IVA no recuperable marcadas como del giro: revisa su clasificación.");
        } else if (k === "supermercado") { add(761, n); add(762, tax); }
        else if (k === "activo_fijo") { add(524, n); add(525, tax); }
        else if (k === "uso_comun") { add(519, n); add(520, tax); commonUseTax += d.common_use_tax ?? 0; commonUseDocs += n; }
        else if (k === "sin_derecho") { add(564, n); add(521, net + ex); }
        else skip(t, n);
      } else if (t === 32 || t === 34) { add(584, n); add(562, ex + net); }
      else if (t === 55 || t === 56) { add(531, n); add(532, tax); }
      else if (t === 60 || t === 61) { add(527, n); add(528, tax); }
      else if (t === 914) {
        const k = d.kind ?? "giro";
        if (k === "activo_fijo") { add(536, n); add(553, tax); }
        else if (k === "sin_derecho") { add(566, n); add(560, net + ex); }
        else { add(534, n); add(535, tax); }
      } else if ([35, 38, 39, 41].includes(t)) { /* boletas recibidas: no dan crédito */ }
      else skip(t, n);
    }
  }
  for (const [t, n] of [...unsupported].sort((a, b) => a[0] - b[0])) note(null, "aviso", `${n} documento(s) de tipo ${t} no se incluyen en el borrador: complétalos tú en sii.cl.`);

  if (commonUseTax > 0) {
    if (input.common_use_ppm != null) {
      const credit = mulDiv(commonUseTax, input.common_use_ppm, 1_000_000);
      add(520, credit);
      note(520, "info", `IVA de uso común de ${commonUseDocs} documento(s): se acreditan $${credit} de $${commonUseTax} según la proporción indicada.`);
    } else {
      complete = false;
      note(520, "falta", `Hay $${commonUseTax} de IVA de uso común: indica la proporción con derecho a crédito (la define tu contador).`);
    }
  }

  const r = input.remnant;
  if (r && r.amount > 0) {
    if (r.utm_prev <= 0 || r.utm_cur <= 0) {
      complete = false;
      note(504, "falta", "Falta la UTM del mes anterior o la de este mes para reajustar el remanente.");
    } else if (r.utm_decimals == null) add(504, mulDiv(r.amount, r.utm_cur, r.utm_prev));
    else {
      const s = 10n ** B(r.utm_decimals);
      const scaled = divRound(B(r.amount) * s, B(r.utm_prev));
      add(504, Number(divRound(scaled * B(r.utm_cur), s)));
    }
  }

  const debit = get(502) + get(717) + get(111) + get(759) + get(513) - get(510) - get(734);
  const credit = get(520) + get(762) + get(525) - get(528) + get(532) + get(535) + get(553) + get(504);
  codes.set(538, debit); codes.set(537, credit);
  if (credit > debit) { codes.set(77, credit - debit); codes.set(89, 0); } else { codes.set(77, 0); codes.set(89, debit - credit); }

  let ppmAmount = 0;
  const p = input.ppm;
  if (p && p.loss) {
    codes.set(30, 1);
    note(62, "info", "Pérdida tributaria declarada: el PPM queda suspendido este mes.");
  } else if (p) {
    const base = Math.max(p.base_override ?? ppmBase, 0);
    ppmAmount = Math.max(mulDiv(base, p.rate_ppm, 1_000_000) - (p.credit ?? 0), 0);
    codes.set(563, base); codes.set(115, p.rate_ppm);
    if ((p.credit ?? 0) > 0) codes.set(68, p.credit!);
    codes.set(62, ppmAmount);
  } else if (ppmBase > 0) {
    complete = false;
    note(62, "falta", "Falta la tasa de PPM de la empresa (la ves en sii.cl o te la indica tu contador).");
  }

  let manualSum = 0;
  for (const c of MANUAL_CODES) {
    const v = input.manual?.[String(c)] ?? 0;
    if (v !== 0) { codes.set(c, v); manualSum += v; }
  }
  const subtotal = get(89) + manualSum + ppmAmount;
  codes.set(595, subtotal); codes.set(547, subtotal); codes.set(91, Math.max(subtotal, 0));

  const keep = new Set([538, 537, 89, 77, 595, 547, 91]);
  const out: Record<string, number> = {};
  for (const [k, v] of [...codes].sort((a, b) => a[0] - b[0])) if (v !== 0 || keep.has(k)) out[String(k)] = v;
  return { codes: out, notes, complete };
}

/** Nombre corto de cada código del F29 que NÚCLEO llena (instrucciones del SII, nov-2024). */
export const F29_LABEL: Record<number, string> = {
  585: "Exportaciones (cantidad)", 20: "Exportaciones (monto neto)",
  586: "Ventas exentas del giro (cantidad)", 142: "Ventas exentas del giro (neto)",
  714: "Ventas exentas no del giro (cantidad)", 715: "Ventas exentas no del giro (neto)",
  503: "Facturas emitidas (cantidad)", 502: "IVA de facturas emitidas",
  716: "Facturas no del giro (cantidad)", 717: "IVA de facturas no del giro",
  110: "Boletas (cantidad)", 111: "IVA de boletas",
  758: "Comprobantes de pago electrónico (cantidad)", 759: "IVA de comprobantes de pago electrónico",
  512: "Notas de débito emitidas (cantidad)", 513: "IVA de notas de débito emitidas",
  509: "Notas de crédito emitidas (cantidad)", 510: "IVA de notas de crédito emitidas",
  733: "Notas de crédito no del giro (cantidad)", 734: "IVA de notas de crédito no del giro",
  538: "Total débitos",
  564: "Compras sin derecho a crédito (cantidad)", 521: "Compras sin derecho a crédito (neto)",
  566: "Importaciones sin derecho a crédito (cantidad)", 560: "Importaciones sin derecho a crédito (neto)",
  584: "Compras exentas (cantidad)", 562: "Compras exentas (neto)",
  519: "Facturas recibidas del giro (cantidad)", 520: "IVA de facturas recibidas del giro",
  761: "Facturas de supermercados (cantidad)", 762: "IVA de facturas de supermercados",
  524: "Facturas de activo fijo (cantidad)", 525: "IVA de facturas de activo fijo",
  527: "Notas de crédito recibidas (cantidad)", 528: "IVA de notas de crédito recibidas",
  531: "Notas de débito recibidas (cantidad)", 532: "IVA de notas de débito recibidas",
  534: "Declaraciones de ingreso del giro (cantidad)", 535: "IVA de importaciones del giro",
  536: "Declaraciones de ingreso de activo fijo (cantidad)", 553: "IVA de importaciones de activo fijo",
  504: "Remanente del mes anterior (reajustado)", 537: "Total créditos",
  77: "Remanente para el mes siguiente", 89: "IVA determinado",
  50: "Retención art. 20 N°2", 48: "Impuesto único de segunda categoría", 151: "Retención de honorarios",
  153: "Retención a directores", 49: "Retención 3 % préstamo tasa 0 (trabajadores)", 155: "Retención 3 % préstamo tasa 0 (honorarios)",
  30: "Pérdida tributaria (suspende el PPM)", 563: "Base imponible del PPM", 115: "Tasa del PPM", 68: "Crédito imputable al PPM",
  62: "PPM neto determinado", 156: "Aumento 3 % del PPM (préstamo tasa 0)",
  595: "Subtotal impuesto determinado", 547: "Total determinado", 91: "Total a pagar dentro del plazo",
};

/** Códigos que se muestran como cantidad (no como pesos). */
export const F29_COUNT_CODES = new Set([585, 586, 714, 503, 716, 110, 758, 512, 509, 733, 564, 566, 584, 519, 761, 524, 527, 531, 534, 536]);

/** Tipos de documento del SII más comunes. */
export const SII_DOC_TYPE: Record<number, string> = {
  30: "Factura", 32: "Factura exenta", 33: "Factura electrónica", 34: "Factura exenta electrónica", 35: "Boleta", 38: "Boleta exenta",
  39: "Boleta electrónica", 41: "Boleta exenta electrónica", 45: "Factura de compra", 46: "Factura de compra electrónica",
  48: "Comprobante de pago electrónico", 55: "Nota de débito", 56: "Nota de débito electrónica", 60: "Nota de crédito",
  61: "Nota de crédito electrónica", 110: "Factura de exportación", 111: "Nota de débito de exportación", 112: "Nota de crédito de exportación",
  914: "Declaración de ingreso (DIN)",
};
