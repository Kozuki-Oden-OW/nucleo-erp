// Condiciones de la venta: catálogos y reglas compartidas por la interfaz y la demostración.
// Mismas reglas que nucleo-app::sale_terms (Rust), que valida al guardar en el escritorio.
import { addDays } from "../lib/format";
import { AppError } from "./backend";
import type { Customer, Receiver, SaleDocument, SaleTerms, Transport } from "./types";

/** Documento tributario de la venta: lo primero que se elige en «Nueva venta». */
export const DOCUMENTS: { value: Exclude<SaleDocument, "">; label: string; sii: string; hint: string }[] = [
  { value: "boleta", label: "Boleta", sii: "Boleta electrónica", hint: "Venta a público o consumidor final. No necesita los datos del cliente." },
  { value: "factura", label: "Factura", sii: "Factura electrónica", hint: "Venta a una empresa o persona con giro. Lleva receptor, referencias y forma de pago." },
  { value: "guia", label: "Guía de despacho", sii: "Guía de despacho electrónica", hint: "Acompaña la mercadería. Se factura después o respalda un traslado." },
];
export const documentLabel = (d: string | null | undefined) => DOCUMENTS.find((x) => x.value === d)?.label ?? null;

/** «Tipo de compra» del receptor, con el texto y el orden del facturador del SII. */
export const PURCHASE_KINDS: { value: number; label: string }[] = [
  { value: 1, label: "Del Giro" }, { value: 2, label: "Supermercados" }, { value: 3, label: "Venta de Bienes inmuebles, 'BBRR'" },
  { value: 4, label: "Activo Fijo" }, { value: 5, label: "IVA Uso Común" }, { value: 6, label: "IVA no Recuperable" },
  { value: 7, label: "No Corresponde incluir" },
];
/** «Tipo Traslado» de la guía de despacho, con el texto y el orden del SII. */
export const TRANSFER_KINDS: { value: number; label: string }[] = [
  { value: 1, label: "Operación constituye venta" }, { value: 2, label: "Ventas por efectuar" }, { value: 3, label: "Consignaciones" },
  { value: 4, label: "Entrega Gratuita" }, { value: 5, label: "Traslados internos" }, { value: 6, label: "Otros traslados no venta" },
  { value: 7, label: "Guía de devolución" }, { value: 8, label: "Traslado para exportación (no venta)" }, { value: 9, label: "Venta para exportación" },
];
export const EMPTY_TRANSPORT: Transport = { rut: null, plate: null, driver_rut: null, driver_name: null };

/** Forma de pago como la pide el SII: Contado o Crédito. */
export const siiPayment = (t: SaleTerms | null | undefined): "Contado" | "Crédito" | null =>
  !t?.payment ? null : t.payment === "credito" ? "Crédito" : "Contado";

/** Largo del campo «Detalle» de la e-Boleta del SII. */
export const EBOLETA_DETAIL_MAX = 80;
/**
 * «Detalle» de la e-Boleta: productos y cantidades vendidas, como «7 X RC-5+, 8 X RC-51H». Si no
 * cabe en 80 caracteres se acortan los nombres por igual; lo que aun así sobre se resume al final.
 */
export function eboletaDetail(lines: { description: string; qty_milli: number }[]): string {
  const qty = (m: number) => String(m / 1000).replace(".", ",");
  const items = lines.map((l) => ({ q: qty(l.qty_milli), name: l.description.replace(/\s+/g, " ").trim() }));
  const build = (max: number) => items.map((i) => `${i.q} X ${i.name.length > max ? i.name.slice(0, max).trim() : i.name}`).join(", ");
  for (let max = 60; max >= 6; max--) { const t = build(max); if (t.length <= EBOLETA_DETAIL_MAX) return t; }
  // Demasiadas líneas: las que quepan y el resto contado.
  const out: string[] = [];
  for (const [n, i] of items.entries()) {
    const rest = items.length - n - 1;
    const part = `${i.q} X ${i.name.slice(0, 10).trim()}`;
    const tail = rest > 0 ? ` y ${rest} más` : "";
    if ([...out, part].join(", ").length + tail.length > EBOLETA_DETAIL_MAX) return `${out.join(", ")} y ${items.length - n} más`.slice(0, EBOLETA_DETAIL_MAX);
    out.push(part);
  }
  return out.join(", ");
}

