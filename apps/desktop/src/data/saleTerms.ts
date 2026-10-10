// Condiciones de la venta: catálogos y reglas compartidas por la interfaz y la demostración.
// Mismas reglas que nucleo-app::sale_terms (Rust), que valida al guardar en el escritorio.
import { addDays } from "../lib/format";
import { AppError } from "./backend";
import type { Customer, Receiver, SaleTerms } from "./types";

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
  { value: "OTRO", label: "Otro", short: "Otro" },
];
export const referenceLabel = (k: string) => REFERENCE_KINDS.find((r) => r.value === k)?.short ?? k;

export const CREDIT_DAYS = [15, 30, 45, 60, 90];
export const BANKS = [
  "Banco de Chile", "Banco Estado", "Banco Santander", "Banco BCI", "Scotiabank", "Banco Itaú", "Banco BICE", "Banco Security",
  "Banco Falabella", "Banco Ripley", "Banco Consorcio", "Banco Internacional", "Coopeuch", "Mercado Pago", "Tenpo", "MACH",
];

export const EMPTY_TERMS: SaleTerms = {
  payment: "", card: null, credit_days: null, due_date: null, bank: null, transfer_date: null, operation: null, references: [], receiver: null,
};

export function receiverFromCustomer(c: Customer): Receiver {
  return {
    rut: c.rut, name: c.name, trade_name: c.trade_name ?? null, activity: c.business_activity ?? null, address: c.address ?? null,
    commune: c.commune ?? null, city: c.city ?? null, region: c.region ?? null, email: c.invoice_email ?? c.email ?? null, phone: c.phone ?? null,
    contact: c.contact_name ?? null,
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
    return { kind: r.kind, folio: r.folio.trim(), date: r.date || null, note: clean(r.note) };
  });
  const rv = t.receiver;
  const receiver: Receiver | null = rv && Object.values(rv).some((v) => clean(v)) ? {
    rut: clean(rv.rut), name: clean(rv.name), trade_name: clean(rv.trade_name), activity: clean(rv.activity), address: clean(rv.address),
    commune: clean(rv.commune), city: clean(rv.city), region: clean(rv.region), email: clean(rv.email), phone: clean(rv.phone), contact: clean(rv.contact),
  } : null;
  const out: SaleTerms = {
    payment, card: payment === "tarjeta" ? (t.card === "credito" ? "credito" : "debito") : null, credit_days, due_date,
    bank: payment === "transferencia" || payment === "cheque" ? clean(t.bank) : null,
    transfer_date: payment === "transferencia" ? t.transfer_date || null : null,
    operation: ["tarjeta", "transferencia", "cheque", "otro"].includes(payment) ? clean(t.operation) : null,
    references, receiver,
  };
  return !out.payment && !out.references.length && !out.receiver ? null : out;
}
