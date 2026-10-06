// Backend de demostración: implementa el mismo puerto que el escritorio, con datos ficticios en memoria.
// Sirve para el navegador (prueba de usabilidad de la Fase 3) y para desarrollar pantallas antes de
// que exista su comando Rust. No persiste nada: al recargar la página vuelve al estado inicial.
import { AppError, type Backend, type Feature, type FileSource, type PurchaseFilter, type SaleFilter } from "../backend";
import { computeLines, computeTotals, lineIsValid } from "../calc";
import type {
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, DocLink, EffectInput, EntityRef, ExternalRef, ExternalRefInput, Line, LineInput,
  NewCustomer, NewProduct, NewUser, Payment, PermissionRow,
  AdjustmentInput, InventoryOverview, InventorySettings, KardexRow, ProductInventory, ReorderInput, ReorderSettings, StockAnalysis, StockDocDone, StockDocRow, TransferInput, Warehouse, PriceHistoryRow, Product, ProductPatch, PurchaseOrderDetail, PurchaseOrderSummary,
  BuyLineInput, NewSupplier, PoLine, PoStatus, PurchaseDetail, PurchaseInput, PurchaseLine, PurchaseOrderInput, PurchaseSummary, ReceiveLine, Supplier, SupplierDetail, QuoteDetail,
  QuoteInput, QuoteStatus, QuoteSummary, RateRow, RoleRow, SaleDetail, SaleDocType, SaleInput, SaleSummary, SearchHit,
  SecuritySettings, SequenceRow, SessionInfo, Totals, UserPatch, UserRow,
} from "../types";
import { DEMO_PERMISSIONS, DEMO_ROLES } from "./roles";
import { addDays, daysBetween, todayIso } from "../../lib/format";
import { CUSTOMER_NAMES, DEMO_COMPANY, PAYMENT_METHODS, PRODUCT_ROWS, SUPPLIER_NAMES, rng, rutDv } from "./seed";
import reglas from "./reglas-demo.json";

const TAX_PPM: number = reglas.values[0]!.value;
const TAX_SOURCE = `${reglas.code} · ${reglas.values[0]!.source}`;

interface QuoteRec {
  uid: string; number: string; customer_uid: string | null; prospect_name: string | null; issue_date: string;
  valid_until: string | null; status: QuoteStatus; lines: Line[]; totals: Totals; notes: string | null; sale_uid: string | null;
}
interface SaleRec {
  uid: string; doc_type: SaleDocType; number: string; customer_uid: string | null; issue_date: string; due_date: string | null;
  commercial_state: SaleDetail["commercial_state"]; documentation_state: SaleDetail["documentation_state"];
  lines: Line[]; totals: Totals; cost_minor: number; payment_method: string | null; notes: string | null;
  quote_uid: string | null; payments: Payment[]; external_ref: ExternalRef | null; void_reason: string | null;
  timeline: { at: string; text: string }[];
}
interface PoRec {
  uid: string; number: string; supplier_uid: string; issue_date: string; expected_date: string | null; status: PoStatus;
  lines: PoLine[]; totals: Totals; notes: string | null; void_reason: string | null; receipts: { number: string; date: string }[];
  timeline: { at: string; text: string }[];
}
interface MoveRec {
  id: number; date: string; product_uid: string; wh: string; kind: KardexRow["kind"]; document: string; source_type: string;
  source_uid: string | null; qty: number; cost_e4: number; reason: string | null;
}
interface WhRec { uid: string; code: string; name: string; is_default: boolean; archived: boolean }
interface PurRec {
  uid: string; number: string; supplier_uid: string; doc_kind: string | null; doc_number: string | null; issue_date: string;
  due_date: string | null; status: "registrada" | "anulada"; lines: PurchaseLine[]; totals: Totals; order_uid: string | null;
  payments: Payment[]; received_stock: boolean; notes: string | null; void_reason: string | null; timeline: { at: string; text: string }[];
}

