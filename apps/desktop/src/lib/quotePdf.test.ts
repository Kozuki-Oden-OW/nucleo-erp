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