const GRAN_SANTIAGO = new Set([
  "cerrillos", "cerro navia", "conchali", "el bosque", "estacion central", "huechuraba", "independencia", "la cisterna", "la florida", "la granja",
  "la pintana", "la reina", "las condes", "lo barnechea", "lo espejo", "lo prado", "macul", "maipu", "nunoa", "pedro aguirre cerda", "penalolen",
  "providencia", "pudahuel", "quilicura", "quinta normal", "recoleta", "renca", "san joaquin", "san miguel", "san ramon", "santiago", "vitacura",
  "puente alto", "san bernardo",
]);
/** Ciudad que se propone a partir de la comuna (el SII exige la ciudad y no la completa solo). */
export function cityForCommune(commune: string | null | undefined): string | null {
  const c = (commune ?? "").trim();
  if (!c) return null;
  const key = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return GRAN_SANTIAGO.has(key) ? "Santiago" : c;
}

/** Tipos de referencia (códigos del SII cuando existen), como en el facturador gratuito. */
export const REFERENCE_KINDS: { value: string; label: string; short: string }[] = [
  { value: "801", label: "Orden de compra (OC)", short: "OC" },
  { value: "HES", label: "Hoja de entrada de servicio (HES)", short: "HES" },
  { value: "HEM", label: "Hoja de entrada de materiales (HEM)", short: "HEM" },
  { value: "802", label: "Nota de pedido", short: "Nota de pedido" },
  { value: "NV", label: "Nota de venta", short: "Nota de venta" },
  { value: "52", label: "Guía de despacho", short: "Guía de despacho" },
  { value: "803", label: "Contrato", short: "Contrato" },
  { value: "805", label: "Proceso ChileCompra", short: "ChileCompra" },
  { value: "ML", label: "Mercado Libre", short: "Mercado Libre" },
  { value: "WEB", label: "Pedido de internet", short: "Pedido de internet" },
  { value: "WSP", label: "Pedido por WhatsApp", short: "WhatsApp" },
  { value: "RRSS", label: "Pedido por redes sociales", short: "Redes sociales" },
  { value: "OTRO", label: "Otro", short: "Otro" },
];
/** Prefijo de los tipos propios del negocio: «C:Falabella». */
export const CUSTOM_KIND_PREFIX = "C:";
export const referenceLabel = (k: string) =>
  k.startsWith(CUSTOM_KIND_PREFIX) ? k.slice(CUSTOM_KIND_PREFIX.length) : REFERENCE_KINDS.find((r) => r.value === k)?.short ?? k;

/** Normaliza un tipo (igual que `check_kind` en Rust): los del sistema tal cual; los propios como «C:<nombre>». */
export function checkKind(kind: string): string {
  if (REFERENCE_KINDS.some((r) => r.value === kind)) return kind;
  const l = kind.startsWith(CUSTOM_KIND_PREFIX) ? kind.slice(CUSTOM_KIND_PREFIX.length).trim() : "";
  if (!l || l.length > 40) throw new AppError("validacion", "Tipo de referencia no válido.");
  return `${CUSTOM_KIND_PREFIX}${l}`;
}

export const CREDIT_DAYS = [15, 30, 45, 60, 90];
export const BANKS = [
  "Banco de Chile", "Banco Estado", "Banco Santander", "Banco BCI", "Scotiabank", "Banco Itaú", "Banco BICE", "Banco Security",
  "Banco Falabella", "Banco Ripley", "Banco Consorcio", "Banco Internacional", "Coopeuch", "Mercado Pago", "Tenpo", "MACH",
];

export const EMPTY_TERMS: SaleTerms = {
  payment: "", card: null, credit_days: null, due_date: null, bank: null, transfer_date: null, operation: null, references: [], receiver: null,
  document: "", transfer_kind: null, transport: null,
};

export function receiverFromCustomer(c: Customer): Receiver {
  return {
    rut: c.rut, name: c.name, trade_name: c.trade_name ?? null, activity: c.business_activity ?? null, address: c.address ?? null,
    commune: c.commune ?? null, city: c.city ?? null, region: c.region ?? null, email: c.invoice_email ?? c.email ?? null, phone: c.phone ?? null,
    contact: c.contact_name ?? null, purchase_kind: null, requester_rut: null,
  };
}

