// Crédito a clientes: catálogo de documentos de respaldo y consejos. Mismas reglas que
// nucleo-app::credit_ops (Rust); la demostración las usa para armar la ficha de crédito.
import { daysBetween } from "../lib/format";
import type { CreditDoc, CreditDocStatus, Customer, CustomerCredit } from "./types";

export interface DocKind {
  code: string; label: string; source: string; verify: string; look_for: string; fresh_days: number; company_only: boolean;
}

export const DOC_KINDS: DocKind[] = [
  {
    code: "situacion_sii", label: "Situación tributaria en el SII",
    source: "Consulta gratuita y pública en sii.cl → Servicios online → Situación tributaria → Consultar situación tributaria de terceros (solo con el RUT).",
    verify: "La haces tú mismo: guarda una captura o el PDF de la consulta con la fecha.",
    look_for: "Que tenga inicio de actividades, que el giro calce con lo que te compra y que no aparezcan observaciones.",
    fresh_days: 30, company_only: false,
  },
  {
    code: "carpeta_tributaria", label: "Carpeta tributaria electrónica",
    source: "El cliente la genera en sii.cl (Servicios online → Situación tributaria → Carpeta tributaria electrónica) y te la envía.",
    verify: "Con el código y la clave que vienen en el envío, en el mismo servicio del SII. El acceso dura 90 días.",
    look_for: "Ventas de los últimos 12 meses (F29), la última renta (F22), propiedades y si declara a tiempo.",
    fresh_days: 90, company_only: false,
  },
  {
    code: "vigencia", label: "Certificado de vigencia de la sociedad",
    source: "Gratis en registrodeempresasysociedades.cl (empresas creadas o migradas ahí) o en el Conservador de Bienes Raíces del domicilio.",
    verify: "Revisa el código de verificación del certificado en el sitio que lo emitió.",
    look_for: "Que la sociedad esté vigente y la fecha de emisión sea reciente.",
    fresh_days: 30, company_only: true,
  },
  {
    code: "anotaciones", label: "Inscripción con anotaciones marginales",
    source: "Conservador de Bienes Raíces (Registro de Comercio) del domicilio de la sociedad, o el estatuto actualizado del Registro de Empresas y Sociedades.",
    verify: "Revisa el código de verificación del documento en el sitio del Conservador o del Registro.",
    look_for: "Modificaciones, cambios de socios, disolución o embargos anotados al margen.",
    fresh_days: 60, company_only: true,
  },
  {
    code: "poderes", label: "Inscripción de poderes",
    source: "Conservador de Bienes Raíces o la escritura de poderes que te entregue el cliente.",
    verify: "Compara el nombre y RUT de quien firma la orden de compra o el pagaré con los apoderados vigentes.",
    look_for: "Que quien compra o firma tenga facultades para obligar a la empresa.",
    fresh_days: 60, company_only: true,
  },
  {
    code: "informe_comercial", label: "Informe comercial (Dicom / Equifax u otro)",
    source: "Lo contratas tú en Equifax u otro buró de crédito, o te lo entrega el cliente.",
    verify: "Usa solo informes emitidos por el buró y pide autorización al cliente para consultarlo.",
    look_for: "Morosidades, protestos, deudas impagas y su evolución reciente.",
    fresh_days: 30, company_only: false,
  },
  {
    code: "otro", label: "Otros respaldos (pagaré, garantía, balance…)",
    source: "Lo que acuerdes con el cliente: pagaré, cheque en garantía, balances, referencias comerciales.",
    verify: "Guarda el original firmado; aquí queda una copia digital.",
    look_for: "Montos y fechas que coincidan con el cupo que otorgas.",
    fresh_days: 0, company_only: false,
  },
];

export const DOC_STATUS_LABEL: Record<CreditDocStatus, string> = {
  pendiente: "Pendiente", recibido: "Recibido", verificado: "Verificado", no_aplica: "No aplica",
};

/** Sitios útiles para conseguir o verificar respaldos (siempre con autorización del cliente). */
export const CREDIT_LINKS: { label: string; url: string; note: string }[] = [
  { label: "SII · Situación tributaria de terceros", url: "https://www.sii.cl", note: "Servicios online → Situación tributaria. Gratis, solo con el RUT." },
  { label: "SII · Verificar carpeta tributaria", url: "https://www.sii.cl", note: "Situación tributaria → Carpeta tributaria electrónica, con el código que te envió el cliente." },
  { label: "Registro de Empresas y Sociedades", url: "https://www.registrodeempresasysociedades.cl", note: "Certificados de vigencia y estatuto actualizado, gratis." },
  { label: "Conservador de Bienes Raíces de Santiago", url: "https://www.conservador.cl", note: "Vigencia, anotaciones marginales y poderes (o el Conservador del domicilio)." },
  { label: "Equifax Chile", url: "https://www.equifax.cl", note: "Informe comercial (Dicom). Pide autorización al cliente antes de consultar." },
];

