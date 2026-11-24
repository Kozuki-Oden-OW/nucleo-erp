// Arma el PDF de una cotización con una de las cuatro plantillas. Todo ocurre en el computador:
// no se envía nada a internet. Los montos vienen ya calculados desde NÚCLEO (neto, IVA y total);
// aquí solo se dibujan.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { BusinessSettings, CustomerDetail, QuoteDetail, QuoteDocSettings, QuoteTemplate, QuoteTerms } from "../data/types";
import { formatDate, formatMoney, formatPpm, formatQty } from "./format";

export const QUOTE_TEMPLATES: { id: QuoteTemplate; name: string; hint: string }[] = [
  { id: "clasica", name: "Clásica", hint: "Logo arriba, datos a la izquierda y tabla con bordes. La de siempre." },
  { id: "moderna", name: "Moderna", hint: "Franja de color con el número, cajas «De» y «Para» y tabla rayada." },
  { id: "compacta", name: "Compacta", hint: "En blanco y negro y letra chica: caben muchas líneas en una hoja." },
  { id: "elegante", name: "Elegante", hint: "Barra lateral de color, total destacado y condiciones en tarjetas." },
];

type Rgb = [number, number, number];
interface Look { accent: Rgb; soft: Rgb; ink: Rgb; muted: Rgb; body: number; table: "grid" | "striped" | "plain"; margin: number }

function hex(color: string | null | undefined, fallback: Rgb): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(color ?? "");
  if (!m?.[1]) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (c: Rgb, t: number): Rgb => [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)];

function look(template: QuoteTemplate, accentHex: string | null): Look {
  const accent = hex(accentHex, [14, 116, 144]);
  const base = { ink: [24, 32, 44] as Rgb, muted: [100, 110, 124] as Rgb };
  if (template === "compacta") return { ...base, accent: [30, 30, 30], soft: [240, 240, 240], body: 8, table: "grid", margin: 12 };
  if (template === "moderna") return { ...base, accent, soft: mix(accent, 0.9), body: 9.5, table: "striped", margin: 16 };
  if (template === "elegante") return { ...base, accent, soft: mix(accent, 0.92), body: 9.5, table: "plain", margin: 16 };
  return { ...base, accent, soft: mix(accent, 0.88), body: 9.5, table: "grid", margin: 16 };
}

