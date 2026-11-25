import { describe, expect, it } from "vitest";
import { DemoBackend } from "../data/demo/store";
import { buildQuotePdf, QUOTE_TEMPLATES, quoteFileName } from "./quotePdf";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function fixture() {
  const b = new DemoBackend();
  const customers = await b.searchCustomers("");
  const products = await b.searchProducts("");
  const saved = await b.saveQuote({
    customer_uid: customers[0]!.uid, issue_date: "2026-11-24", valid_until: "2026-12-09",
    lines: products.slice(0, 3).map((p, i) => ({ product_uid: p.uid, description: p.name, qty_milli: (i + 1) * 1000, unit_price_minor: p.price_minor, discount_ppm: i === 1 ? 60_000 : 0, taxable: true })),
    notes: "Despacho a regiones por Bluexpress. Precios válidos hasta agotar stock.",
  });
  const quote = await b.quote(saved.uid);
  const biz = { ...(await b.business()), logo: LOGO, rut: "76.123.456-0", address: "Av. Siempre Viva 742, Santiago", phone: "+56 9 1234 5678" };
  const settings = await b.quoteDocSettings();
  const terms = await b.quoteTerms(saved.uid);
  const customer = await b.customer(customers[0]!.uid);
  return { b, quote, biz, settings, terms, customer };
}

describe("PDF de la cotización", () => {
  it("las cuatro plantillas producen un PDF con el número, el cliente y el total", async () => {
    const f = await fixture();
    expect(QUOTE_TEMPLATES.map((t) => t.id)).toEqual(["clasica", "moderna", "compacta", "elegante"]);
    for (const t of QUOTE_TEMPLATES) {
      const pdf = buildQuotePdf({ ...f, template: t.id });
      const head = new TextDecoder("latin1").decode(pdf.subarray(0, 8));
      expect(head.startsWith("%PDF-"), t.id).toBe(true);
      expect(pdf.length, t.id).toBeGreaterThan(3000);
      const raw = new TextDecoder("latin1").decode(pdf);
      expect(raw, t.id).toContain(`(${f.quote.number})`.slice(1, -1));
      expect(raw).toContain("Cotizaci");
    }
  });

  it("muchas líneas pasan a una segunda página sin perder el total", async () => {
    const f = await fixture();
    const many = { ...f.quote, lines: Array.from({ length: 70 }, (_, i) => ({ ...f.quote.lines[0]!, line_no: i + 1, description: `Producto de prueba número ${i + 1}` })) };
    const raw = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, quote: many, template: "clasica" }));
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect(raw).toContain("TOTAL");
  });

  it("el botón de pago con tarjeta lleva el enlace y se puede quitar", async () => {
    const f = await fixture();
    const card = { show: true, url: "https://www.webpay.cl/company/000000?utm_source=prueba", label: "Pagar con tarjeta (Webpay)" };
    for (const t of QUOTE_TEMPLATES) {
      // Con un logo horizontal (lo habitual) todo cabe en una hoja; aquí va sin logo.
      const raw = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, biz: { ...f.biz, logo: null }, settings: { ...f.settings, card }, template: t.id }));
      expect(raw, t.id).toContain("/URI (https://www.webpay.cl/company/000000?utm_source=prueba)");
      expect(raw, t.id).toContain("Pagar con tarjeta \\(Webpay\\)");
      expect(raw, t.id).toContain("www.webpay.cl/company/000000) Tj");
      expect((raw.match(/\/Type \/Page\b/g) ?? []).length, t.id).toBe(1);
    }
    const off = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, settings: { ...f.settings, card: { ...card, show: false } } }));
    expect(off).not.toContain("/URI");
    // Un enlace que no es https no se dibuja (no debería llegar: NÚCLEO lo rechaza al guardar).
    const bad = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, settings: { ...f.settings, card: { ...card, url: "javascript:alert(1)" } } }));
    expect(bad).not.toContain("/URI");
  });

  it("con logo, bajo él van los datos del negocio y no su nombre (salvo que se pida)", async () => {
    const f = await fixture();
    const biz = { ...f.biz, name: "Empresa Prueba", legal_name: null };
    const own = (raw: string) => (raw.match(/\(Empresa Prueba\) Tj/g) ?? []).length;
    for (const t of QUOTE_TEMPLATES) {
      const hidden = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, biz, settings: { ...f.settings, show_name: false }, template: t.id }));
      expect(own(hidden), t.id).toBe(0);
      expect(hidden, t.id).toContain("RUT: 76.123.456-0");
      expect(hidden, t.id).toContain("Av. Siempre Viva 742, Santiago");
      expect(hidden, t.id).toContain("+56 9 1234 5678");
      const shown = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, biz, settings: { ...f.settings, show_name: true }, template: t.id }));
      expect(own(shown), t.id).toBe(1);
      // Sin logo el nombre va siempre: es lo único que dice de quién es la cotización.
      const noLogo = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, biz: { ...biz, logo: null }, settings: { ...f.settings, show_name: false }, template: t.id }));
      expect(own(noLogo), t.id).toBe(1);
    }
  });

  it("los colores del documento: principal y secundario, y «Compacta» siempre en blanco y negro", async () => {
    const f = await fixture();
    const blue = "0.039 0.318 0.643 rg", yellow = "0.99 0.78 0. rg";
    const two = { ...f.settings, colors: { primary: "#0a51a4", secondary: "#fdc701" } };
    for (const t of ["clasica", "moderna", "elegante"] as const) {
      const raw = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, settings: two, template: t }));
      expect(raw, t).toContain(blue);
      expect(raw, t).toContain(yellow);
      // Sin colores propios se usa el color del negocio (que se guarda por nombre) y no aparece el amarillo.
      const plain = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, biz: { ...f.biz, accent: "azul" }, template: t }));
      expect(plain, t).toContain("0.114 0.373 0.82 rg");
      expect(plain, t).not.toContain(yellow);
    }
    const bw = new TextDecoder("latin1").decode(buildQuotePdf({ ...f, settings: two, template: "compacta" }));
    expect(bw).not.toContain(blue);
    expect(bw).not.toContain(yellow);
  });

  it("el nombre del archivo lleva número y cliente, sin caracteres que Windows rechaza", async () => {
    const f = await fixture();
    const name = quoteFileName({ ...f.quote, customer_name: 'Soc. de Inv. / Desarrollo: "I+D" <Chile>?' });
    expect(name).toBe(`${f.quote.number} Soc. de Inv. Desarrollo I+D Chile.pdf`);
  });

  it("emitir en la demostración guarda las condiciones y entrega el archivo", async () => {
    const f = await fixture();
    await f.b.saveQuoteTerms(f.quote.uid, { delivery: " 5 días hábiles ", warranty: "12 meses", payment: "30 días" });
    expect(await f.b.quoteTerms(f.quote.uid)).toEqual({ delivery: "5 días hábiles", warranty: "12 meses", payment: "30 días" });
    const r = await f.b.saveQuotePdf(f.quote.uid, quoteFileName(f.quote), buildQuotePdf(f));
    expect(r.file_name).toMatch(/^COT-\d+ .+\.pdf$/);
  });
});