export interface CreditDocRowLike {
  kind: string; status: CreditDocStatus; attachment_uid: string | null; file_name: string | null;
  issued_on: string | null; verified_on: string | null; note: string | null;
}

/** Arma la ficha de crédito con las mismas reglas que el backend en Rust. */
export function buildCredit(c: Customer, rows: CreditDocRowLike[], debt: number, overdue: number, today: string): CustomerCredit {
  const company = c.kind === "empresa";
  const docs: CreditDoc[] = DOC_KINDS.map((k) => {
    const r = rows.find((x) => x.kind === k.code);
    const issued = r?.issued_on ?? null;
    return {
      kind: k.code, label: k.label, source: k.source, verify: k.verify, look_for: k.look_for, company_only: k.company_only, fresh_days: k.fresh_days,
      status: r?.status ?? "pendiente", attachment_uid: r?.attachment_uid ?? null, file_name: r?.file_name ?? null, issued_on: issued,
      verified_on: r?.verified_on ?? null, note: r?.note ?? null,
      stale: k.fresh_days > 0 && !!issued && daysBetween(issued, today) > k.fresh_days,
    };
  });
  const applicable = docs.filter((d) => d.status !== "no_aplica" && d.kind !== "otro" && (company || !d.company_only));
  const ready = applicable.filter((d) => d.status === "recibido" || d.status === "verificado").length;
  const advice: string[] = [];
  if (c.credit_enabled) {
    if (ready === 0) {
      advice.push(company
        ? "Crédito habilitado sin respaldos. Es tu decisión; para una empresa te sugerimos al menos la carpeta tributaria y el certificado de vigencia."
        : "Crédito habilitado sin respaldos. Si es alguien de confianza está bien; si no, pide al menos la carpeta tributaria o un informe comercial.");
    }
    if (c.credit_limit_minor == null) advice.push("No tiene cupo: define un monto máximo para que NÚCLEO te avise antes de pasarte.");
    if (c.payment_terms_days === 0) advice.push("No tiene días de crédito: se propondrán 30 días al venderle a crédito.");
  } else if (ready > 0) {
    advice.push("Ya tienes respaldos: si los revisaste, puedes habilitarle crédito en Editar.");
  }
  if (c.credit_limit_minor != null && debt > c.credit_limit_minor) advice.push("La deuda actual supera el cupo: cobra antes de venderle más a crédito o revisa el cupo.");
  if (overdue > 0) advice.push("Tiene saldos vencidos: conviene cobrar antes de darle más crédito.");
  for (const d of docs) {
    if (d.stale && d.status !== "no_aplica") advice.push(`«${d.label}» tiene más de ${d.fresh_days} días: pide uno actualizado.`);
    if (d.status === "recibido" && d.kind !== "otro") advice.push(`«${d.label}» está recibido pero sin verificar: ${d.verify}`);
  }
  if (company && !c.business_activity) advice.push("Falta el giro del cliente: lo ves en la consulta de situación tributaria del SII.");
  return {
    enabled: c.credit_enabled, days: c.payment_terms_days, limit_minor: c.credit_limit_minor, conditions: c.credit_conditions,
    debt_minor: debt, overdue_minor: overdue, available_minor: c.credit_limit_minor == null ? null : c.credit_limit_minor - debt,
    docs, docs_ready: ready, docs_applicable: applicable.length, advice,
  };
}

/** Aviso al vender a crédito: sin crédito habilitado, o la venta pasa el cupo. `null` si no hay nada que advertir. */
export function creditWarning(credit: CustomerCredit | null, saleTotal: number, fmt: (n: number) => string): string | null {
  if (!credit) return null;
  if (!credit.enabled) return "Este cliente no tiene crédito habilitado. Puedes venderle igual; si es habitual, habilítalo en su ficha.";
  const parts: string[] = [];
  if (credit.overdue_minor > 0) parts.push(`tiene ${fmt(credit.overdue_minor)} vencidos`);
  if (credit.limit_minor != null && credit.debt_minor + saleTotal > credit.limit_minor) {
    parts.push(`con esta venta su deuda llega a ${fmt(credit.debt_minor + saleTotal)} y su cupo es ${fmt(credit.limit_minor)}`);
  }
  return parts.length ? `Ojo: ${parts.join(" y ")}. Puedes seguir; es tu decisión.` : null;
}