export interface QuotePdfInput {
  quote: QuoteDetail;
  biz: BusinessSettings;
  customer: CustomerDetail | null;
  settings: QuoteDocSettings;
  terms: QuoteTerms;
  template?: QuoteTemplate;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

/** Nombre sugerido del archivo: «COT-000001 Cliente.pdf» (sin caracteres que Windows no acepta). */
export function quoteFileName(q: QuoteDetail): string {
  const base = `${q.number} ${q.customer_name}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90).replace(/[. ]+$/, "");
  return `${base}.pdf`;
}

function logoSize(doc: jsPDF, logo: string, maxW: number, maxH: number): { w: number; h: number; fmt: string } | null {
  try {
    const p = doc.getImageProperties(logo);
    const k = Math.min(maxW / p.width, maxH / p.height);
    return { w: p.width * k, h: p.height * k, fmt: /^data:image\/jpe?g/i.test(logo) ? "JPEG" : /^data:image\/webp/i.test(logo) ? "WEBP" : "PNG" };
  } catch { return null; }
}

export function buildQuotePdf(input: QuotePdfInput): Uint8Array {
  const { quote: q, biz, customer, settings, terms } = input;
  const template = input.template ?? settings.template;
  const L = look(template, biz.accent);
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = L.margin;
  const left = template === "elegante" ? M + 4 : M;
  const right = W - M;
  const width = right - left;
  const text = (s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: Rgb; align?: "left" | "right" | "center"; maxWidth?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? L.body);
    doc.setTextColor(...(o.color ?? L.ink));
    doc.text(s, x, y, { align: o.align ?? "left", maxWidth: o.maxWidth });
  };
  const lineH = (size: number) => size * 0.42;

  const company = clean(biz.legal_name) || biz.name;
  const companyLines = [
    biz.rut ? `RUT: ${biz.rut}` : "", clean(biz.activity), clean(biz.address),
    [clean(biz.phone) && `Contacto: ${clean(biz.phone)}`, clean(biz.email)].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const prof = customer;
  const clientLines = [
    prof?.rut ? `RUT: ${prof.rut}` : "", clean(prof?.business_activity),
    [clean(prof?.address), clean(prof?.commune), clean(prof?.city)].filter(Boolean).join(", "),
    [clean(prof?.contact_name), clean(prof?.phone), clean(prof?.email)].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const meta: [string, string][] = [["Fecha", formatDate(q.issue_date)], ...(q.valid_until ? [["Válida hasta", formatDate(q.valid_until)] as [string, string]] : [])];

  let y = M;
  if (template === "elegante") { doc.setFillColor(...L.accent); doc.rect(0, 0, 7, H, "F"); }

  /* ── Encabezado ── */
  const logo = biz.logo ? logoSize(doc, biz.logo, template === "compacta" ? 34 : 48, template === "compacta" ? 13 : 18) : null;
  if (template === "moderna") {
    doc.setFillColor(...L.accent);
    doc.rect(0, 0, W, 34, "F");
    text("COTIZACIÓN", left, 15, { size: 20, bold: true, color: [255, 255, 255] });
    text(q.number, left, 23, { size: 12, color: [255, 255, 255] });
    meta.forEach(([k, v], i) => text(`${k}: ${v}`, right, 14 + i * 5.5, { size: 9.5, color: [255, 255, 255], align: "right" }));
    y = 42;
    if (logo && biz.logo) { doc.addImage(biz.logo, logo.fmt, left, y, logo.w, logo.h); y += logo.h + 3; }
    const boxW = (width - 6) / 2;
    const boxH = 9 + Math.max(companyLines.length, clientLines.length, 1) * lineH(9) * 1.25 + 4;
    ([["DE", company, companyLines, left], ["PARA", q.customer_name, clientLines, left + boxW + 6]] as [string, string, string[], number][]).forEach(([tag, name, lines, x]) => {
      doc.setFillColor(...L.soft);
      doc.roundedRect(x, y, boxW, boxH, 2, 2, "F");
      text(tag, x + 4, y + 5.5, { size: 7.5, bold: true, color: L.accent });
      text(name, x + 4, y + 10.5, { size: 10.5, bold: true, maxWidth: boxW - 8 });
      lines.forEach((l, i) => text(l, x + 4, y + 15 + i * lineH(9) * 1.25, { size: 8.5, color: L.muted, maxWidth: boxW - 8 }));
    });
    y += boxH + 7;
  } else {
    const top = y;
    let hy = y;
    if (logo && biz.logo) { doc.addImage(biz.logo, logo.fmt, left, hy, logo.w, logo.h); hy += logo.h + 3.5; } else hy += 4;
    text(company, left, hy + 1, { size: template === "compacta" ? 11 : 13, bold: true });
    hy += template === "compacta" ? 4.5 : 5.5;
    companyLines.forEach((l) => { text(l, left, hy, { size: L.body - 1, color: L.muted, maxWidth: width * 0.58 }); hy += lineH(L.body - 1) * 1.3; });
    // Bloque derecho: título, número y fechas.
    text("COTIZACIÓN", right, top + 6, { size: template === "compacta" ? 13 : template === "elegante" ? 20 : 16, bold: true, color: L.accent, align: "right" });
    text(`N° ${q.number}`, right, top + 12.5, { size: 11, bold: true, align: "right" });
    meta.forEach(([k, v], i) => text(`${k}: ${v}`, right, top + 18 + i * 4.8, { size: L.body - 0.5, color: L.muted, align: "right" }));
    y = Math.max(hy, top + 18 + meta.length * 4.8) + 3;
    doc.setDrawColor(...(template === "compacta" ? L.ink : L.accent));
    doc.setLineWidth(template === "compacta" ? 0.2 : 0.5);
    doc.line(left, y, right, y);
    y += 6;
    text(template === "elegante" ? "Preparada para" : "PARA", left, y, { size: 7.5, bold: true, color: L.accent });
    y += 4.8;
    text(q.customer_name, left, y, { size: 11, bold: true, maxWidth: width });
    y += 4.6;
    clientLines.forEach((l) => { text(l, left, y, { size: L.body - 1, color: L.muted, maxWidth: width }); y += lineH(L.body - 1) * 1.3; });
    y += 4;
  }

  /* ── Detalle ── */
  const withDiscount = q.lines.some((l) => l.discount_ppm > 0);
  const head = [["Producto o servicio", "Cantidad", "Precio neto", ...(withDiscount ? ["Desc."] : []), "Total neto"]];
  const body = q.lines.map((l) => [l.description, formatQty(l.qty_milli), formatMoney(l.unit_price_minor), ...(withDiscount ? [l.discount_ppm ? formatPpm(l.discount_ppm, 0) : "—"] : []), formatMoney(l.net_minor)]);
  const numCols = withDiscount ? [1, 2, 3, 4] : [1, 2, 3];
  autoTable(doc, {
    startY: y, head, body, theme: L.table, margin: { left, right: M, bottom: 18 },
    styles: { font: "helvetica", fontSize: L.body, textColor: L.ink, cellPadding: template === "compacta" ? 1.4 : 2, lineColor: template === "compacta" ? [120, 120, 120] : mix(L.accent, 0.6), lineWidth: L.table === "grid" ? 0.15 : 0 },
    headStyles: L.table === "plain"
      ? { fillColor: [255, 255, 255], textColor: L.accent, fontStyle: "bold", lineWidth: { bottom: 0.5 }, lineColor: L.accent }
      : { fillColor: template === "compacta" ? [235, 235, 235] : L.accent, textColor: template === "compacta" ? L.ink : [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: L.table === "striped" ? { fillColor: L.soft } : {},
    bodyStyles: L.table === "plain" ? { lineWidth: { bottom: 0.1 }, lineColor: [215, 220, 226] } : {},
    columnStyles: Object.fromEntries(numCols.map((c) => [c, { halign: "right" as const, cellWidth: c === 1 ? 20 : c === 3 && withDiscount ? 16 : 28 }])),
    didParseCell: (d) => { if (d.section === "head" && numCols.includes(d.column.index)) d.cell.styles.halign = "right"; },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;

  const need = (h: number) => { if (y + h > H - 18) { doc.addPage(); if (template === "elegante") { doc.setFillColor(...L.accent); doc.rect(0, 0, 7, H, "F"); } y = M + 4; } };

  /* ── Totales ── */
  const rate = biz.tax_rate_ppm ?? biz.tax_rate_user_ppm;
  const rows: [string, string][] = [];
  if (q.totals.tax_minor > 0 || q.totals.discount_minor > 0) rows.push(["Subtotal neto", formatMoney(q.totals.net_minor)]);
  if (q.totals.exempt_minor > 0) rows.push(["Exento", formatMoney(q.totals.exempt_minor)]);
  if (q.totals.tax_minor > 0) rows.push([rate ? `IVA (${formatPpm(rate, 0)})` : "IVA", formatMoney(q.totals.tax_minor)]);
  const boxW = template === "compacta" ? 62 : 74;
  const tx = right - boxW;
  need(rows.length * 5.4 + 14);
  rows.forEach(([k, v]) => { text(k, tx + 2, y + 3.6, { color: L.muted }); text(v, right - 2, y + 3.6, { align: "right" }); y += 5.4; });
  if (template === "compacta") { doc.setDrawColor(...L.ink); doc.setLineWidth(0.3); doc.line(tx, y + 0.5, right, y + 0.5); text("TOTAL", tx + 2, y + 6, { bold: true, size: 10.5 }); text(formatMoney(q.total_minor), right - 2, y + 6, { bold: true, size: 10.5, align: "right" }); y += 10; }
  else {
    doc.setFillColor(...L.accent);
    doc.roundedRect(tx, y + 0.5, boxW, template === "elegante" ? 12 : 9.5, 1.5, 1.5, "F");
    const ty = y + (template === "elegante" ? 8.2 : 6.8);
    text("TOTAL", tx + 3, ty, { bold: true, size: 10.5, color: [255, 255, 255] });
    text(formatMoney(q.total_minor), right - 3, ty, { bold: true, size: template === "elegante" ? 14 : 12, color: [255, 255, 255], align: "right" });
    y += template === "elegante" ? 17 : 14.5;
  }

  /* ── Condiciones ── */
  const conds: [string, string][] = ([["Plazo de entrega", clean(terms.delivery)], ["Garantía", clean(terms.warranty)], ["Forma de pago", clean(terms.payment)]] as [string, string][]).filter(([, v]) => v);
  if (conds.length) {
    if (template === "elegante" || template === "moderna") {
      const gap = 4, cw = (width - gap * (conds.length - 1)) / conds.length;
      need(18);
      conds.forEach(([k, v], i) => {
        const x = left + i * (cw + gap);
        doc.setFillColor(...L.soft);
        doc.roundedRect(x, y, cw, 14, 1.5, 1.5, "F");
        text(k.toUpperCase(), x + 3, y + 5, { size: 7, bold: true, color: L.accent });
        text(v, x + 3, y + 10.3, { size: 9.5, bold: true, maxWidth: cw - 6 });
      });
      y += 19;
    } else {
      need(conds.length * 6 + 4);
      autoTable(doc, {
        startY: y, body: conds.map(([k, v]) => [k.toUpperCase(), v]), theme: "grid", margin: { left, right: M },
        styles: { font: "helvetica", fontSize: L.body - 0.5, textColor: L.ink, cellPadding: template === "compacta" ? 1.3 : 2, lineColor: template === "compacta" ? [120, 120, 120] : mix(L.accent, 0.6), lineWidth: 0.15 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: width * 0.45, fillColor: L.soft }, 1: { halign: "center" } },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;
    }
  }

  /* ── Observaciones y contacto ── */
  for (const [label, value] of [["Observaciones", clean(q.notes)], ["", clean(settings.contact_note)]] as [string, string][]) {
    if (!value) continue;
    const lines = doc.setFont("helvetica", "normal").setFontSize(L.body - 0.5).splitTextToSize(value, width) as string[];
    need(lines.length * lineH(L.body) * 1.25 + (label ? 6 : 2));
    if (label) { text(label.toUpperCase(), left, y + 2, { size: 7.5, bold: true, color: L.accent }); y += 6; }
    lines.forEach((l) => { text(l, left, y + 1, { size: L.body - 0.5, color: label ? L.ink : L.muted }); y += lineH(L.body) * 1.25; });
    y += 3;
  }

  /* ── Datos de transferencia ── */
  const b = settings.bank;
  const bank: [string, string][] = b.show ? ([["Razón social", clean(b.holder)], ["RUT", clean(b.rut)], ["Banco", clean(b.bank)], ["Tipo de cuenta", clean(b.account_type)], ["Número de cuenta", clean(b.account)], ["Correo para el comprobante", clean(b.email)]] as [string, string][]).filter(([, v]) => v) : [];
  if (bank.length) {
    // Dos datos por fila, para que el bloque ocupe la mitad de alto.
    const pairs: string[][] = [];
    for (let i = 0; i < bank.length; i += 2) pairs.push([bank[i]![0], bank[i]![1], bank[i + 1]?.[0] ?? "", bank[i + 1]?.[1] ?? ""]);
    const boxed = template === "clasica" || template === "compacta";
    need(pairs.length * 5.6 + 10);
    text("DATOS DE TRANSFERENCIA", left, y + 2, { size: 7.5, bold: true, color: L.accent });
    y += 4;
    autoTable(doc, {
      startY: y, body: pairs, theme: boxed ? "grid" : "plain", margin: { left, right: M, bottom: 18 },
      styles: { font: "helvetica", fontSize: L.body - 0.5, textColor: L.ink, cellPadding: template === "compacta" ? 1.2 : 1.6, lineColor: template === "compacta" ? [120, 120, 120] : mix(L.accent, 0.6), lineWidth: boxed ? 0.15 : 0 },
      columnStyles: { 0: { textColor: L.muted, cellWidth: 30 }, 1: { fontStyle: "bold" }, 2: { textColor: L.muted, cellWidth: 44 }, 3: { fontStyle: "bold" } },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;
  }

  /* ── Pie en todas las páginas ── */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...mix(L.ink, 0.75));
    doc.setLineWidth(0.15);
    doc.line(left, H - 13, right, H - 13);
    const foot = [clean(settings.footer), company].filter(Boolean).join(" · ");
    text(foot, left, H - 8.5, { size: 8, color: L.muted, maxWidth: width - 30 });
    text(pages > 1 ? `Página ${p} de ${pages}` : "Cotización: no es un documento tributario", right, H - 8.5, { size: 7.5, color: L.muted, align: "right" });
  }
  doc.setProperties({ title: `Cotización ${q.number}`, subject: q.customer_name, author: company, creator: "NÚCLEO ERP" });
  return new Uint8Array(doc.output("arraybuffer"));
}