/** Medio de pago en palabras para un cobro al contado. */
export function methodLabel(t: SaleTerms | null | undefined): string | null {
  switch (t?.payment) {
    case "efectivo": return "Efectivo";
    case "tarjeta": return t.card === "credito" ? "Tarjeta de crédito" : "Tarjeta de débito";
    case "transferencia": return "Transferencia";
    case "cheque": return "Cheque";
    case "otro": return "Otro";
    default: return null;
  }
}

/** Forma de pago para mostrar: "Crédito 30 días (vence 09-11-2026)", "Tarjeta de débito"… */
export function paymentText(t: SaleTerms | null | undefined, fmtDate: (d: string) => string): string | null {
  if (!t?.payment) return null;
  if (t.payment === "credito") return `Crédito ${t.credit_days ?? ""} días${t.due_date ? ` · vence ${fmtDate(t.due_date)}` : ""}`.replace("  ", " ");
  const base = methodLabel(t)!;
  const extra = [t.bank, t.transfer_date && `el ${fmtDate(t.transfer_date)}`, t.operation && `op. ${t.operation}`].filter(Boolean).join(" · ");
  return extra ? `${base} · ${extra}` : base;
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Limpia y valida las condiciones (la demostración las usa como el backend en Rust). */
export function normalizeTerms(t: SaleTerms | null | undefined, issueDate: string): SaleTerms | null {
  if (!t) return null;
  const payment = t.payment;
  if (payment && !["efectivo", "tarjeta", "transferencia", "credito", "cheque", "otro"].includes(payment)) throw new AppError("validacion", "Forma de pago no válida.");
  let credit_days: number | null = null, due_date: string | null = null;
  if (payment === "credito") {
    credit_days = t.credit_days ?? 30;
    if (credit_days < 1 || credit_days > 365) throw new AppError("validacion", "Los días de crédito van de 1 a 365.");
    due_date = t.due_date || addDays(issueDate, credit_days);
    if (due_date < issueDate) throw new AppError("validacion", "El vencimiento no puede ser anterior al documento.");
  }
  const references = t.references.filter((r) => r.folio.trim() || r.date).map((r) => {
    if (!r.folio.trim()) throw new AppError("validacion", "Cada referencia necesita su número o folio.");
    return { kind: checkKind(r.kind), folio: r.folio.trim(), date: r.date || null, note: clean(r.note) };
  });
  const rv = t.receiver;
  const receiver: Receiver | null = rv && Object.values(rv).some((v) => clean(v)) ? {
    rut: clean(rv.rut), name: clean(rv.name), trade_name: clean(rv.trade_name), activity: clean(rv.activity), address: clean(rv.address),
    commune: clean(rv.commune), city: clean(rv.city), region: clean(rv.region), email: clean(rv.email), phone: clean(rv.phone), contact: clean(rv.contact),
    purchase_kind: rv.purchase_kind ?? null, requester_rut: clean(rv.requester_rut),
  } : null;
  const document = t.document ?? "";
  if (document && !DOCUMENTS.some((d) => d.value === document)) throw new AppError("validacion", "Tipo de documento no válido (boleta, factura o guía de despacho).");
  const tr = t.transport;
  const transport: Transport | null = tr && Object.values(tr).some((v) => clean(v))
    ? { rut: clean(tr.rut), plate: clean(tr.plate)?.toUpperCase() ?? null, driver_rut: clean(tr.driver_rut), driver_name: clean(tr.driver_name) } : null;
  const out: SaleTerms = {
    payment, card: payment === "tarjeta" ? (t.card === "credito" ? "credito" : "debito") : null, credit_days, due_date,
    bank: payment === "transferencia" || payment === "cheque" ? clean(t.bank) : null,
    transfer_date: payment === "transferencia" ? t.transfer_date || null : null,
    operation: ["tarjeta", "transferencia", "cheque", "otro"].includes(payment) ? clean(t.operation) : null,
    references, receiver, document, transfer_kind: document === "guia" ? t.transfer_kind ?? 1 : null, transport,
  };
  return !out.payment && !out.references.length && !out.receiver && !out.document && !out.transport ? null : out;
}