let uidSeq = 0;
const uid = (p: string) => `${p}-${(++uidSeq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const wait = <T,>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const now = () => new Date().toISOString().slice(0, 19) + "Z";

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  readonly features: ReadonlySet<Feature> = new Set<Feature>([
    "dashboard", "clientes", "productos", "ventas", "compras", "comex", "negocio", "busqueda",
    "usuarios", "documentos", "numeracion", "monedas", "auditoria", "inventario",
  ]);
  private company = { uid: "demo-company", name: DEMO_COMPANY, profile: "empresa" as BusinessProfile, created_at: "2026-01-02T12:00:00Z" };
  private biz: BusinessSettings;
  private customers: Customer[] = [];
  private products: Product[] = [];
  private quotes: QuoteRec[] = [];
  private sales: SaleRec[] = [];
  private pos: PoRec[] = [];
  private suppliers: Supplier[] = [];
  private whs: WhRec[] = [];
  private moves: MoveRec[] = [];
  private stockDocs: StockDocRow[] = [];
  private reorder: Record<string, ReorderSettings> = {};
  private allowNegative = true;
  private purchases: PurRec[] = [];
  private seq: Record<string, number> = {};
  private history: Record<string, number> = {};
  private cashBase = 3_850_000;
  private auditRows: AuditRow[] = [];
  private today = todayIso();
  private users: (UserRow & { password: string | null })[] = [];
  private roleList: RoleRow[] = structuredClone(DEMO_ROLES);
  private current: string | null = null;
  private lockMinutes = 15;
  private seqCfg: Record<string, { name: string; prefix: string; width: number }> = {
    COT: { name: "Cotización", prefix: "COT", width: 6 }, VEN: { name: "Venta", prefix: "VEN", width: 6 },
    FV: { name: "Factura interna", prefix: "FV", width: 6 }, PAG: { name: "Comprobante de pago", prefix: "PAG", width: 6 },
    OC: { name: "Orden de compra", prefix: "OC", width: 6 },
  };
  private rateRows: RateRow[] = [];
  private files: (AttachmentRow & { dataUrl: string; archived: boolean })[] = [];

  constructor() {
    this.biz = {
      name: DEMO_COMPANY, profile: "empresa", rut: "76.543.210-3", legal_name: "Comercial Los Andes SpA (ficticia)",
      activity: "Venta al por menor de artículos de ferretería", address: "Av. Ejemplo 1234, Puerto Ejemplo", phone: "+56 9 5555 0000",
      email: "contacto@ejemplo.cl", documentation_reminder: true, tax_enabled: true, tax_rate_ppm: TAX_PPM, tax_rule_source: TAX_SOURCE, tax_rate_user_ppm: null,
    };
    this.seed();
    this.seedInventory();
  }

  private next(docType: string): string {
    this.seq[docType] = (this.seq[docType] ?? 0) + 1;
    const cfg = this.seqCfg[docType] ?? { prefix: docType, width: 6 };
    return `${cfg.prefix}-${String(this.seq[docType]).padStart(cfg.width, "0")}`;
  }
  private me(): UserRow & { password: string | null } {
    const u = this.users.find((x) => x.uid === this.current);
    if (!u) throw new AppError("inicio_sesion", "Inicia sesión para continuar.");
    return u;
  }
  private perms(u: UserRow): Set<string> {
    return new Set(this.roleList.filter((r) => u.roles.includes(r.code)).flatMap((r) => r.permissions));
  }
  private require(perm: string): void {
    if (!this.perms(this.me()).has(perm)) {
      const label = DEMO_PERMISSIONS.find((p) => p.code === perm)?.description.toLowerCase() ?? "realizar esta acción";
      throw new AppError("sin_permiso", `No tienes permiso para ${label}.`);
    }
  }
  private log(action: string, entity: string, id: string | null, reason: string | null = null): void {
    const user = this.users.find((x) => x.uid === this.current)?.username ?? "sistema";
    this.auditRows.unshift({ id: this.auditRows.length + 1, ts_utc: now(), user_name: user, action, entity, entity_id: id, before_json: null, after_json: null, reason });
  }
  private taxPpm(): number | null { return this.biz.tax_enabled ? this.biz.tax_rate_ppm : null; }

  /* ───────────── Datos iniciales ───────────── */

  private seed(): void {
    const r = rng(20261005);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    CUSTOMER_NAMES.forEach((name, i) => {
      const body = 10_000_000 + Math.floor(r() * 15_000_000);
      const company = /Ltda|SpA|S\.A\.|Constructora|Inmobiliaria|Municipalidad|Colegio|Club|Empresa/.test(name);
      const rutBody = company ? 76_000_000 + Math.floor(r() * 999_999) : body;
      this.customers.push({
        id: i + 1, uid: uid("cli"), name, rut: r() < 0.85 ? `${rutBody}-${rutDv(rutBody)}` : null,
        email: r() < 0.6 ? `${norm(name).replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@ejemplo.cl` : null,
        phone: r() < 0.7 ? `+56 9 ${Math.floor(1000 + r() * 8999)} ${Math.floor(1000 + r() * 8999)}` : null,
        created_at: "2026-01-10T12:00:00Z",
      });
    });
    for (const [sku, name, unit, price, cost, stock, min, service] of PRODUCT_ROWS) {
      this.products.push({
        uid: uid("pro"), sku, name, unit, kind: service ? "servicio" : "producto", price_minor: price, cost_e4: cost * 10_000,
        on_hand_milli: stock * 1000, min_milli: min * 1000, taxable: true,
      });
    }
    // Historia mensual agregada (12 meses) para el gráfico.
    for (let m = 11; m >= 1; m--) {
      const d = new Date(`${this.today}T12:00:00`);
      d.setDate(1); d.setMonth(d.getMonth() - m);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const season = 1 + 0.25 * Math.sin((d.getMonth() + 2) / 12 * Math.PI * 2);
      this.history[ym] = Math.round((9_500_000 + r() * 3_000_000) * season / 1000) * 1000;
    }
    // Ventas detalladas de los últimos 45 días.
    const goods = this.products.filter((p) => p.kind === "producto");
    for (let i = 0; i < 70; i++) {
      const date = addDays(this.today, -Math.floor(r() * 45));
      const n = 1 + Math.floor(r() * 4);
      const lines: LineInput[] = [];
      for (let k = 0; k < n; k++) {
        const p = pick(goods);
        if (lines.some((l) => l.product_uid === p.uid)) continue;
        lines.push({ product_uid: p.uid, description: p.name, qty_milli: (1 + Math.floor(r() * (p.unit === "m" ? 30 : 4))) * 1000, unit_price_minor: p.price_minor, discount_ppm: r() < 0.15 ? 50_000 : 0, taxable: true });
      }
      const cust = r() < 0.2 ? null : pick(this.customers);
      const credit = cust !== null && r() < 0.35;
      const s = this.makeSale("VEN", cust?.uid ?? null, date, lines, null);
      s.commercial_state = "efectuada";
      s.cost_minor = this.costOf(s.lines);
      s.payment_method = credit ? "Crédito 30 días" : pick(PAYMENT_METHODS);
      s.due_date = credit ? addDays(date, 30) : null;
      s.documentation_state = r() < 0.12 ? "pendiente" : "documentada";
      if (s.documentation_state === "documentada") {
        s.external_ref = { doc_kind: cust?.rut && cust.rut.startsWith("7") ? "Factura" : "Boleta", external_number: String(4000 + i), issue_date: date, observation: null, marked_at: `${date}T18:00:00Z` };
      }
      if (!credit) s.payments.push({ number: this.next("PAG"), date, amount_minor: s.totals.total_minor, method: s.payment_method });
      else if (r() < 0.4) s.payments.push({ number: this.next("PAG"), date: addDays(date, 10), amount_minor: Math.round(s.totals.total_minor / 2), method: "Transferencia" });
      s.timeline.push({ at: `${date}T12:00:00Z`, text: "Venta efectuada" });
      this.autoClose(s);
      this.sales.push(s);
    }
    this.sales.sort((a, b) => a.issue_date.localeCompare(b.issue_date));
    // Renumerar en orden cronológico para que los folios internos sean correlativos.
    this.seq = {};
    for (const s of this.sales) { s.number = this.next(s.doc_type); for (const p of s.payments) p.number = this.next("PAG"); }

    // Un caso armado para la prueba de usabilidad: cotización aceptada lista para convertir.
    const constructora = this.customers[0]!;
    const q = this.makeQuote(constructora.uid, null, addDays(this.today, -3), [
      { product_uid: this.products[0]!.uid, description: this.products[0]!.name, qty_milli: 3000, unit_price_minor: this.products[0]!.price_minor, discount_ppm: 50_000, taxable: true },
      { product_uid: this.products[10]!.uid, description: this.products[10]!.name, qty_milli: 40_000, unit_price_minor: this.products[10]!.price_minor, discount_ppm: 0, taxable: true },
    ]);
    q.status = "aceptada";
    this.quotes.push(q);
    const q2 = this.makeQuote(this.customers[2]!.uid, null, addDays(this.today, -8), [
      { product_uid: this.products[13]!.uid, description: this.products[13]!.name, qty_milli: 12_000, unit_price_minor: this.products[13]!.price_minor, discount_ppm: 0, taxable: true },
      { product_uid: this.products[15]!.uid, description: this.products[15]!.name, qty_milli: 10_000, unit_price_minor: this.products[15]!.price_minor, discount_ppm: 0, taxable: true },
    ]);
    q2.status = "enviada";
    this.quotes.push(q2);

    // Proveedores, órdenes de compra y un documento de compra por pagar.
    SUPPLIER_NAMES.forEach((name, i) => {
      const body = 76_100_000 + Math.floor(r() * 899_999);
      this.suppliers.push({ id: i + 1, uid: uid("prv"), rut: `${body}-${rutDv(body)}`, name, email: null, phone: null, payment_terms_days: i % 2 === 0 ? 30 : 0, created_at: "2026-01-05T12:00:00Z" });
    });
    const supplierLines = (idx: number[]): PoLine[] => idx.map((i, n) => {
      const p = this.products[i]!;
      const qty = (10 + Math.floor(r() * 20)) * 1000;
      const cost = Math.round(p.cost_e4 / 10_000);
      return { line_no: n + 1, product_uid: p.uid, description: p.name, qty_milli: qty, received_milli: 0, unit_cost_minor: cost, taxable: true, net_minor: Math.round((qty * cost) / 1000) };
    });
    const poDefs: [number, number[], number, PoStatus][] = [[0, [10, 11, 18, 19], -6, "emitida"], [2, [13, 14, 17], -2, "emitida"], [4, [23, 24, 25], -20, "recibida"]];
    for (const [si, idx, days, status] of poDefs) {
      const lines = supplierLines(idx);
      if (status === "recibida") lines.forEach((l) => (l.received_milli = l.qty_milli));
      const date = addDays(this.today, days);
      const po: PoRec = { uid: uid("oc"), number: this.next("OC"), supplier_uid: this.suppliers[si]!.uid, issue_date: date, expected_date: addDays(date, 7), status, lines, totals: this.buyTotals(lines), notes: null, void_reason: null, receipts: [], timeline: [{ at: `${date}T13:00:00Z`, text: "Emitida: pendiente de recepción" }] };
      if (status === "recibida") {
        po.receipts.push({ number: this.next("REC"), date: addDays(date, 6) });
        po.timeline.push({ at: `${addDays(date, 6)}T15:00:00Z`, text: "Recibida completa: stock y costo promedio actualizados" });
        this.purchases.push({ uid: uid("com"), number: this.next("COM"), supplier_uid: po.supplier_uid, doc_kind: "Factura", doc_number: "4471", issue_date: addDays(date, 6), due_date: addDays(this.today, 9), status: "registrada", lines: lines.map(({ received_milli: _r, ...l }) => l), totals: po.totals, order_uid: po.uid, payments: [], received_stock: false, notes: null, void_reason: null, timeline: [{ at: `${addDays(date, 6)}T16:00:00Z`, text: "Registrado Factura Nº 4471" }] });
      }
      this.pos.push(po);
    }
    // Usuarios de ejemplo: el dueño opera sin contraseña (modo de un solo usuario).
    const mk = (username: string, display_name: string, roles: string[], i: number) => ({
      id: i, uid: `usr-${username}`, username, display_name, has_password: false, is_active: true, last_login_at: null,
      created_at: "2026-01-02T12:00:00Z", roles, password: null as string | null,
    });
    this.users = [mk("dueno", "Dueño", ["dueno"], 1), mk("maria.lopez", "María López", ["ventas"], 2), mk("contador", "Estudio contable (externo)", ["contador"], 3)];
    this.users[2]!.is_active = false;
    this.current = "usr-dueno";
    // Historia de auditoría coherente con los datos sembrados.
    this.auditRows = [];
    this.log("empresa.crear", "empresa", "demo-company");
    for (const s of this.sales) this.log("venta.efectuar", "venta", s.number);
    for (const q of this.quotes) this.log("cotizacion.crear", "cotizacion", q.number);
    this.rateRows = [
      { currency_code: "USD", rate_date: addDays(this.today, -1), rate_e6: 951_340_000, note: "Tasa de referencia anotada a mano", created_at: now() },
      { currency_code: "USD", rate_date: addDays(this.today, -8), rate_e6: 946_120_000, note: null, created_at: now() },
      { currency_code: "EUR", rate_date: addDays(this.today, -1), rate_e6: 1_032_800_000, note: null, created_at: now() },
    ];
    const pdf = "data:application/pdf;base64,JVBERi0xLjQKJURFTU8K";
    const addFile = (file_name: string, mime: string, description: string, links: string[], days: number) =>
      this.files.push({ id: this.files.length + 1, uid: uid("doc"), sha256: "", file_name, mime_type: mime, size_bytes: 48_000 + this.files.length * 9_100, description, created_by: "Dueño", created_at: `${addDays(this.today, -days)}T15:00:00Z`, links, dataUrl: pdf, archived: false });
    addFile("contrato-arriendo-local.pdf", "application/pdf", "Contrato de arriendo del local (vence en marzo)", [], 40);
    addFile("factura-proveedor-OC-000003.pdf", "application/pdf", "Factura del proveedor eléctrico", ["orden_compra:3"], 18);
    addFile("orden-compra-constructora-sur.pdf", "application/pdf", "Orden de compra enviada por el cliente", [`cliente:${this.customers[0]!.uid}`], 4);
  }

  private costOf(lines: Line[]): number {
    return lines.reduce((sum, l) => {
      const p = this.products.find((x) => x.uid === l.product_uid);
      return sum + (p ? Math.round((p.cost_e4 / 10_000) * (l.qty_milli / 1000)) : 0);
    }, 0);
  }

  private makeQuote(customer_uid: string | null, prospect: string | null, date: string, input: LineInput[]): QuoteRec {
    const lines = computeLines(input);
    return { uid: uid("cot"), number: this.next("COT"), customer_uid, prospect_name: prospect, issue_date: date, valid_until: addDays(date, 15), status: "borrador", lines, totals: computeTotals(input, this.taxPpm()), notes: null, sale_uid: null };
  }

  private makeSale(doc: SaleDocType, customer_uid: string | null, date: string, input: LineInput[], quote_uid: string | null): SaleRec {
    const lines = computeLines(input);
    return {
      uid: uid("ven"), doc_type: doc, number: this.next(doc), customer_uid, issue_date: date, due_date: null, commercial_state: "borrador",
      documentation_state: "no_aplica", lines, totals: computeTotals(input, this.taxPpm()), cost_minor: 0, payment_method: null, notes: null,
      quote_uid, payments: [], external_ref: null, void_reason: null, timeline: [{ at: `${date}T12:00:00Z`, text: "Creada como borrador" }],
    };
  }

  private paid(s: SaleRec): number { return s.payments.reduce((a, p) => a + p.amount_minor, 0); }
  private payState(s: SaleRec): SaleSummary["payment_state"] {
    const p = this.paid(s);
    return p <= 0 ? "sin_pago" : p < s.totals.total_minor ? "abonada" : "pagada";
  }
  private autoClose(s: SaleRec): void {
    if (s.commercial_state === "efectuada" && this.payState(s) === "pagada" && s.documentation_state !== "pendiente") {
      s.commercial_state = "cerrada";
      s.timeline.push({ at: now(), text: "Cerrada automáticamente: pagada y sin documentación pendiente" });
    }
  }
  private customerName(uidv: string | null, prospect?: string | null): string {
    if (!uidv) return prospect ?? "Cliente ocasional";
    return this.customers.find((c) => c.uid === uidv)?.name ?? "Cliente";
  }
  private summary(s: SaleRec): SaleSummary {
    return {
      uid: s.uid, doc_type: s.doc_type, number: s.number, customer_name: this.customerName(s.customer_uid), issue_date: s.issue_date,
      due_date: s.due_date, commercial_state: s.commercial_state, payment_state: this.payState(s), documentation_state: s.documentation_state,
      total_minor: s.totals.total_minor, paid_minor: this.paid(s),
    };
  }
  private detail(s: SaleRec): SaleDetail {
    const q = s.quote_uid ? this.quotes.find((x) => x.uid === s.quote_uid) : undefined;
    const chain: DocLink[] = [];
    if (q) chain.push({ number: q.number, kind: "COT", uid: q.uid, label: "Cotización" });
    chain.push({ number: s.number, kind: s.doc_type, uid: s.uid, label: s.doc_type === "FV" ? "Factura interna" : "Venta" });
    for (const p of s.payments) chain.push({ number: p.number, kind: "PAG", uid: null, label: `Pago · ${p.method}` });
    if (s.external_ref) chain.push({ number: [s.external_ref.doc_kind, s.external_ref.external_number && `Nº ${s.external_ref.external_number}`].filter(Boolean).join(" ") || "Documentada", kind: "REF", uid: null, label: "Referencia externa" });
    return {
      ...this.summary(s), customer_uid: s.customer_uid, lines: s.lines, totals: s.totals, cost_minor: s.cost_minor, payment_method: s.payment_method,
      notes: s.notes, quote_uid: s.quote_uid, quote_number: q?.number ?? null, payments: s.payments, external_ref: s.external_ref,
      void_reason: s.void_reason, chain, timeline: s.timeline,
    };
  }
  private quoteSummary(q: QuoteRec): QuoteSummary {
    return { uid: q.uid, number: q.number, customer_name: this.customerName(q.customer_uid, q.prospect_name), issue_date: q.issue_date, valid_until: q.valid_until, status: q.status, total_minor: q.totals.total_minor };
  }
  private quoteDetail(q: QuoteRec): QuoteDetail {
    const s = q.sale_uid ? this.sales.find((x) => x.uid === q.sale_uid) : undefined;
    return { ...this.quoteSummary(q), customer_uid: q.customer_uid, lines: q.lines, totals: q.totals, notes: q.notes, sale_uid: q.sale_uid, sale_number: s?.number ?? null };
  }
  private findSale(u: string): SaleRec {
    const s = this.sales.find((x) => x.uid === u);
    if (!s) throw new AppError("no_encontrado", "No encontramos esa venta.");
    return s;
  }
  private findQuote(u: string): QuoteRec {
    const q = this.quotes.find((x) => x.uid === u);
    if (!q) throw new AppError("no_encontrado", "No encontramos esa cotización.");
    return q;
  }
  private validateLines(lines: LineInput[]): void {
    if (lines.length === 0) throw new AppError("sin_lineas", "Agrega al menos un producto o servicio.");
    const bad = lines.findIndex((l) => !lineIsValid(l));
    if (bad >= 0) throw new AppError("linea_invalida", `Revisa la línea ${bad + 1}: necesita descripción, cantidad mayor que cero y precio.`);
  }

  /* ───────────── Núcleo ───────────── */

  async appInfo(): Promise<AppInfo> {
    return wait({ version: "0.2.0-demo", data_dir: "(memoria del navegador)", backups_dir: "(no disponible en la demostración)", companies: [this.company], mode: "demo" as const });
  }
  async createCompany(name: string, profile: BusinessProfile): Promise<CreatedCompany> {
    this.company = { ...this.company, name, profile };
    this.biz = { ...this.biz, name, profile, tax_enabled: profile !== "emprendedor" };
    return wait({ company: this.company, recovery_key: "DEMO-SIN-CLAVE-REAL" });
  }
  async openCompany(): Promise<SessionInfo> {
    return wait(this.session());
  }
  async recoverKey(): Promise<void> { return wait(undefined); }
  async business(): Promise<BusinessSettings> { return wait(this.biz); }
  async updateBusiness(patch: Partial<BusinessSettings>): Promise<BusinessSettings> {
    this.require("config.editar");
    if (patch.name !== undefined && !patch.name.trim()) throw new AppError("nombre", "El nombre del negocio no puede quedar vacío.");
    this.biz = { ...this.biz, ...patch };
    this.log("negocio.editar", "negocio", null);
    return wait(this.biz);
  }
  async ruleValue(code: string): Promise<{ value: number; source: string } | null> {
    const v = reglas.values.find((x) => x.code === code);
    return wait(v ? { value: v.value, source: `${reglas.code} · ${v.source}` } : null);
  }
  async verifyAudit(): Promise<ChainReport> { return wait({ entries: this.auditRows.length, ok: true, broken_at: null }, 300); }
  async auditLog(query: string, beforeId?: number): Promise<AuditRow[]> {
    this.require("auditoria.ver");
    const q = norm(query.trim());
    return wait(this.auditRows.filter((r) => (beforeId === undefined || r.id < beforeId) && (!q || norm(`${r.user_name} ${r.action} ${r.entity} ${r.entity_id ?? ""}`).includes(q))).slice(0, 100));
  }
  async security(): Promise<SecuritySettings> { return wait({ lock_minutes: this.lockMinutes }); }
  async updateSecurity(s: SecuritySettings): Promise<SecuritySettings> {
    this.require("usuarios.gestionar");
    if (s.lock_minutes < 0 || s.lock_minutes > 480) throw new AppError("validacion", "El bloqueo por inactividad puede ser de hasta 480 minutos.");
    this.lockMinutes = s.lock_minutes;
    this.log("seguridad.editar", "negocio", null);
    return wait({ lock_minutes: this.lockMinutes });
  }

  /* ───────────── Sesión y usuarios ───────────── */

  private session(): SessionInfo {
    const u = this.users.find((x) => x.uid === this.current) ?? null;
    return {
      company: { ...this.company, name: this.biz.name, profile: this.biz.profile }, cipher_version: "demostración (sin cifrado)",
      customers: this.customers.length, audit: { entries: this.auditRows.length, ok: true, broken_at: null },
      login_required: u === null,
      user: u && { uid: u.uid, username: u.username, display_name: u.display_name, roles: u.roles, permissions: [...this.perms(u)] },
      login_users: this.users.filter((x) => x.is_active && x.password).map((x) => [x.username, x.display_name] as [string, string]),
      lock_minutes: u ? this.lockMinutes : 0,
    };
  }
  private anyPassword(): boolean { return this.users.some((u) => u.is_active && u.password); }
  private ensureOwnerCanLogIn(): void {
    if (this.anyPassword() && !this.users.some((u) => u.is_active && u.password && u.roles.some((r) => r === "dueno" || r === "admin"))) {
      throw new AppError("validacion", "Primero asigna una contraseña a un usuario Dueño o Administrador: al activar contraseñas, NÚCLEO pedirá iniciar sesión.");
    }
  }
  private publicUser(u: UserRow & { password: string | null }): UserRow {
    const { password, ...rest } = u;
    return { ...rest, has_password: !!password };
  }
  async sessionInfo(): Promise<SessionInfo> { return wait(this.session()); }
  async login(username: string, password: string): Promise<SessionInfo> {
    const u = this.users.find((x) => x.username === username.trim().toLowerCase() && x.is_active);
    if (!u || !u.password || u.password !== password) throw new AppError("credenciales", "Usuario o contraseña incorrectos.");
    this.current = u.uid;
    u.last_login_at = now();
    this.log("sesion.iniciar", "usuario", u.uid);
    return wait(this.session());
  }
  async logout(): Promise<SessionInfo> {
    this.log("sesion.cerrar", "usuario", this.current);
    this.current = this.anyPassword() ? null : (this.users.find((u) => u.is_active && u.roles.includes("dueno"))?.uid ?? null);
    return wait(this.session());
  }
  async listUsers(): Promise<UserRow[]> { this.require("usuarios.gestionar"); return wait(this.users.map((u) => this.publicUser(u))); }
  async roles(): Promise<{ roles: RoleRow[]; permissions: PermissionRow[] }> {
    this.require("usuarios.gestionar");
    return wait({ roles: this.roleList, permissions: DEMO_PERMISSIONS });
  }
  async createUser(input: NewUser): Promise<UserRow> {
    this.require("usuarios.gestionar");
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,60}$/.test(username)) throw new AppError("validacion", "El usuario debe tener entre 2 y 60 caracteres: letras sin tilde, números, punto o guion.");
    if (!input.display_name.trim()) throw new AppError("validacion", "El nombre es obligatorio.");
    if (input.roles.length === 0) throw new AppError("validacion", "Asigna al menos un rol al usuario.");
    if (this.users.some((u) => u.username === username)) throw new AppError("duplicado", "Ya existe un registro con el mismo nombre de usuario.");
    if (input.password && input.password.length < 8) throw new AppError("validacion", "La contraseña debe tener al menos 8 caracteres.");
    const u = { id: this.users.length + 1, uid: uid("usr"), username, display_name: input.display_name.trim(), has_password: !!input.password, is_active: true, last_login_at: null, created_at: now(), roles: input.roles, password: input.password || null };
    this.users.push(u);
    try { this.ensureOwnerCanLogIn(); } catch (e) { this.users.pop(); throw e; }
    this.log("usuario.crear", "usuario", u.uid);
    return wait(this.publicUser(u));
  }
  async updateUser(uidv: string, patch: UserPatch): Promise<UserRow> {
    this.require("usuarios.gestionar");
    const u = this.users.find((x) => x.uid === uidv);
    if (!u) throw new AppError("no_encontrado", "No encontramos ese usuario.");
    if (patch.roles.length === 0) throw new AppError("validacion", "Asigna al menos un rol al usuario.");
    const before = structuredClone(u);
    Object.assign(u, { display_name: patch.display_name.trim(), is_active: patch.is_active, roles: patch.roles });
    const owners = this.users.filter((x) => x.is_active && x.roles.some((r) => r === "dueno" || r === "admin")).length;
    try {
      if (owners === 0) throw new AppError("validacion", "Debe quedar al menos un usuario activo con rol Dueño o Administrador.");
      this.ensureOwnerCanLogIn();
    } catch (e) { Object.assign(u, before); throw e; }
    this.log("usuario.editar", "usuario", u.uid);
    return wait(this.publicUser(u));
  }
  async setPassword(uidv: string, password: string | null): Promise<void> {
    if (this.current !== uidv) this.require("usuarios.gestionar");
    const u = this.users.find((x) => x.uid === uidv);
    if (!u) throw new AppError("no_encontrado", "No encontramos ese usuario.");
    if (password && password.length < 8) throw new AppError("validacion", "La contraseña debe tener al menos 8 caracteres.");
    const before = u.password;
    u.password = password || null;
    try { this.ensureOwnerCanLogIn(); } catch (e) { u.password = before; throw e; }
    this.log(password ? "usuario.contrasena" : "usuario.quitar_contrasena", "usuario", u.uid);
    return wait(undefined);
  }
  async updateRolePermissions(role: string, permissions: string[]): Promise<RoleRow> {
    this.require("usuarios.gestionar");
    if (role === "dueno" || role === "admin") throw new AppError("validacion", "Los roles Dueño y Administrador siempre tienen todos los permisos.");
    const r = this.roleList.find((x) => x.code === role);
    if (!r) throw new AppError("no_encontrado", "No encontramos ese rol.");
    r.permissions = [...permissions].sort();
    this.log("rol.permisos", "rol", role);
    return wait(r);
  }

  /* ───────────── Numeración y monedas ───────────── */

  async sequences(): Promise<SequenceRow[]> {
    return wait(Object.entries(this.seqCfg).map(([doc_type, c]) => ({ doc_type, name: c.name, prefix: c.prefix, width: c.width, next_number: (this.seq[doc_type] ?? 0) + 1, last_used: this.seq[doc_type] ?? 0 })));
  }
  async updateSequence(docType: string, prefix: string, nextNumber: number, width: number): Promise<SequenceRow> {
    this.require("config.editar");
    const c = this.seqCfg[docType];
    if (!c) throw new AppError("no_encontrado", "Tipo de documento desconocido.");
    const p = prefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(p)) throw new AppError("validacion", "El prefijo debe tener de 1 a 6 letras o números, sin tildes.");
    if (width < 3 || width > 12) throw new AppError("validacion", "El largo del número debe estar entre 3 y 12 dígitos.");
    const used = this.seq[docType] ?? 0;
    if (nextNumber <= used) throw new AppError("validacion", `El siguiente número debe ser mayor que ${used}, el último ya usado.`);
    if (nextNumber >= 10 ** width) throw new AppError("validacion", "El siguiente número no cabe en el largo elegido.");
    Object.assign(c, { prefix: p, width });
    this.seq[docType] = nextNumber - 1;
    this.log("numeracion.editar", "numeracion", docType);
    return wait({ doc_type: docType, name: c.name, prefix: p, width, next_number: nextNumber, last_used: used });
  }
  async currencies(): Promise<CurrencyRow[]> {
    const base: [string, string, number, string][] = [["CLP", "Peso chileno", 0, "$"], ["USD", "Dólar estadounidense", 2, "US$"], ["EUR", "Euro", 2, "€"], ["CNY", "Yuan chino", 2, "CN¥"]];
    return wait(base.map(([code, name, decimals, symbol]) => {
      const last = this.rateRows.filter((r) => r.currency_code === code).sort((a, b) => b.rate_date.localeCompare(a.rate_date))[0];
      return { code, name, decimals, symbol, last_rate_e6: last?.rate_e6 ?? null, last_rate_date: last?.rate_date ?? null };
    }));
  }
  async rates(currency: string): Promise<RateRow[]> {
    return wait(this.rateRows.filter((r) => r.currency_code === currency).sort((a, b) => b.rate_date.localeCompare(a.rate_date)));
  }
  async setRate(currency: string, date: string, rateE6: number, note?: string): Promise<void> {
    this.require("config.editar");
    if (currency === "CLP") throw new AppError("validacion", "El peso chileno es la moneda base: no lleva tipo de cambio.");
    if (!(rateE6 > 0)) throw new AppError("validacion", "El tipo de cambio debe ser mayor que cero.");
    this.rateRows = this.rateRows.filter((r) => !(r.currency_code === currency && r.rate_date === date));
    this.rateRows.push({ currency_code: currency, rate_date: date, rate_e6: rateE6, note: note ?? null, created_at: now() });
    this.log("moneda.tasa", "moneda", currency);
    return wait(undefined);
  }

  /* ───────────── Documentos adjuntos ───────────── */

  private linkKey(link: EntityRef): string { return `${link.entity}:${link.uid}`; }
  async addAttachment(source: FileSource, description: string | null, link: EntityRef | null): Promise<AttachmentRow> {
    this.require("documentos.subir");
    if (!("file" in source)) throw new AppError("archivo", "Elige un archivo.");
    const f = source.file;
    if (f.size > 50 * 1024 * 1024) throw new AppError("documento", "El archivo supera el máximo de 50 MB.");
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(f); });
    const sha256 = await sha256Hex(f);
    const row = { id: this.files.length + 1, uid: uid("doc"), sha256, file_name: f.name, mime_type: f.type || "application/octet-stream", size_bytes: f.size, description: description?.trim() || null, created_by: this.me().display_name, created_at: now(), links: link ? [this.linkKey(link)] : [], dataUrl, archived: false };
    this.files.push(row);
    this.log("documento.adjuntar", "documento", row.uid);
    const { dataUrl: _d, archived: _a, ...pub } = row;
    return wait(pub);
  }
  async listAttachments(query: string, link: EntityRef | null): Promise<AttachmentRow[]> {
    this.require("documentos.ver");
    const q = norm(query.trim());
    return wait(this.files
      .filter((f) => !f.archived && (!link || f.links.includes(this.linkKey(link))) && (!q || norm(`${f.file_name} ${f.description ?? ""}`).includes(q)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ dataUrl: _d, archived: _a, ...pub }) => pub));
  }
  async exportAttachment(row: AttachmentRow): Promise<boolean> {
    this.require("documentos.ver");
    const f = this.files.find((x) => x.uid === row.uid);
    if (!f) throw new AppError("no_encontrado", "No encontramos ese documento.");
    const a = document.createElement("a");
    a.href = f.dataUrl;
    a.download = f.file_name;
    a.click();
    this.log("documento.exportar", "documento", f.uid);
    return true;
  }
  async attachmentPreview(uidv: string): Promise<string | null> {
    const f = this.files.find((x) => x.uid === uidv);
    return wait(f && f.mime_type.startsWith("image/") ? f.dataUrl : null);
  }
  async archiveAttachment(uidv: string, reason: string): Promise<void> {
    this.require("documentos.quitar");
    if (!reason.trim()) throw new AppError("validacion", "Escribe por qué quitas el documento: queda en la auditoría.");
    const f = this.files.find((x) => x.uid === uidv && !x.archived);
    if (!f) throw new AppError("no_encontrado", "No encontramos ese documento.");
    f.archived = true;
    this.log("documento.quitar", "documento", f.uid, reason.trim());
    return wait(undefined);
  }
  async createBackup(): Promise<BackupDone> {
    throw new AppError("demo", "En la demostración no se crean respaldos. En el programa instalado quedan cifrados en tu computador.");
  }
  async restoreBackup(): Promise<{ name: string }> {
    throw new AppError("demo", "En la demostración no se restauran respaldos.");
  }

  async globalSearch(query: string): Promise<SearchHit[]> {
    const q = norm(query.trim());
    if (!q) return wait([]);
    const hits: SearchHit[] = [];
    for (const c of this.customers) if (norm(`${c.name} ${c.rut ?? ""} ${c.email ?? ""}`).includes(q)) hits.push({ kind: "cliente", uid: c.uid, title: c.name, subtitle: c.rut ? `RUT ${c.rut}` : "Cliente" });
    for (const p of this.products) if (norm(`${p.name} ${p.sku}`).includes(q)) hits.push({ kind: "producto", uid: p.uid, title: p.name, subtitle: `${p.sku} · stock ${p.on_hand_milli / 1000} ${p.unit}` });
    for (const s of this.sales) if (norm(`${s.number} ${this.customerName(s.customer_uid)}`).includes(q)) hits.push({ kind: "venta", uid: s.uid, title: `${s.number} · ${this.customerName(s.customer_uid)}`, subtitle: s.issue_date });
    for (const x of this.quotes) if (norm(`${x.number} ${this.customerName(x.customer_uid, x.prospect_name)}`).includes(q)) hits.push({ kind: "cotizacion", uid: x.uid, title: `${x.number} · ${this.customerName(x.customer_uid, x.prospect_name)}`, subtitle: x.issue_date });
    for (const o of this.pos) if (norm(`${o.number} ${this.supplierName(o.supplier_uid)}`).includes(q)) hits.push({ kind: "orden_compra", uid: o.uid, title: `${o.number} · ${this.supplierName(o.supplier_uid)}`, subtitle: o.issue_date });
    for (const v of this.suppliers) if (norm(`${v.name} ${v.rut ?? ""}`).includes(q)) hits.push({ kind: "proveedor", uid: v.uid, title: v.name, subtitle: v.rut ?? "Proveedor" });
    for (const f of this.files) if (!f.archived && norm(`${f.file_name} ${f.description ?? ""}`).includes(q)) hits.push({ kind: "documento", uid: f.uid, title: f.file_name, subtitle: f.description ?? "Documento adjunto" });
    return wait(hits.slice(0, 30), 30);
  }

  /* ───────────── Inicio ───────────── */

  async dashboard(): Promise<Dashboard> {
    const t = this.today;
    const ym = t.slice(0, 7);
    const prev = (() => { const d = new Date(`${t}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
    const live = this.sales.filter((s) => s.commercial_state === "efectuada" || s.commercial_state === "cerrada");
    const sumBy = (pred: (s: SaleRec) => boolean, f: (s: SaleRec) => number) => live.filter(pred).reduce((a, s) => a + f(s), 0);
    const today = live.filter((s) => s.issue_date === t);
    const month = sumBy((s) => s.issue_date.startsWith(ym), (s) => s.totals.total_minor);
    const monthNet = sumBy((s) => s.issue_date.startsWith(ym), (s) => s.totals.net_minor + s.totals.exempt_minor);
    const monthCost = sumBy((s) => s.issue_date.startsWith(ym), (s) => s.cost_minor);
    const monthTax = sumBy((s) => s.issue_date.startsWith(ym), (s) => s.totals.tax_minor);
    const expenses = Math.round((1_240_000 * Number(t.slice(8, 10))) / 30 / 1000) * 1000; // gastos fijos proporcionales al día del mes
    const prevMonth = (this.history[prev] ?? 0) + sumBy((s) => s.issue_date.startsWith(prev), (s) => s.totals.total_minor);
    const open = live.filter((s) => this.payState(s) !== "pagada");
    const receivable = open.reduce((a, s) => a + s.totals.total_minor - this.paid(s), 0);
    const overdue = open.filter((s) => s.due_date && s.due_date < t).reduce((a, s) => a + s.totals.total_minor - this.paid(s), 0);
    const payable = this.purchases.filter((c) => c.status === "registrada").reduce((a, c) => a + c.totals.total_minor - this.paidOf(c.payments), 0) + 640_000;
    const collected = live.reduce((a, s) => a + s.payments.filter((p) => p.date >= addDays(t, -45)).reduce((x, p) => x + p.amount_minor, 0), 0);
    const purchaseCredit = this.purchases.filter((c) => c.status === "registrada").reduce((a, c) => a + c.totals.tax_minor, 0);
    const series: Dashboard["series"] = [];
    for (let m = 11; m >= 0; m--) {
      const d = new Date(`${t}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() - m);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      series.push({ month: key, sales_minor: (this.history[key] ?? 0) + sumBy((s) => s.issue_date.startsWith(key), (s) => s.totals.total_minor) });
    }
    const upcoming: Dashboard["upcoming_payments"] = [
      ...open.filter((s) => s.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 4).map((s) => ({ label: `${s.number} · ${this.customerName(s.customer_uid)}`, date: s.due_date!, amount_minor: s.totals.total_minor - this.paid(s), kind: "cobro" as const })),
      { label: `Arriendo local`, date: addDays(t, 5), amount_minor: 650_000, kind: "pago" as const },
      ...this.purchases.filter((c) => c.status === "registrada" && c.due_date && this.paidOf(c.payments) < c.totals.total_minor).slice(0, 3)
        .map((c) => ({ label: `${c.doc_kind ?? "Compra"} ${c.doc_number ?? c.number} · ${this.supplierName(c.supplier_uid)}`, date: c.due_date!, amount_minor: c.totals.total_minor - this.paidOf(c.payments), kind: "pago" as const })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    return wait({
      today_sales_minor: today.reduce((a, s) => a + s.totals.total_minor, 0), today_sales_count: today.length,
      month_sales_minor: month, month_prev_sales_minor: prevMonth, month_expenses_minor: expenses,
      month_profit_minor: monthNet - monthCost - expenses, receivable_minor: receivable, receivable_overdue_minor: overdue,
      payable_minor: payable, cash_minor: this.cashBase + collected - payable / 3,
      tax_estimate_minor: this.biz.tax_enabled ? Math.max(0, monthTax - purchaseCredit) : null,
      low_stock: this.products.filter((p) => p.kind === "producto" && p.on_hand_milli <= p.min_milli).map((p) => ({ uid: p.uid, name: p.name, on_hand_milli: p.on_hand_milli, min_milli: p.min_milli })),
      pending_documentation: live.filter((s) => s.documentation_state === "pendiente").length,
      upcoming_payments: upcoming.slice(0, 6), series,
    }, 120);
  }

  /* ───────────── Clientes y productos ───────────── */

  async searchCustomers(query: string): Promise<Customer[]> {
    const q = norm(query.trim());
    const rows = q ? this.customers.filter((c) => norm(`${c.name} ${c.rut ?? ""} ${(c.rut ?? "").replace(/\D/g, "")} ${c.email ?? ""}`).includes(q)) : this.customers;
    return wait([...rows].sort((a, b) => a.name.localeCompare(b.name, "es")), 40);
  }
  async customer(u: string): Promise<CustomerDetail> {
    const c = this.customers.find((x) => x.uid === u);
    if (!c) throw new AppError("no_encontrado", "No encontramos ese cliente.");
    const own = this.sales.filter((s) => s.customer_uid === u && s.commercial_state !== "anulada" && s.commercial_state !== "borrador").sort((a, b) => b.issue_date.localeCompare(a.issue_date));
    const dates = [...new Set(own.map((s) => s.issue_date))].sort();
    let gaps = 0;
    for (let i = 1; i < dates.length; i++) gaps += daysBetween(dates[i - 1]!, dates[i]!);
    return wait({
      ...c, sales_count: own.length, revenue_minor: own.reduce((a, s) => a + s.totals.total_minor, 0),
      receivable_minor: own.reduce((a, s) => a + s.totals.total_minor - this.paid(s), 0), last_sale_date: own[0]?.issue_date ?? null,
      avg_days_between: dates.length > 1 ? Math.round(gaps / (dates.length - 1)) : null, recent: own.slice(0, 8).map((s) => this.summary(s)),
    });
  }
  private customerFields(input: NewCustomer, selfUid?: string): Pick<Customer, "name" | "rut" | "email" | "phone"> {
    if (!input.name.trim()) throw new AppError("nombre", "El nombre del cliente es obligatorio.");
    let rut: string | null = null;
    if (input.rut?.trim()) {
      const clean = input.rut.replace(/[.\s]/g, "").toUpperCase();
      const m = /^(\d{1,8})-?([\dK])$/.exec(clean);
      if (!m || rutDv(Number(m[1])) !== m[2]) throw new AppError("rut", "El RUT no es válido: revisa el dígito verificador.");
      rut = `${m[1]}-${m[2]}`;
      if (this.customers.some((c) => c.rut === rut && c.uid !== selfUid)) throw new AppError("rut_duplicado", "Ya existe un cliente con ese RUT.");
    }
    if (input.email?.trim() && !input.email.includes("@")) throw new AppError("correo", "El correo no tiene un formato válido.");
    return { name: input.name.trim(), rut, email: input.email?.trim() || null, phone: input.phone?.trim() || null };
  }
  async addCustomer(input: NewCustomer): Promise<Customer> {
    this.require("clientes.editar");
    const c: Customer = { id: this.customers.length + 1, uid: uid("cli"), ...this.customerFields(input), created_at: now() };
    this.customers.push(c);
    this.log("cliente.crear", "cliente", c.uid);
    return wait(c);
  }
  async updateCustomer(u: string, input: NewCustomer): Promise<Customer> {
    this.require("clientes.editar");
    const c = this.customers.find((x) => x.uid === u);
    if (!c) throw new AppError("no_encontrado", "No encontramos ese cliente.");
    Object.assign(c, this.customerFields(input, u));
    this.log("cliente.editar", "cliente", c.uid);
    return wait({ ...c });
  }
  async searchProducts(query: string): Promise<Product[]> {
    const q = norm(query.trim());
    const words = q.split(/\s+/).filter(Boolean);
    const rows = words.length ? this.products.filter((p) => { const h = norm(`${p.name} ${p.sku}`); return words.every((w) => h.includes(w)); }) : this.products;
    return wait(rows, 30);
  }
  async updateProduct(u: string, patch: ProductPatch): Promise<Product> {
    this.require("productos.editar");
    const p = this.products.find((x) => x.uid === u);
    if (!p) throw new AppError("no_encontrado", "No encontramos ese producto.");
    if (!patch.name.trim()) throw new AppError("nombre", "El nombre del producto es obligatorio.");
    if (!patch.sku.trim()) throw new AppError("codigo", "El código es obligatorio.");
    if (this.products.some((x) => x.uid !== u && x.sku.toLowerCase() === patch.sku.trim().toLowerCase())) throw new AppError("duplicado", "Ya existe un producto con ese código.");
    Object.assign(p, { name: patch.name.trim(), sku: patch.sku.trim(), unit: patch.unit, price_minor: patch.price_minor, taxable: patch.taxable, min_milli: patch.min_milli });
    this.log("producto.editar", "producto", p.uid);
    return wait({ ...p });
  }
  async addProduct(input: NewProduct): Promise<Product> {
    if (!input.name.trim()) throw new AppError("nombre", "El nombre del producto es obligatorio.");
    const p: Product = {
      uid: uid("pro"), sku: input.sku?.trim() || `P-${this.products.length + 1}`, name: input.name.trim(), unit: input.unit || "un", kind: input.kind,
      price_minor: input.price_minor, cost_e4: (input.cost_minor ?? 0) * 10_000, on_hand_milli: input.kind === "producto" ? Math.max(0, input.initial_stock_milli ?? 0) : 0, min_milli: 0, taxable: input.taxable ?? true,
    };
    this.products.push(p);
    if (p.on_hand_milli > 0) this.mv(p.uid, p.on_hand_milli, "inicial", "Stock inicial", "AJU", null, "Stock inicial", this.today, p.cost_e4);
    this.log("producto.crear", "producto", p.uid);
    return wait(p);
  }

  /* ───────────── Ventas ───────────── */

  async listQuotes(query = ""): Promise<QuoteSummary[]> {
    const q = norm(query);
    return wait(this.quotes.map((x) => this.quoteSummary(x)).filter((x) => !q || norm(`${x.number} ${x.customer_name}`).includes(q)).sort((a, b) => b.number.localeCompare(a.number)));
  }
  async quote(u: string): Promise<QuoteDetail> { return wait(this.quoteDetail(this.findQuote(u))); }
  async saveQuote(input: QuoteInput, u?: string): Promise<QuoteDetail> {
    this.validateLines(input.lines);
    if (!input.customer_uid && !input.prospect_name?.trim()) throw new AppError("cliente", "Elige un cliente o escribe el nombre del interesado.");
    if (u) {
      const q = this.findQuote(u);
      if (q.status === "convertida" || q.status === "anulada") throw new AppError("bloqueada", "Esta cotización ya no se puede modificar.");
      Object.assign(q, { customer_uid: input.customer_uid, prospect_name: input.prospect_name ?? null, issue_date: input.issue_date, valid_until: input.valid_until, lines: computeLines(input.lines), totals: computeTotals(input.lines, this.taxPpm()), notes: input.notes ?? null });
      this.log("cotizacion.editar", "cotizacion", q.number);
      return wait(this.quoteDetail(q));
    }
    const q = this.makeQuote(input.customer_uid, input.prospect_name ?? null, input.issue_date, input.lines);
    q.valid_until = input.valid_until;
    q.notes = input.notes ?? null;
    this.quotes.push(q);
    this.log("cotizacion.crear", "cotizacion", q.number);
    return wait(this.quoteDetail(q));
  }
  async setQuoteStatus(u: string, status: "enviada" | "aceptada" | "rechazada" | "anulada"): Promise<QuoteDetail> {
    const q = this.findQuote(u);
    if (q.status === "convertida") throw new AppError("bloqueada", "La cotización ya se convirtió en venta.");
    q.status = status;
    this.log("cotizacion.estado", "cotizacion", q.number);
    return wait(this.quoteDetail(q));
  }
  async convertQuote(u: string): Promise<SaleDetail> {
    const q = this.findQuote(u);
    if (q.status === "convertida") throw new AppError("ya_convertida", "Esta cotización ya se convirtió en venta.");
    if (q.status === "anulada" || q.status === "rechazada") throw new AppError("estado", "Una cotización anulada o rechazada no se puede convertir.");
    const input: LineInput[] = q.lines.map(({ product_uid, description, qty_milli, unit_price_minor, discount_ppm, taxable }) => ({ product_uid, description, qty_milli, unit_price_minor, discount_ppm, taxable }));
    const s = this.makeSale("VEN", q.customer_uid, this.today, input, q.uid);
    s.commercial_state = "aceptada";
    s.timeline = [{ at: now(), text: `Creada desde ${q.number} sin volver a digitar` }];
    q.status = "convertida";
    q.sale_uid = s.uid;
    this.sales.push(s);
    this.log("cotizacion.convertir", "cotizacion", q.number);
    return wait(this.detail(s));
  }
  async listSales(filter: SaleFilter): Promise<SaleSummary[]> {
    const q = norm(filter.query ?? "");
    let rows = this.sales.map((s) => this.summary(s));
    if (q) rows = rows.filter((s) => norm(`${s.number} ${s.customer_name}`).includes(q));
    switch (filter.view) {
      case "por_cobrar": rows = rows.filter((s) => (s.commercial_state === "efectuada" || s.commercial_state === "cerrada") && s.payment_state !== "pagada"); break;
      case "pendientes_doc": rows = rows.filter((s) => s.documentation_state === "pendiente" && s.commercial_state !== "anulada"); break;
      case "borradores": rows = rows.filter((s) => ["borrador", "cotizada", "aceptada"].includes(s.commercial_state)); break;
      case "anuladas": rows = rows.filter((s) => s.commercial_state === "anulada"); break;
      default: rows = rows.filter((s) => s.commercial_state !== "anulada");
    }
    return wait(rows.sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.number.localeCompare(a.number)), 50);
  }
  async sale(u: string): Promise<SaleDetail> { return wait(this.detail(this.findSale(u))); }
  async saveSale(input: SaleInput, u?: string): Promise<SaleDetail> {
    this.validateLines(input.lines);
    if (u) {
      const s = this.findSale(u);
      if (!["borrador", "cotizada", "aceptada"].includes(s.commercial_state)) throw new AppError("bloqueada", "Una venta efectuada no se modifica: anúlala o registra una devolución.");
      Object.assign(s, { customer_uid: input.customer_uid, issue_date: input.issue_date, lines: computeLines(input.lines), totals: computeTotals(input.lines, this.taxPpm()), notes: input.notes ?? null });
      this.log("venta.editar", "venta", s.number);
      return wait(this.detail(s));
    }
    const s = this.makeSale(input.doc_type, input.customer_uid, input.issue_date, input.lines, null);
    s.notes = input.notes ?? null;
    this.sales.push(s);
    this.log("venta.crear", "venta", s.number);
    return wait(this.detail(s));
  }
  async effectSale(u: string, input: EffectInput): Promise<SaleDetail> {
    const s = this.findSale(u);
    if (!["borrador", "cotizada", "aceptada"].includes(s.commercial_state)) throw new AppError("estado", "Esta venta ya fue efectuada o anulada.");
    if (input.mode === "credito" && !s.customer_uid) throw new AppError("credito", "Para vender a crédito elige un cliente: necesitamos saber quién te debe.");
    if (input.mode === "credito" && !input.due_date) throw new AppError("vencimiento", "Indica la fecha en que te pagarán.");
    if (!this.allowNegative) {
      const short = s.lines.filter((l) => { const p = this.products.find((x) => x.uid === l.product_uid); return p && p.kind === "producto" && this.whQty(p.uid, this.defWh().uid) < l.qty_milli; });
      if (short.length) throw new AppError("sin_stock", `No hay stock suficiente en la bodega principal: ${short.map((l) => l.description).join(", ")}. Registra la compra o un ajuste, o permite vender sin stock.`);
    }
    for (const l of s.lines) {
      const p = this.products.find((x) => x.uid === l.product_uid);
      if (p && p.kind === "producto") { p.on_hand_milli -= l.qty_milli; l.unit_cost_e4 = p.cost_e4; this.mv(p.uid, -l.qty_milli, "salida", s.number, s.doc_type, s.uid, null, s.issue_date); }
    }
    s.cost_minor = this.costOf(s.lines);
    s.commercial_state = "efectuada";
    s.payment_method = input.mode === "credito" ? "Crédito" : input.method;
    s.due_date = input.mode === "credito" ? input.due_date : null;
    s.documentation_state = this.biz.documentation_reminder ? "pendiente" : "no_aplica";
    s.timeline.push({ at: now(), text: "Venta efectuada: se descontó stock y se fijaron costo y margen" });
    if (input.mode === "contado") {
      s.payments.push({ number: this.next("PAG"), date: this.today, amount_minor: s.totals.total_minor, method: input.method });
      s.timeline.push({ at: now(), text: `Pago registrado (${input.method})` });
    } else {
      s.timeline.push({ at: now(), text: "Queda en Dinero que te deben" });
    }
    if (s.documentation_state === "pendiente") s.timeline.push({ at: now(), text: "Pendiente de documentación tributaria" });
    this.autoClose(s);
    this.log("venta.efectuar", "venta", s.number);
    return wait(this.detail(s), 150);
  }
  async registerPayment(u: string, amount: number, method: string, date: string): Promise<SaleDetail> {
    const s = this.findSale(u);
    if (s.commercial_state !== "efectuada") throw new AppError("estado", "Solo se registran pagos de ventas efectuadas.");
    const due = s.totals.total_minor - this.paid(s);
    if (amount <= 0) throw new AppError("monto", "El monto debe ser mayor que cero.");
    if (amount > due) throw new AppError("monto", `El pago supera el saldo pendiente.`);
    s.payments.push({ number: this.next("PAG"), date, amount_minor: amount, method });
    s.timeline.push({ at: now(), text: amount === due ? `Pago final registrado (${method})` : `Abono registrado (${method})` });
    this.autoClose(s);
    this.log("pago.registrar", "venta", s.number);
    return wait(this.detail(s));
  }
  async markDocumented(u: string, ref: ExternalRefInput): Promise<SaleDetail> {
    const s = this.findSale(u);
    if (s.commercial_state === "anulada" || s.commercial_state === "borrador") throw new AppError("estado", "Solo se documentan ventas efectuadas.");
    s.documentation_state = "documentada";
    s.external_ref = { doc_kind: ref.doc_kind || null, external_number: ref.external_number || null, issue_date: ref.issue_date || null, observation: ref.observation || null, marked_at: now() };
    s.timeline.push({ at: now(), text: `Marcada como documentada${ref.doc_kind ? ` · ${ref.doc_kind}` : ""}${ref.external_number ? ` Nº ${ref.external_number}` : ""}` });
    this.autoClose(s);
    this.log("venta.documentar", "venta", s.number);
    return wait(this.detail(s));
  }
  async setDocumentationNotApplicable(u: string): Promise<SaleDetail> {
    const s = this.findSale(u);
    s.documentation_state = "no_aplica";
    s.timeline.push({ at: now(), text: "Documentación tributaria: no aplica" });
    this.autoClose(s);
    this.log("venta.no_aplica", "venta", s.number);
    return wait(this.detail(s));
  }
  async voidSale(u: string, reason: string): Promise<SaleDetail> {
    const s = this.findSale(u);
    if (!reason.trim()) throw new AppError("motivo", "Escribe el motivo de la anulación: queda en la auditoría.");
    if (s.commercial_state === "anulada") throw new AppError("estado", "La venta ya está anulada.");
    if (s.commercial_state === "efectuada" || s.commercial_state === "cerrada") {
      for (const l of s.lines) {
        const p = this.products.find((x) => x.uid === l.product_uid);
        if (p && p.kind === "producto") { p.on_hand_milli += l.qty_milli; this.mv(p.uid, l.qty_milli, "ajuste", s.number, s.doc_type, s.uid, `Anulación de ${s.number}`); }
      }
    }
    s.commercial_state = "anulada";
    s.void_reason = reason.trim();
    s.timeline.push({ at: now(), text: `Anulada: ${reason.trim()} (stock devuelto)` });
    this.log("venta.anular", "venta", s.number);
    return wait(this.detail(s));
  }

  /* ───────────── Inventario ───────────── */

  private defWh(): WhRec { return this.whs.find((w) => w.is_default)!; }
  private mv(product_uid: string, qty: number, kind: MoveRec["kind"], document: string, source_type: string, source_uid: string | null, reason: string | null = null, date = this.today, cost_e4?: number, wh?: string): void {
    const p = this.products.find((x) => x.uid === product_uid);
    this.moves.push({ id: this.moves.length + 1, date, product_uid, wh: wh ?? this.defWh().uid, kind, document, source_type, source_uid, qty, cost_e4: cost_e4 ?? p?.cost_e4 ?? 0, reason });
  }
  /** Saldo de un producto en una bodega según el libro de movimientos. */
  private whQty(product_uid: string, wh: string): number {
    return this.moves.reduce((a, m) => a + (m.product_uid === product_uid && m.wh === wh ? m.qty : 0), 0);
  }
  private seedInventory(): void {
    this.whs = [
      { uid: "wh-principal", code: "B1", name: "Bodega principal", is_default: true, archived: false },
      { uid: "wh-sala", code: "B2", name: "Sala de ventas", is_default: false, archived: false },
    ];
    const start = addDays(this.today, -150);
    const history: MoveRec[] = [];
    for (const s of this.sales) {
      if (s.commercial_state !== "efectuada" && s.commercial_state !== "cerrada") continue;
      for (const l of s.lines) {
        if (!l.product_uid) continue;
        const cost = l.unit_cost_e4 ?? this.products.find((p) => p.uid === l.product_uid)?.cost_e4 ?? 0;
        history.push({ id: 0, date: s.issue_date, product_uid: l.product_uid, wh: "wh-principal", kind: "salida", document: s.number, source_type: s.doc_type, source_uid: s.uid, qty: -l.qty_milli, cost_e4: cost, reason: null });
        // Ventas de los meses anteriores (ya resumidas en el gráfico): mismo ritmo, 45 y 90 días antes.
        for (const back of [45, 90]) history.push({ id: 0, date: addDays(s.issue_date, -back), product_uid: l.product_uid, wh: "wh-principal", kind: "salida", document: "Venta (histórico)", source_type: s.doc_type, source_uid: null, qty: -l.qty_milli, cost_e4: cost, reason: null });
      }
    }
    for (const o of this.pos) for (const r of o.receipts) for (const l of o.lines) if (l.product_uid) history.push({ id: 0, date: r.date, product_uid: l.product_uid, wh: "wh-principal", kind: "entrada", document: r.number, source_type: "OC", source_uid: o.uid, qty: l.received_milli, cost_e4: l.unit_cost_minor * 10_000, reason: null });
    const tra = this.next("TRA");
    const traDate = addDays(this.today, -25);
    for (const p of this.products.filter((x) => x.kind === "producto")) {
      const moved = history.filter((m) => m.product_uid === p.uid).reduce((a, m) => a + m.qty, 0);
      history.push({ id: 0, date: start, product_uid: p.uid, wh: "wh-principal", kind: "inicial", document: "Stock inicial", source_type: "AJU", source_uid: null, qty: p.on_hand_milli - moved, cost_e4: p.cost_e4, reason: "Stock inicial" });
      // Parte del stock de herramientas está exhibido en la sala de ventas.
      if (p.unit === "un" && p.on_hand_milli >= 6000) {
        const q = Math.floor(p.on_hand_milli / 3000) * 1000;
        history.push({ id: 0, date: traDate, product_uid: p.uid, wh: "wh-principal", kind: "transferencia_salida", document: tra, source_type: "TRA", source_uid: null, qty: -q, cost_e4: p.cost_e4, reason: "A Sala de ventas" });
        history.push({ id: 0, date: traDate, product_uid: p.uid, wh: "wh-sala", kind: "transferencia_entrada", document: tra, source_type: "TRA", source_uid: null, qty: q, cost_e4: p.cost_e4, reason: "Desde Bodega principal" });
      }
    }
    history.sort((a, b) => a.date.localeCompare(b.date));
    history.forEach((m, i) => (m.id = i + 1));
    this.moves = history;
    this.stockDocs = [{ uid: "tra-seed", number: tra, kind: "transferencia", date: traDate, description: "Bodega principal → Sala de ventas", lines: history.filter((m) => m.document === tra && m.qty > 0).length, created_by: "Dueño" }];
  }
  private whRow(w: WhRec): Warehouse {
    let value = 0, count = 0;
    for (const p of this.products) {
      if (p.kind !== "producto") continue;
      const q = this.whQty(p.uid, w.uid);
      if (q !== 0) count++;
      if (q > 0) value += Math.round((q * p.cost_e4) / 10_000_000);
    }
    return { ...w, stock_value_minor: value, products_with_stock: count };
  }
  private findWh(u: string): WhRec {
    const w = this.whs.find((x) => x.uid === u);
    if (!w) throw new AppError("no_encontrado", "No encontramos esa bodega.");
    return w;
  }
  private analysis(p: Product): StockAnalysis {
    const today = this.today;
    const start = addDays(today, -89);
    const mine = this.moves.filter((m) => m.product_uid === p.uid);
    let balance = mine.filter((m) => m.date < start).reduce((a, m) => a + m.qty, 0);
    let days = 0, sold = 0;
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const opening = balance;
      let soldToday = 0;
      for (const m of mine) if (m.date === d) { balance += m.qty; if (m.kind === "salida" && (m.source_type === "VEN" || m.source_type === "FV")) soldToday -= m.qty; }
      sold += soldToday;
      if (opening > 0 || soldToday > 0) days++;
    }
    sold -= mine.filter((m) => m.kind === "ajuste" && (m.source_type === "VEN" || m.source_type === "FV") && m.qty > 0 && m.date >= start).reduce((a, m) => a + m.qty, 0);
    sold = Math.max(0, sold);
    const s = this.reorder[p.uid] ?? { safety_days: 7, target_coverage_days: 30, excess_coverage_days: 180, lead_time_days: null };
    const lead = s.lead_time_days ?? 7;
    const inPurchase = this.pos.filter((o) => o.status === "emitida" || o.status === "parcial").reduce((a, o) => a + o.lines.filter((l) => l.product_uid === p.uid).reduce((x, l) => x + l.qty_milli - l.received_milli, 0), 0);
    const arrivals = this.pos.filter((o) => (o.status === "emitida" || o.status === "parcial") && o.expected_date && o.lines.some((l) => l.product_uid === p.uid && l.received_milli < l.qty_milli)).map((o) => o.expected_date!).sort();
    const v = days >= 14 && days > 0 ? sold / 1000 / days : null;
    const onHand = p.on_hand_milli / 1000;
    const position = onHand + inPurchase / 1000;
    const coverage = v && v > 0 ? Math.max(0, onHand) / v : null;
    let advice: StockAnalysis["advice"];
    if (!v) advice = { kind: "sin_datos", quantity_milli: null, explanation: "Faltan datos: se necesitan ventas en al menos 14 días con stock dentro de los últimos 90 días." };
    else {
      const safety = v * s.safety_days, rop = v * lead + safety, cov = position / v;
      const r2 = (x: number) => x.toFixed(2).replace(".", ",");
      if (cov > s.excess_coverage_days) advice = { kind: "exceso", quantity_milli: null, explanation: `Posición ${position} u ÷ velocidad ${r2(v)} u/día = ${cov.toFixed(1).replace(".", ",")} días de cobertura, sobre el umbral de ${s.excess_coverage_days} días.` };
      else if (position > rop) advice = { kind: "no_comprar", quantity_milli: null, explanation: `Posición ${position} u > punto de reorden ${r2(rop)} u (velocidad ${r2(v)} × plazo ${lead} d + seguridad ${r2(safety)}).` };
      else {
        const raw = v * (lead + s.target_coverage_days) + safety - position;
        const qty = Math.ceil(Math.max(0, raw));
        advice = { kind: "comprar", quantity_milli: qty * 1000, explanation: `Velocidad ${r2(v)} u/día × (plazo ${lead} d + cobertura objetivo ${s.target_coverage_days} d) + seguridad ${r2(safety)} − posición ${position} = ${r2(raw)} u → ${qty} u.` };
      }
    }
    const arrivalDays = arrivals[0] ? Math.max(0, daysBetween(today, arrivals[0])) : null;
    const covDays = coverage === null ? null : Math.round(coverage);
    const risk = covDays !== null && covDays < lead + s.safety_days && (arrivalDays === null || arrivalDays > covDays);
    const last = mine.map((m) => m.date).sort().at(-1) ?? null;
    const idle = last ? daysBetween(last, today) : 9999;
    const status: StockAnalysis["status"] = p.on_hand_milli <= 0 ? "sin_stock" : risk ? "riesgo_quiebre" : p.min_milli > 0 && p.on_hand_milli <= p.min_milli ? "bajo_minimo" : advice.kind === "exceso" ? "exceso" : idle >= 90 && sold === 0 ? "sin_movimiento" : "ok";
    return {
      uid: p.uid, sku: p.sku, name: p.name, unit: p.unit, on_hand_milli: p.on_hand_milli, reserved_milli: 0, in_purchase_milli: inPurchase,
      future_milli: p.on_hand_milli + inPurchase, min_milli: p.min_milli, avg_cost_e4: p.cost_e4,
      stock_value_minor: p.on_hand_milli > 0 ? Math.round((p.on_hand_milli * p.cost_e4) / 10_000_000) : 0, sold_milli: sold, days_with_stock: days,
      velocity_milli: v === null ? null : Math.round(v * 1000), coverage_days: covDays, next_arrival: arrivals[0] ?? null, last_movement: last, status, advice,
    };
  }

  async inventorySettings(): Promise<InventorySettings> { return wait({ allow_negative: this.allowNegative }); }
  async updateInventorySettings(x: InventorySettings): Promise<InventorySettings> {
    this.require("config.editar");
    this.allowNegative = x.allow_negative;
    this.log("inventario.config", "negocio", "inventario");
    return wait({ allow_negative: this.allowNegative });
  }
  async warehouses(): Promise<Warehouse[]> { this.require("inventario.ver"); return wait(this.whs.map((w) => this.whRow(w))); }
  async createWarehouse(name: string): Promise<Warehouse[]> {
    this.require("inventario.ajustar");
    if (!name.trim()) throw new AppError("nombre", "El nombre de la bodega es obligatorio.");
    const w: WhRec = { uid: uid("wh"), code: `B${this.whs.length + 1}`, name: name.trim(), is_default: false, archived: false };
    this.whs.push(w);
    this.log("bodega.crear", "bodega", w.uid);
    return this.warehouses();
  }
  async renameWarehouse(u: string, name: string): Promise<Warehouse[]> {
    this.require("inventario.ajustar");
    if (!name.trim()) throw new AppError("nombre", "El nombre de la bodega es obligatorio.");
    this.findWh(u).name = name.trim();
    return this.warehouses();
  }
  async setDefaultWarehouse(u: string): Promise<Warehouse[]> {
    this.require("inventario.ajustar");
    const w = this.findWh(u);
    this.whs.forEach((x) => (x.is_default = false));
    w.is_default = true; w.archived = false;
    return this.warehouses();
  }
  async archiveWarehouse(u: string): Promise<Warehouse[]> {
    this.require("inventario.ajustar");
    const w = this.whRow(this.findWh(u));
    if (w.is_default) throw new AppError("principal", "La bodega principal no se archiva: elige otra como principal primero.");
    if (w.products_with_stock > 0) throw new AppError("con_stock", "La bodega tiene stock: transfiérelo antes de archivarla.");
    this.findWh(u).archived = true;
    return this.warehouses();
  }
  async adjustStock(input: AdjustmentInput): Promise<StockDocDone> {
    this.require("inventario.ajustar");
    const w = this.findWh(input.warehouse_uid);
    if (!input.reason.trim()) throw new AppError("motivo", "Escribe el motivo del ajuste (queda en el kárdex y la auditoría).");
    if (!input.lines.length) throw new AppError("sin_lineas", "Agrega al menos un producto.");
    const number = this.next("AJU");
    let moved = 0;
    for (const l of input.lines) {
      const p = this.products.find((x) => x.uid === l.product_uid);
      if (!p || p.kind !== "producto") continue;
      const delta = input.kind === "conteo" ? l.qty_milli - this.whQty(p.uid, w.uid) : l.qty_milli;
      if (delta === 0) continue;
      p.on_hand_milli += delta;
      this.mv(p.uid, delta, "ajuste", number, "AJU", null, input.reason.trim(), input.date, p.cost_e4, w.uid);
      moved++;
    }
    if (!moved) { this.seq["AJU"]!--; throw new AppError("sin_cambios", input.kind === "conteo" ? "Lo contado coincide con el stock registrado: no hay nada que ajustar." : "Indica al menos una diferencia distinta de cero."); }
    this.stockDocs.unshift({ uid: uid("aju"), number, kind: input.kind, date: input.date, description: `${w.name} · ${input.reason.trim()}`, lines: moved, created_by: this.me().display_name });
    this.log(input.kind === "conteo" ? "inventario.conteo" : "inventario.ajuste", "ajuste", number, input.reason.trim());
    return wait({ number, moved_lines: moved });
  }
  async transferStock(input: TransferInput): Promise<StockDocDone> {
    this.require("inventario.ajustar");
    const from = this.findWh(input.from_uid), to = this.findWh(input.to_uid);
    if (from.uid === to.uid) throw new AppError("bodegas", "Elige bodegas de origen y destino distintas.");
    if (!input.lines.length) throw new AppError("sin_lineas", "Agrega al menos un producto.");
    for (const l of input.lines) {
      const p = this.products.find((x) => x.uid === l.product_uid);
      const have = this.whQty(l.product_uid, from.uid);
      if (l.qty_milli <= 0) throw new AppError("cantidad", "Las cantidades a transferir deben ser mayores que cero.");
      if (have < l.qty_milli) throw new AppError("cantidad", `${p?.name ?? "Producto"}: en ${from.name} hay ${have / 1000} y quieres mover ${l.qty_milli / 1000}.`);
    }
    const number = this.next("TRA");
    for (const l of input.lines) {
      this.mv(l.product_uid, -l.qty_milli, "transferencia_salida", number, "TRA", null, `A ${to.name}`, input.date, undefined, from.uid);
      this.mv(l.product_uid, l.qty_milli, "transferencia_entrada", number, "TRA", null, `Desde ${from.name}`, input.date, undefined, to.uid);
    }
    this.stockDocs.unshift({ uid: uid("tra"), number, kind: "transferencia", date: input.date, description: `${from.name} → ${to.name}`, lines: input.lines.length, created_by: this.me().display_name });
    this.log("inventario.transferir", "transferencia", number);
    return wait({ number, moved_lines: input.lines.length });
  }
  async stockDocuments(): Promise<StockDocRow[]> { this.require("inventario.ver"); return wait(this.stockDocs); }
  async inventoryOverview(): Promise<InventoryOverview> {
    this.require("inventario.ver");
    const rows = this.products.filter((p) => p.kind === "producto").map((p) => this.analysis(p)).sort((a, b) => a.name.localeCompare(b.name, "es"));
    return wait({ window_days: 90, total_value_minor: rows.reduce((a, r) => a + r.stock_value_minor, 0), rows }, 120);
  }
  async productInventory(u: string, warehouseUid?: string): Promise<ProductInventory> {
    this.require("inventario.ver");
    const p = this.products.find((x) => x.uid === u);
    if (!p) throw new AppError("no_encontrado", "No encontramos ese producto.");
    const mine = this.moves.filter((m) => m.product_uid === u && (!warehouseUid || m.wh === warehouseUid)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    let bal = 0;
    const kardex: KardexRow[] = mine.map((m) => {
      bal += m.qty;
      return { id: m.id, date: m.date, warehouse_name: this.whs.find((w) => w.uid === m.wh)?.name ?? "", kind: m.kind, document: m.document, source_type: m.source_type, source_uid: m.source_uid, qty_milli: m.qty, unit_cost_e4: m.cost_e4, avg_cost_after_e4: p.cost_e4, balance_milli: bal, reason: m.reason };
    }).reverse();
    return wait({
      product: p,
      by_warehouse: this.whs.filter((w) => !w.archived).map((w) => ({ warehouse_uid: w.uid, warehouse_name: w.name, on_hand_milli: this.whQty(u, w.uid), avg_cost_e4: p.cost_e4 })),
      kardex, analysis: p.kind === "producto" ? this.analysis(p) : null,
      settings: this.reorder[u] ?? { safety_days: 7, target_coverage_days: 30, excess_coverage_days: 180, lead_time_days: null },
    });
  }
  async updateReorderSettings(u: string, input: ReorderInput): Promise<ProductInventory> {
    this.require("inventario.ajustar");
    const p = this.products.find((x) => x.uid === u);
    if (!p) throw new AppError("no_encontrado", "No encontramos ese producto.");
    if (input.excess_coverage_days <= input.target_coverage_days) throw new AppError("valores", "El umbral de exceso debe ser mayor que la cobertura objetivo.");
    p.min_milli = input.min_milli;
    this.reorder[u] = { safety_days: input.safety_days, target_coverage_days: input.target_coverage_days, excess_coverage_days: input.excess_coverage_days, lead_time_days: input.lead_time_days };
    this.log("producto.reorden", "producto", u);
    return this.productInventory(u);
  }

  /* ───────────── Proveedores y compras ───────────── */

  private buyTotals(lines: { product_uid: string | null; description: string; qty_milli: number; unit_cost_minor: number; taxable: boolean }[]): Totals {
    return computeTotals(lines.map((l) => ({ product_uid: l.product_uid, description: l.description, qty_milli: l.qty_milli, unit_price_minor: l.unit_cost_minor, discount_ppm: 0, taxable: l.taxable })), this.taxPpm());
  }
  private paidOf(p: Payment[]): number { return p.reduce((a, x) => a + x.amount_minor, 0); }
  private supplierName(u: string): string { return this.suppliers.find((x) => x.uid === u)?.name ?? "Proveedor"; }
  private findSupplier(u: string): Supplier {
    const v = this.suppliers.find((x) => x.uid === u);
    if (!v) throw new AppError("no_encontrado", "No encontramos ese proveedor.");
    return v;
  }
  private findPo(u: string): PoRec {
    const o = this.pos.find((x) => x.uid === u);
    if (!o) throw new AppError("no_encontrado", "No encontramos esa orden de compra.");
    return o;
  }
  private findPur(u: string): PurRec {
    const c = this.purchases.find((x) => x.uid === u);
    if (!c) throw new AppError("no_encontrado", "No encontramos ese documento de compra.");
    return c;
  }
  private poSummary(o: PoRec): PurchaseOrderSummary {
    return { uid: o.uid, number: o.number, supplier_name: this.supplierName(o.supplier_uid), issue_date: o.issue_date, expected_date: o.expected_date, status: o.status, total_minor: o.totals.total_minor };
  }
  private poDetail(o: PoRec): PurchaseOrderDetail {
    const docs = this.purchases.filter((c) => c.order_uid === o.uid && c.status === "registrada").map((c) => ({ number: c.number, kind: "COM" as const, uid: c.uid, label: "Documento de compra" }));
    return { ...this.poSummary(o), supplier_uid: o.supplier_uid, lines: o.lines, totals: o.totals, notes: o.notes, void_reason: o.void_reason, receipts: o.receipts, purchases: docs, timeline: o.timeline };
  }
  private purSummary(c: PurRec): PurchaseSummary {
    const paid = this.paidOf(c.payments);
    return {
      uid: c.uid, number: c.number, supplier_name: this.supplierName(c.supplier_uid), doc_kind: c.doc_kind, doc_number: c.doc_number, issue_date: c.issue_date,
      due_date: c.due_date, status: c.status, payment_state: paid <= 0 ? "sin_pago" : paid < c.totals.total_minor ? "abonada" : "pagada", total_minor: c.totals.total_minor, paid_minor: paid,
    };
  }
  private purDetail(c: PurRec): PurchaseDetail {
    const o = c.order_uid ? this.pos.find((x) => x.uid === c.order_uid) : undefined;
    return { ...this.purSummary(c), supplier_uid: c.supplier_uid, lines: c.lines, totals: c.totals, order_uid: c.order_uid, order_number: o?.number ?? null, payments: c.payments, received_stock: c.received_stock, notes: c.notes, void_reason: c.void_reason, timeline: c.timeline };
  }
  private validateBuy(lines: BuyLineInput[]): void {
    if (lines.length === 0) throw new AppError("sin_lineas", "Agrega al menos un producto o servicio.");
    const bad = lines.findIndex((l) => !l.description.trim() || l.qty_milli <= 0 || l.unit_cost_minor < 0);
    if (bad >= 0) throw new AppError("linea_invalida", `Revisa la línea ${bad + 1}: necesita descripción, cantidad mayor que cero y costo.`);
  }
  private stockIn(productUid: string | null, qty: number, costMinor: number, doc = "REC", sourceType = "OC", sourceUid: string | null = null, date = this.today): void {
    const p = this.products.find((x) => x.uid === productUid);
    if (!p || p.kind !== "producto") return;
    this.mv(p.uid, qty, "entrada", doc, sourceType, sourceUid, null, date, costMinor * 10_000);
    const base = Math.max(0, p.on_hand_milli);
    p.cost_e4 = base + qty > 0 ? Math.round((p.cost_e4 * base + costMinor * 10_000 * qty) / (base + qty)) : costMinor * 10_000;
    p.on_hand_milli += qty;
  }

  async searchSuppliers(query: string): Promise<Supplier[]> {
    this.require("proveedores.ver");
    const q = norm(query.trim());
    const rows = q ? this.suppliers.filter((v) => norm(`${v.name} ${v.rut ?? ""} ${v.email ?? ""}`).includes(q)) : this.suppliers;
    return wait([...rows].sort((a, b) => a.name.localeCompare(b.name, "es")), 40);
  }
  async supplier(u: string): Promise<SupplierDetail> {
    this.require("proveedores.ver");
    const v = this.findSupplier(u);
    const docs = this.purchases.filter((c) => c.supplier_uid === u && c.status === "registrada");
    return wait({
      ...v, purchases_count: docs.length, purchased_minor: docs.reduce((a, c) => a + c.totals.total_minor, 0),
      payable_minor: docs.reduce((a, c) => a + c.totals.total_minor - this.paidOf(c.payments), 0),
      last_purchase_date: docs.map((c) => c.issue_date).sort().at(-1) ?? null,
      orders: this.pos.filter((o) => o.supplier_uid === u).map((o) => this.poSummary(o)).slice(0, 8),
      purchases: docs.map((c) => this.purSummary(c)).slice(0, 8),
    });
  }
  private supplierFields(input: NewSupplier, selfUid?: string): Omit<Supplier, "id" | "uid" | "created_at"> {
    const c = this.customerFields({ name: input.name, rut: input.rut, email: input.email, phone: input.phone });
    if (c.rut && this.suppliers.some((v) => v.rut === c.rut && v.uid !== selfUid)) throw new AppError("rut_duplicado", "Ya existe un proveedor con ese RUT.");
    const terms = input.payment_terms_days ?? 0;
    if (terms < 0 || terms > 365) throw new AppError("plazo", "El plazo de pago debe estar entre 0 y 365 días.");
    return { ...c, payment_terms_days: terms };
  }
  async addSupplier(input: NewSupplier): Promise<Supplier> {
    this.require("proveedores.editar");
    const v: Supplier = { id: this.suppliers.length + 1, uid: uid("prv"), ...this.supplierFields(input), created_at: now() };
    this.suppliers.push(v);
    this.log("proveedor.crear", "proveedor", v.uid);
    return wait(v);
  }
  async updateSupplier(u: string, input: NewSupplier): Promise<Supplier> {
    this.require("proveedores.editar");
    const v = this.findSupplier(u);
    Object.assign(v, this.supplierFields(input, u));
    this.log("proveedor.editar", "proveedor", v.uid);
    return wait({ ...v });
  }
  async priceHistory(productUid: string): Promise<PriceHistoryRow[]> {
    this.require("compras.ver");
    const rows: PriceHistoryRow[] = [];
    for (const c of this.purchases) if (c.status === "registrada") for (const l of c.lines) if (l.product_uid === productUid) rows.push({ supplier_uid: c.supplier_uid, supplier_name: this.supplierName(c.supplier_uid), date: c.issue_date, document: c.number, unit_price_minor: l.unit_cost_minor, qty_milli: l.qty_milli });
    for (const o of this.pos) if (o.status !== "borrador" && o.status !== "anulada") for (const l of o.lines) if (l.product_uid === productUid) rows.push({ supplier_uid: o.supplier_uid, supplier_name: this.supplierName(o.supplier_uid), date: o.issue_date, document: o.number, unit_price_minor: l.unit_cost_minor, qty_milli: l.qty_milli });
    return wait(rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20));
  }
  async listPurchaseOrders(query = ""): Promise<PurchaseOrderSummary[]> {
    this.require("compras.ver");
    const q = norm(query.trim());
    return wait(this.pos.map((o) => this.poSummary(o)).filter((o) => !q || norm(`${o.number} ${o.supplier_name}`).includes(q)).sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.number.localeCompare(a.number)));
  }
  async purchaseOrder(u: string): Promise<PurchaseOrderDetail> { this.require("compras.ver"); return wait(this.poDetail(this.findPo(u))); }
  async savePurchaseOrder(input: PurchaseOrderInput, u?: string): Promise<PurchaseOrderDetail> {
    this.require("compras.crear");
    this.findSupplier(input.supplier_uid);
    this.validateBuy(input.lines);
    const lines: PoLine[] = input.lines.map((l, i) => ({ ...l, line_no: i + 1, received_milli: 0, net_minor: Math.round((l.qty_milli * l.unit_cost_minor) / 1000) }));
    if (u) {
      const o = this.findPo(u);
      if (o.status !== "borrador") throw new AppError("bloqueada", "Una orden emitida no se modifica: anúlala con motivo y crea otra.");
      Object.assign(o, { supplier_uid: input.supplier_uid, issue_date: input.issue_date, expected_date: input.expected_date, lines, totals: this.buyTotals(lines), notes: input.notes ?? null });
      o.timeline.push({ at: now(), text: "Borrador modificado" });
      this.log("oc.editar", "orden_compra", o.number);
      return wait(this.poDetail(o));
    }
    const o: PoRec = { uid: uid("oc"), number: this.next("OC"), supplier_uid: input.supplier_uid, issue_date: input.issue_date, expected_date: input.expected_date, status: "borrador", lines, totals: this.buyTotals(lines), notes: input.notes ?? null, void_reason: null, receipts: [], timeline: [] };
    o.timeline.push({ at: now(), text: `Orden ${o.number} creada como borrador` });
    this.pos.push(o);
    this.log("oc.crear", "orden_compra", o.number);
    return wait(this.poDetail(o));
  }
  async issuePurchaseOrder(u: string): Promise<PurchaseOrderDetail> {
    this.require("compras.crear");
    const o = this.findPo(u);
    if (o.status !== "borrador") throw new AppError("estado", "Solo se emite una orden en borrador.");
    o.status = "emitida";
    o.timeline.push({ at: now(), text: "Emitida: pendiente de recepción" });
    this.log("oc.emitir", "orden_compra", o.number);
    return wait(this.poDetail(o));
  }
  async voidPurchaseOrder(u: string, reason: string): Promise<PurchaseOrderDetail> {
    this.require("compras.crear");
    const o = this.findPo(u);
    if (!reason.trim()) throw new AppError("motivo", "Escribe el motivo de la anulación.");
    if (o.status !== "borrador" && o.status !== "emitida") throw new AppError("estado", "Una orden con mercadería recibida no se anula: registra el documento de compra de lo recibido.");
    o.status = "anulada"; o.void_reason = reason.trim();
    o.timeline.push({ at: now(), text: `Anulada: ${reason.trim()}` });
    this.log("oc.anular", "orden_compra", o.number, reason.trim());
    return wait(this.poDetail(o));
  }
  async receivePurchaseOrder(u: string, lines: ReceiveLine[], date: string): Promise<PurchaseOrderDetail> {
    this.require("compras.recibir");
    const o = this.findPo(u);
    if (o.status === "borrador") throw new AppError("estado", "Emite la orden antes de recibir mercadería.");
    if (o.status !== "emitida" && o.status !== "parcial") throw new AppError("estado", "Esta orden ya fue recibida completa o está anulada.");
    const plan = lines.length ? lines.filter((r) => r.qty_milli !== 0) : o.lines.map((l) => ({ line_no: l.line_no, qty_milli: l.qty_milli - l.received_milli })).filter((r) => r.qty_milli > 0);
    if (!plan.length) throw new AppError("cantidades", "Indica qué cantidades llegaron.");
    for (const r of plan) {
      const l = o.lines.find((x) => x.line_no === r.line_no);
      if (!l || r.qty_milli < 0 || r.qty_milli > l.qty_milli - l.received_milli) throw new AppError("cantidades", `Línea ${r.line_no}: puedes recibir hasta lo pendiente de la orden.`);
    }
    const rec = this.next("REC");
    for (const r of plan) {
      const l = o.lines.find((x) => x.line_no === r.line_no)!;
      l.received_milli += r.qty_milli;
      this.stockIn(l.product_uid, r.qty_milli, l.unit_cost_minor, rec, "OC", o.uid, date);
    }
    o.receipts.push({ number: rec, date });
    o.status = o.lines.every((l) => l.received_milli >= l.qty_milli) ? "recibida" : "parcial";
    o.timeline.push({ at: now(), text: `${o.status === "recibida" ? "Recibida completa" : "Recepción parcial"} (${rec}): stock y costo promedio actualizados` });
    this.log("oc.recibir", "orden_compra", o.number);
    return wait(this.poDetail(o));
  }
  async listPurchases(filter: PurchaseFilter): Promise<PurchaseSummary[]> {
    this.require("compras.ver");
    const q = norm(filter.query ?? "");
    let rows = this.purchases.map((c) => this.purSummary(c));
    if (q) rows = rows.filter((c) => norm(`${c.number} ${c.supplier_name} ${c.doc_number ?? ""}`).includes(q));
    rows = filter.view === "anuladas" ? rows.filter((c) => c.status === "anulada") : rows.filter((c) => c.status === "registrada" && (filter.view !== "por_pagar" || c.payment_state !== "pagada"));
    return wait(rows.sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.number.localeCompare(a.number)));
  }
  async purchase(u: string): Promise<PurchaseDetail> { this.require("compras.ver"); return wait(this.purDetail(this.findPur(u))); }
  async registerPurchase(input: PurchaseInput): Promise<PurchaseDetail> {
    this.require("compras.crear");
    const v = this.findSupplier(input.supplier_uid);
    this.validateBuy(input.lines);
    const o = input.order_uid ? this.findPo(input.order_uid) : undefined;
    if (o && o.supplier_uid !== v.uid) throw new AppError("orden", "La orden de compra es de otro proveedor.");
    if (o && (o.status === "borrador" || o.status === "anulada")) throw new AppError("orden", "La orden de compra no está emitida.");
    if (o && input.receive_stock) throw new AppError("orden", "La mercadería de una orden de compra se recibe desde la orden.");
    const docNum = input.doc_number?.trim() || null;
    const kind = input.doc_kind?.trim() || null;
    if (docNum && this.purchases.some((c) => c.supplier_uid === v.uid && c.doc_kind === kind && c.doc_number === docNum)) throw new AppError("duplicado", "Ya registraste ese documento de este proveedor.");
    const due = input.due_date || addDays(input.issue_date, v.payment_terms_days);
    if (due < input.issue_date) throw new AppError("vencimiento", "El vencimiento no puede ser anterior al documento.");
    const lines: PurchaseLine[] = input.lines.map((l, i) => ({ ...l, line_no: i + 1, net_minor: Math.round((l.qty_milli * l.unit_cost_minor) / 1000) }));
    const c: PurRec = { uid: uid("com"), number: this.next("COM"), supplier_uid: v.uid, doc_kind: kind, doc_number: docNum, issue_date: input.issue_date, due_date: due, status: "registrada", lines, totals: this.buyTotals(lines), order_uid: o?.uid ?? null, payments: [], received_stock: false, notes: input.notes?.trim() || null, void_reason: null, timeline: [] };
    c.timeline.push({ at: now(), text: `Registrado ${[kind, docNum && `Nº ${docNum}`].filter(Boolean).join(" ")}`.trim() });
    if (o) { c.timeline.push({ at: now(), text: `Asociado a la orden ${o.number}` }); o.timeline.push({ at: now(), text: `Documento de compra ${c.number} registrado` }); }
    if (input.receive_stock) {
      const any = lines.some((l) => this.products.find((p) => p.uid === l.product_uid)?.kind === "producto");
      for (const l of lines) this.stockIn(l.product_uid, l.qty_milli, l.unit_cost_minor, c.number, "COM", c.uid, c.issue_date);
      if (any) { c.received_stock = true; c.timeline.push({ at: now(), text: `Mercadería ingresada a bodega (${this.next("REC")}): stock y costo promedio actualizados` }); }
    }
    if (input.paid_method) {
      const pnum = this.next("EGR");
      c.payments.push({ number: pnum, date: input.issue_date, amount_minor: c.totals.total_minor, method: input.paid_method });
      c.timeline.push({ at: now(), text: `Pagado al contado (${input.paid_method}) · ${pnum}` });
    } else c.timeline.push({ at: now(), text: `Queda en Dinero que debes (vence ${due})` });
    this.purchases.push(c);
    this.log("compra.registrar", "compra", c.number);
    return wait(this.purDetail(c));
  }
  async payPurchase(u: string, amount: number, method: string, date: string): Promise<PurchaseDetail> {
    this.require("dinero.registrar");
    const c = this.findPur(u);
    if (c.status !== "registrada") throw new AppError("estado", "Solo se pagan documentos registrados.");
    const due = c.totals.total_minor - this.paidOf(c.payments);
    if (amount <= 0) throw new AppError("monto", "El monto debe ser mayor que cero.");
    if (amount > due) throw new AppError("monto", "El pago supera el saldo pendiente.");
    const pnum = this.next("EGR");
    c.payments.push({ number: pnum, date, amount_minor: amount, method });
    c.timeline.push({ at: now(), text: `${amount === due ? "Pago final" : "Abono"} al proveedor (${method}) · ${pnum}` });
    this.log("compra.pagar", "compra", c.number);
    return wait(this.purDetail(c));
  }
  async voidPurchase(u: string, reason: string): Promise<PurchaseDetail> {
    this.require("compras.crear");
    const c = this.findPur(u);
    if (!reason.trim()) throw new AppError("motivo", "Escribe el motivo de la anulación.");
    if (c.status === "anulada") throw new AppError("estado", "El documento ya está anulado.");
    if (c.received_stock) for (const l of c.lines) { const p = this.products.find((x) => x.uid === l.product_uid); if (p && p.kind === "producto") { p.on_hand_milli -= l.qty_milli; this.mv(p.uid, -l.qty_milli, "ajuste", c.number, "COM", c.uid, `Anulación de ${c.number}`); } }
    c.status = "anulada"; c.void_reason = reason.trim();
    if (c.doc_number) c.doc_number = `${c.doc_number} (anulado ${c.number})`;
    c.timeline.push({ at: now(), text: `Anulado: ${reason.trim()}` });
    if (c.payments.length) { c.payments = []; c.timeline.push({ at: now(), text: "Pagos anulados: si pagaste, pide la devolución al proveedor" }); }
    this.log("compra.anular", "compra", c.number, reason.trim());
    return wait(this.purDetail(c));
  }
}

/** SHA-256 real del archivo (si el navegador lo permite), igual que el escritorio. */
async function sha256Hex(f: Blob): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}
