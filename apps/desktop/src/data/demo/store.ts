// Backend de demostración: implementa el mismo puerto que el escritorio, con datos ficticios en memoria.
// Sirve para el navegador (prueba de usabilidad de la Fase 3) y para desarrollar pantallas antes de
// que exista su comando Rust. No persiste nada: al recargar la página vuelve al estado inicial.
import { AppError, type Backend, type Feature, type FileSource, type ImportView, type PurchaseFilter, type SaleFilter } from "../backend";
import { computeLines, computeTotals, lineIsValid } from "../calc";
import type {
  F29Inputs, F29Source, F29View, RcvImportReport, TaxDocInput, TaxDocLine, TaxProfile,
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, DocLink, EffectInput, EntityRef, ExternalRef, ExternalRefInput, Line, LineInput,
  NewCustomer, NewProduct, NewUser, Payment, PermissionRow,
  AdjustmentInput, InventoryOverview, InventorySettings, KardexRow, ProductInventory, ReorderInput, ReorderSettings, StockAnalysis, StockDocDone, StockDocRow, TransferInput, Warehouse, PriceHistoryRow, Product, ProductPatch, PurchaseOrderDetail, PurchaseOrderSummary,
  BuyLineInput, NewSupplier, PoLine, PoStatus, PurchaseDetail, PurchaseInput, PurchaseLine, PurchaseOrderInput, PurchaseSummary, ReceiveLine, Supplier, SupplierDetail, QuoteDetail,
  QuoteInput, QuoteStatus, QuoteSummary, RateRow, RoleRow, SaleDetail, SaleDocType, SaleInput, SaleSummary, SearchHit,
  SecuritySettings, SequenceRow, SessionInfo, Totals, UserPatch, UserRow,
  AccountInput, AccountKind, CalendarItem, DueRow, ExpenseCategory, ExpenseDetail, ExpenseFilter, ExpenseInput, ExpenseSummary, LedgerRow,
  MoneyAccount, MoneyOverview, MoneyTransferInput, Recurring, RecurringInput,
  EtaChange, ImportCostInput, ImportDetail, ImportInput, ImportItemRow, ImportReceiveLine, ImportStage, ImportSummary, IncotermDef, StageChange, TransportMode,
} from "../types";
import incotermsJson from "./incoterms.json";
import { COST_LABEL, STAGE_LABEL, landedCost, toClp, type Basis, type CostKind, type LandedResult } from "../comex";
import { DEMO_CATEGORIES, PROJECTION_WEEKS, agingAdd, emptyAging, methodCode, occurrences } from "./money";
import { DEMO_PERMISSIONS, DEMO_ROLES } from "./roles";
import { addDays, daysBetween, todayIso } from "../../lib/format";
import { CUSTOMER_NAMES, DEMO_COMPANY, PAYMENT_METHODS, PRODUCT_ROWS, SUPPLIER_NAMES, rng, rutDv } from "./seed";
import reglas from "./reglas-demo.json";
import { MANUAL_CODES, computeF29, type F29Note, type PurchaseKind } from "../f29";
import { parseRcv, rcvPurchaseKind, rcvSaleNotOfBusiness, siiTypeFromText } from "../rcv";

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
interface AccRec { uid: string; kind: AccountKind; name: string; bank_name: string | null; account_label: string | null; opening_minor: number; opening_date: string | null; archived: boolean }
interface TransferRec { uid: string; from: string; to: string; date: string; amount: number; notes: string | null }
interface GasRec {
  uid: string; number: string; category_id: number; supplier_uid: string | null; date: string; due_date: string | null; description: string;
  net: number; tax: number; total: number; status: "registrado" | "anulado"; payments: Payment[]; void_reason: string | null; notes: string | null;
  recurring_id: number | null; timeline: { at: string; text: string }[];
}
type ImpItemRec = ImportItemRow;
interface ImpCostRec {
  id: number; kind: CostKind; description: string | null; supplier_uid: string | null; currency_code: string; currency_decimals: number;
  amount_minor: number; rate_e6: number | null; is_estimate: boolean; recoverable_tax: boolean; allocation_basis: Basis | null;
  status: "vigente" | "anulado"; document_ref: string | null; cost_date: string | null; created_at: string;
  payable: { due: string; amount: number; status: "abierta" | "pagada" | "anulada" } | null;
  payments: (Payment & { status: "vigente" | "anulado" })[];
}
interface ImpRec {
  uid: string; number: string; supplier_uid: string | null; incoterm: string | null; incoterm_version: string | null; transport_mode: TransportMode | null;
  origin_country: string | null; origin_port: string | null; destination_port: string | null; currency_code: string; rate_e6: number | null;
  stage: ImportStage; purchase_date: string | null; production_eta: string | null; shipment_date: string | null; eta: string | null;
  arrival_date: string | null; reception_date: string | null; allocation_basis: Basis; vat_ppm: number | null; vat_recoverable: boolean; notional_insurance_ppm: number | null; transport_freight_minor: number | null;
  fob_minor: number | null; landed_total_clp: number | null; estimated_landed_clp: number | null; estimated_at: string | null;
  notes: string | null; void_reason: string | null; created_at: string; items: ImpItemRec[]; costs: ImpCostRec[];
  stages: StageChange[]; etas: EtaChange[]; receipts: { number: string; date: string }[]; timeline: { at: string; text: string }[];
}
const INCOTERMS = incotermsJson as IncotermDef[];

let uidSeq = 0;
const uid = (p: string) => `${p}-${(++uidSeq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const wait = <T,>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const now = () => new Date().toISOString().slice(0, 19) + "Z";

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  readonly features: ReadonlySet<Feature> = new Set<Feature>([
    "dashboard", "clientes", "productos", "ventas", "compras", "comex", "negocio", "busqueda",
    "usuarios", "documentos", "numeracion", "monedas", "auditoria", "inventario", "dinero", "impuestos",
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
  private accs: AccRec[] = [];
  private payAcc: Record<string, string> = {};
  private transfers: TransferRec[] = [];
  private cats: ExpenseCategory[] = structuredClone(DEMO_CATEGORIES);
  private gastos: GasRec[] = [];
  private recs: Recurring[] = [];
  private imps: ImpRec[] = [];
  private impItemSeq = 0;
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
      email: "contacto@ejemplo.cl", documentation_reminder: true, tax_enabled: true, tax_rate_ppm: TAX_PPM, tax_rule_source: TAX_SOURCE, tax_rate_user_ppm: null, logo: null,
    };
    this.seed();
    this.seedInventory();
    this.seedMoney();
    this.seedComex();
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
      else if (r() < 0.4) s.payments.push({ number: this.next("PAG"), date: addDays(date, 10) < this.today ? addDays(date, 10) : this.today, amount_minor: Math.round(s.totals.total_minor / 2), method: "Transferencia" });
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
    this.biz = { ...this.biz, ...patch, logo: this.biz.logo };
    this.log("negocio.editar", "negocio", null);
    return wait(this.biz);
  }
  async setBusinessLogo(logo: string | null): Promise<BusinessSettings> {
    this.require("config.editar");
    if (logo !== null && !/^data:image\/(png|jpeg|webp);base64,/.test(logo)) throw new AppError("validacion", "El logo debe ser una imagen PNG, JPG o WebP.");
    if (logo !== null && logo.length > 560_000) throw new AppError("validacion", "El logo es demasiado grande (máximo 400 KB).");
    this.biz = { ...this.biz, logo };
    this.log(logo ? "negocio.logo" : "negocio.logo_quitar", "negocio", null);
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
    const ms = `${ym}-01`;
    const gastosMes = this.gastos.filter((g) => g.status === "registrado" && g.date >= ms);
    const expenses = gastosMes.reduce((x, g) => x + g.net, 0);
    const prevMonth = (this.history[prev] ?? 0) + sumBy((s) => s.issue_date.startsWith(prev), (s) => s.totals.total_minor);
    const { rec, pay } = this.dues();
    const receivable = rec.reduce((x, d) => x + d.pending_minor, 0);
    const overdue = rec.filter((d) => d.due_date < t).reduce((x, d) => x + d.pending_minor, 0);
    const payable = pay.reduce((x, d) => x + d.pending_minor, 0);
    const cash = this.accountRows().filter((a) => !a.archived).reduce((x, a) => x + a.balance_minor, 0);
    const purchaseCredit = this.purchases.filter((c) => c.status === "registrada" && c.issue_date >= ms).reduce((a, c) => a + c.totals.tax_minor, 0)
      + gastosMes.reduce((x, g) => x + g.tax, 0);
    const series: Dashboard["series"] = [];
    for (let m = 11; m >= 0; m--) {
      const d = new Date(`${t}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() - m);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      series.push({ month: key, sales_minor: (this.history[key] ?? 0) + sumBy((s) => s.issue_date.startsWith(key), (s) => s.totals.total_minor) });
    }
    const upcoming: Dashboard["upcoming_payments"] = [...rec, ...pay].filter((d) => d.due_date >= t).sort((x, y) => x.due_date.localeCompare(y.due_date))
      .map((d) => ({ label: `${d.document} · ${d.party}`, date: d.due_date, amount_minor: d.pending_minor, kind: d.kind }));
    return wait({
      today_sales_minor: today.reduce((a, s) => a + s.totals.total_minor, 0), today_sales_count: today.length,
      month_sales_minor: month, month_prev_sales_minor: prevMonth, month_expenses_minor: expenses,
      month_profit_minor: monthNet - monthCost - expenses, receivable_minor: receivable, receivable_overdue_minor: overdue,
      payable_minor: payable, cash_minor: cash,
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
      const acc = this.accountFor(input.account_uid, input.method);
      const pnum = this.next("PAG");
      this.payAcc[pnum] = acc;
      s.payments.push({ number: pnum, date: this.today, amount_minor: s.totals.total_minor, method: input.method });
      s.timeline.push({ at: now(), text: `Pago registrado (${input.method})` });
    } else {
      s.timeline.push({ at: now(), text: "Queda en Dinero que te deben" });
    }
    if (s.documentation_state === "pendiente") s.timeline.push({ at: now(), text: "Pendiente de documentación tributaria" });
    this.autoClose(s);
    this.log("venta.efectuar", "venta", s.number);
    return wait(this.detail(s), 150);
  }
  async registerPayment(u: string, amount: number, method: string, date: string, accountUid?: string): Promise<SaleDetail> {
    const s = this.findSale(u);
    if (s.commercial_state !== "efectuada") throw new AppError("estado", "Solo se registran pagos de ventas efectuadas.");
    const due = s.totals.total_minor - this.paid(s);
    if (amount <= 0) throw new AppError("monto", "El monto debe ser mayor que cero.");
    if (amount > due) throw new AppError("monto", `El pago supera el saldo pendiente.`);
    const acc = this.accountFor(accountUid, method);
    const pnum = this.next("PAG");
    this.payAcc[pnum] = acc;
    s.payments.push({ number: pnum, date, amount_minor: amount, method });
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
    const liveImps = this.imps.filter((h) => !["cotizacion", "recibida", "cerrada", "anulada"].includes(h.stage));
    const inPurchase = this.pos.filter((o) => o.status === "emitida" || o.status === "parcial").reduce((a, o) => a + o.lines.filter((l) => l.product_uid === p.uid).reduce((x, l) => x + l.qty_milli - l.received_milli, 0), 0)
      + liveImps.reduce((a, h) => a + h.items.filter((i) => i.product_uid === p.uid).reduce((x, i) => x + i.qty_milli - i.received_milli, 0), 0);
    const arrivals = [
      ...this.pos.filter((o) => (o.status === "emitida" || o.status === "parcial") && o.expected_date && o.lines.some((l) => l.product_uid === p.uid && l.received_milli < l.qty_milli)).map((o) => o.expected_date!),
      ...liveImps.filter((h) => h.eta && h.items.some((i) => i.product_uid === p.uid && i.received_milli < i.qty_milli)).map((h) => h.eta!),
    ].sort();
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
    this.stockInE4(productUid, qty, costMinor * 10_000, doc, sourceType, sourceUid, date);
  }
  private stockInE4(productUid: string | null, qty: number, costE4: number, doc: string, sourceType: string, sourceUid: string | null, date = this.today): void {
    const p = this.products.find((x) => x.uid === productUid);
    if (!p || p.kind !== "producto") return;
    this.mv(p.uid, qty, "entrada", doc, sourceType, sourceUid, null, date, costE4);
    const base = Math.max(0, p.on_hand_milli);
    p.cost_e4 = base + qty > 0 ? Math.round((p.cost_e4 * base + costE4 * qty) / (base + qty)) : costE4;
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
      const acc = this.accountFor(input.paid_account_uid, input.paid_method);
      const pnum = this.next("EGR");
      this.payAcc[pnum] = acc;
      c.payments.push({ number: pnum, date: input.issue_date, amount_minor: c.totals.total_minor, method: input.paid_method });
      c.timeline.push({ at: now(), text: `Pagado al contado (${input.paid_method}) · ${pnum}` });
    } else c.timeline.push({ at: now(), text: `Queda en Dinero que debes (vence ${due})` });
    this.purchases.push(c);
    this.log("compra.registrar", "compra", c.number);
    return wait(this.purDetail(c));
  }
  async payPurchase(u: string, amount: number, method: string, date: string, accountUid?: string): Promise<PurchaseDetail> {
    this.require("dinero.registrar");
    const c = this.findPur(u);
    if (c.status !== "registrada") throw new AppError("estado", "Solo se pagan documentos registrados.");
    const due = c.totals.total_minor - this.paidOf(c.payments);
    if (amount <= 0) throw new AppError("monto", "El monto debe ser mayor que cero.");
    if (amount > due) throw new AppError("monto", "El pago supera el saldo pendiente.");
    const acc = this.accountFor(accountUid, method);
    const pnum = this.next("EGR");
    this.payAcc[pnum] = acc;
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

  /* ───────────── COMEX: carpetas de importación ───────────── */

  private impDecimals(code: string): number { return code === "CLP" ? 0 : 2; }
  private impCostClp(c: ImpCostRec, h: ImpRec): number {
    const rate = c.rate_e6 ?? (c.currency_code === "CLP" ? 1_000_000 : c.currency_code === h.currency_code ? h.rate_e6 : null);
    return rate ? toClp(c.amount_minor, this.impDecimals(c.currency_code), rate) : 0;
  }
  private impCalc(h: ImpRec): LandedResult {
    const calc = landedCost({
      currency_decimals: this.impDecimals(h.currency_code),
      rate_e6: h.rate_e6 ?? (h.currency_code === "CLP" ? 1_000_000 : 0),
      basis: h.allocation_basis, vat_ppm: h.vat_ppm, vat_recoverable: h.vat_recoverable, notional_insurance_ppm: h.notional_insurance_ppm,
      customs_freight_clp: h.transport_freight_minor !== null ? toClp(h.transport_freight_minor, this.impDecimals(h.currency_code), h.rate_e6 ?? (h.currency_code === "CLP" ? 1_000_000 : 0)) : null,
      items: h.items.map((i) => ({ qty_milli: i.qty_milli, unit_price_minor: i.unit_price_minor, weight_g: i.weight_g, volume_cm3: i.volume_cm3, duty_ppm: i.duty_ppm })),
      costs: h.costs.filter((c) => c.status === "vigente").map((c) => ({ kind: c.kind, amount_clp: this.impCostClp(c, h), basis: c.allocation_basis, recoverable: c.recoverable_tax })),
    });
    for (const c of h.costs) if (c.status === "vigente" && c.amount_minor > 0 && this.impCostClp(c, h) === 0) calc.notes.push(`${COST_LABEL[c.kind]} en ${c.currency_code} no tiene tipo de cambio: no se sumó.`);
    return calc;
  }
  private findImp(u: string): ImpRec {
    const h = this.imps.find((x) => x.uid === u);
    if (!h) throw new AppError("no_encontrado", "No encontramos esa importación.");
    return h;
  }
  private impDetail(h: ImpRec): ImportDetail {
    const calc = this.impCalc(h);
    const open = h.stage !== "cerrada" && h.stage !== "anulada";
    const { items, costs, stages, etas, receipts, timeline, ...head } = h;
    return {
      ...head,
      supplier_name: h.supplier_uid ? this.supplierName(h.supplier_uid) : null,
      currency_decimals: this.impDecimals(h.currency_code),
      items,
      costs: costs.map((c) => ({
        ...c, supplier_name: c.supplier_uid ? this.supplierName(c.supplier_uid) : null, amount_clp: this.impCostClp(c, h),
        payable_due: c.payable && c.payable.status !== "anulada" ? c.payable.due : null,
        payable_amount_minor: c.payable && c.payable.status !== "anulada" ? c.payable.amount : null,
        payable_paid_minor: c.payable && c.payable.status !== "anulada" ? this.paidOf(c.payments.filter((p) => p.status === "vigente")) : null,
        payments: c.payments.filter((p) => p.status === "vigente").map(({ status: _s, ...p }) => p),
      })),
      calc,
      has_estimates: costs.some((c) => c.status === "vigente" && c.is_estimate),
      editable: open && h.stage !== "recibida" && !items.some((i) => i.received_milli > 0),
      receivable: open && h.stage !== "cotizacion" && items.some((i) => i.product_uid && i.received_milli < i.qty_milli),
      stage_history: stages, eta_history: etas, receipts,
      incoterm_info: (INCOTERMS as IncotermDef[]).find((x) => x.code === h.incoterm) ?? null,
      timeline,
    };
  }
  private impLog(h: ImpRec, text: string, action = "importacion.editar"): void {
    h.timeline.push({ at: now(), text });
    this.log(action, "importacion", h.number);
  }
  private impStage(h: ImpRec, stage: ImportStage, note: string | null = null): void {
    h.stages.push({ from_stage: h.stage, to_stage: stage, changed_at: now(), changed_by: this.me().display_name, note });
    h.stage = stage;
  }
  private impItems(input: ImportInput): ImpItemRec[] {
    if (!input.items.length) throw new AppError("validacion", "Agrega al menos un producto a la importación.");
    return input.items.map((it, i) => {
      if (!it.description.trim()) throw new AppError("validacion", `Línea ${i + 1}: escribe la descripción del producto.`);
      if (!(it.qty_milli > 0)) throw new AppError("validacion", `Línea ${i + 1}: la cantidad debe ser mayor que cero.`);
      if (it.unit_price_minor < 0) throw new AppError("validacion", `Línea ${i + 1}: el precio no es válido.`);
      if (it.duty_ppm != null && (it.duty_ppm < 0 || it.duty_ppm > 1_000_000)) throw new AppError("validacion", `Línea ${i + 1}: el arancel debe estar entre 0 % y 100 %.`);
      const p = it.product_uid ? this.products.find((x) => x.uid === it.product_uid) : null;
      return { id: ++this.impItemSeq, product_uid: p?.uid ?? null, sku: p?.sku ?? null, description: it.description.trim(), qty_milli: it.qty_milli, received_milli: 0, unit_price_minor: it.unit_price_minor, weight_g: it.weight_g, volume_cm3: it.volume_cm3, duty_ppm: it.duty_ppm, hs_code: it.hs_code?.trim() || null, landed_unit_cost_e4: null, estimated_unit_cost_e4: null };
    });
  }
  private impHeader(input: ImportInput) {
    if (input.incoterm && !(INCOTERMS as IncotermDef[]).some((x) => x.code === input.incoterm)) throw new AppError("validacion", `El Incoterm ${input.incoterm} no está en la guía.`);
    if (input.rate_e6 != null && input.rate_e6 <= 0) throw new AppError("validacion", "El tipo de cambio no es válido.");
    if (input.supplier_uid) this.findSupplier(input.supplier_uid);
    const t = (v: string | null) => v?.trim() || null;
    return {
      supplier_uid: input.supplier_uid || null, incoterm: input.incoterm || null, incoterm_version: input.incoterm ? "2020" : null,
      transport_mode: input.transport_mode || null, origin_country: t(input.origin_country), origin_port: t(input.origin_port),
      destination_port: t(input.destination_port), currency_code: input.currency_code, rate_e6: input.rate_e6,
      purchase_date: input.purchase_date || null, production_eta: input.production_eta || null, shipment_date: input.shipment_date || null,
      arrival_date: input.arrival_date || null, allocation_basis: input.allocation_basis, vat_ppm: input.vat_ppm,
      vat_recoverable: input.vat_recoverable, notional_insurance_ppm: input.notional_insurance_ppm ?? null, transport_freight_minor: input.transport_freight_minor ?? null, notes: t(input.notes),
    };
  }
  private impSetEta(h: ImpRec, eta: string, reason: string | null): boolean {
    if (h.eta === eta) return false;
    h.etas.push({ old_eta: h.eta, new_eta: eta, reason, changed_at: now(), changed_by: this.me().display_name });
    h.eta = eta;
    return true;
  }

  async incoterms(): Promise<IncotermDef[]> { this.require("comex.ver"); return wait(INCOTERMS as IncotermDef[]); }
  async listImports(view: ImportView, query: string): Promise<ImportSummary[]> {
    this.require("comex.ver");
    const q = norm(query.trim());
    const rows = this.imps.filter((h) => {
      const okView = view === "en_curso" ? !["cotizacion", "cerrada", "anulada"].includes(h.stage) : view === "cotizaciones" ? h.stage === "cotizacion" : view === "cerradas" ? h.stage === "cerrada" : view === "anuladas" ? h.stage === "anulada" : true;
      return okView && (!q || norm(`${h.number} ${h.supplier_uid ? this.supplierName(h.supplier_uid) : ""} ${h.notes ?? ""} ${h.items.map((i) => i.description).join(" ")}`).includes(q));
    }).map((h): ImportSummary => {
      const first = h.etas[0];
      const base = first ? first.old_eta ?? first.new_eta : null;
      return {
        uid: h.uid, number: h.number, supplier_name: h.supplier_uid ? this.supplierName(h.supplier_uid) : null, stage: h.stage, incoterm: h.incoterm,
        transport_mode: h.transport_mode, currency_code: h.currency_code, fob_minor: h.fob_minor ?? this.impCalc(h).fob_minor, eta: h.eta,
        eta_changes: h.etas.filter((e) => e.old_eta).length, eta_shift_days: base && h.eta ? daysBetween(base, h.eta) : 0,
        landed_total_clp: h.landed_total_clp, estimated_landed_clp: h.estimated_landed_clp, items: h.items.length, created_at: h.created_at,
      };
    });
    const closed = (s: ImportStage) => (s === "cerrada" || s === "anulada" ? 1 : 0);
    return wait(rows.sort((a, b) => closed(a.stage) - closed(b.stage) || (a.eta ?? "9999").localeCompare(b.eta ?? "9999") || b.number.localeCompare(a.number)));
  }
  async import(u: string): Promise<ImportDetail> { this.require("comex.ver"); return wait(this.impDetail(this.findImp(u))); }
  async saveImport(input: ImportInput, u?: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const head = this.impHeader(input);
    const items = this.impItems(input);
    if (u) {
      const h = this.findImp(u);
      if (!this.impDetail(h).editable) throw new AppError("estado", "Esta importación ya tiene mercadería recibida o está cerrada: solo puedes cambiar costos.");
      for (const it of items) { const prev = h.items.find((o) => o.product_uid && o.product_uid === it.product_uid); if (prev) it.estimated_unit_cost_e4 = prev.estimated_unit_cost_e4; }
      Object.assign(h, head, { items });
      if (input.eta) this.impSetEta(h, input.eta, null);
      this.impLog(h, "Datos de la importación actualizados");
      return wait(this.impDetail(h));
    }
    const h: ImpRec = {
      uid: uid("imp"), number: this.next("IMP"), ...head, stage: "cotizacion", eta: input.eta || null, reception_date: null, fob_minor: null,
      landed_total_clp: null, estimated_landed_clp: null, estimated_at: null, void_reason: null, created_at: now(), items, costs: [], stages: [], etas: [], receipts: [], timeline: [],
    };
    this.imps.push(h);
    this.impLog(h, `${h.number} creada como cotización`, "importacion.crear");
    return wait(this.impDetail(h));
  }
  async setImportStage(u: string, stage: ImportStage, note?: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    if (stage === "recibida") throw new AppError("estado", "Para pasar a Recibida, registra la recepción de la mercadería.");
    if (stage === "cerrada") throw new AppError("estado", "Usa “Cerrar importación” para fijar el costo final.");
    if (stage === "anulada") throw new AppError("estado", "Usa “Anular” e indica el motivo.");
    if (["recibida", "cerrada", "anulada"].includes(h.stage)) throw new AppError("estado", "La importación ya no cambia de etapa.");
    if (h.items.some((i) => i.received_milli > 0)) throw new AppError("estado", "Ya se recibió mercadería: completa la recepción.");
    if (h.stage === stage) return wait(this.impDetail(h));
    const leaving = h.stage === "cotizacion";
    if (leaving && !h.rate_e6 && h.currency_code !== "CLP") throw new AppError("validacion", "Indica el tipo de cambio antes de confirmar la importación.");
    const calc = this.impCalc(h);
    this.impStage(h, stage, note?.trim() || null);
    if (stage === "ordenada") h.purchase_date ??= this.today;
    if (stage === "embarcada" || stage === "en_transito") h.shipment_date ??= this.today;
    if (["arribada", "internacion", "transporte_local"].includes(stage)) h.arrival_date ??= this.today;
    let text = `Etapa: ${STAGE_LABEL[stage]}${note?.trim() ? ` · ${note.trim()}` : ""}`;
    if (leaving && h.estimated_landed_clp === null) {
      h.estimated_landed_clp = calc.landed_clp; h.estimated_at = now();
      h.items.forEach((it, i) => { it.estimated_unit_cost_e4 = calc.items[i]!.unit_cost_e4; });
      text += " · se guardó el costo estimado para compararlo al cerrar";
    }
    this.impLog(h, text, "importacion.etapa");
    return wait(this.impDetail(h));
  }
  async changeImportEta(u: string, eta: string, reason?: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    if (["recibida", "cerrada", "anulada"].includes(h.stage)) throw new AppError("estado", "La mercadería ya llegó: la ETA no cambia.");
    if (h.eta && !reason?.trim()) throw new AppError("validacion", "Indica por qué cambió la fecha de llegada (queda en el historial).");
    const old = h.eta;
    if (this.impSetEta(h, eta, reason?.trim() || null)) this.impLog(h, old ? `ETA cambió de ${old} a ${eta}: ${reason!.trim()}` : `ETA: ${eta}`, "importacion.eta");
    return wait(this.impDetail(h));
  }
  private impCostRec(h: ImpRec, input: ImportCostInput, id: number): ImpCostRec {
    if (!(input.amount_minor > 0)) throw new AppError("monto", "El monto debe ser mayor que cero.");
    if (input.currency_code !== "CLP" && input.currency_code !== h.currency_code && !input.rate_e6) throw new AppError("validacion", `Indica el tipo de cambio de ${input.currency_code} para este costo.`);
    if (input.supplier_uid) this.findSupplier(input.supplier_uid);
    return {
      id, kind: input.kind, description: input.description?.trim() || null, supplier_uid: input.supplier_uid || null, currency_code: input.currency_code,
      currency_decimals: this.impDecimals(input.currency_code), amount_minor: input.amount_minor, rate_e6: input.rate_e6, is_estimate: input.is_estimate,
      recoverable_tax: input.recoverable_tax, allocation_basis: input.allocation_basis, status: "vigente", document_ref: input.document_ref?.trim() || null,
      cost_date: input.cost_date || null, created_at: now(), payable: null, payments: [],
    };
  }
  async addImportCost(u: string, input: ImportCostInput): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    if (h.stage === "cerrada" || h.stage === "anulada") throw new AppError("estado", "La importación está cerrada.");
    const c = this.impCostRec(h, input, ++this.impItemSeq);
    const payment = input.is_estimate ? "no_registrar" : input.payment ?? "no_registrar";
    if (payment !== "no_registrar") this.require("dinero.registrar");
    const clp = this.impCostClp(c, h);
    let text = `${input.is_estimate ? "Costo estimado" : "Costo real"} ${COST_LABEL[c.kind].toLowerCase()}: ${c.description ?? COST_LABEL[c.kind]}`;
    if (payment !== "no_registrar") {
      if (clp <= 0) throw new AppError("validacion", "Falta el tipo de cambio para llevar este costo a Dinero.");
      const date = c.cost_date ?? this.today;
      c.payable = { due: input.due_date || date, amount: clp, status: "abierta" };
      if (payment === "pagado") {
        if (!input.paid_method) throw new AppError("validacion", "Indica el medio de pago.");
        const acc = this.accountFor(input.paid_account_uid, input.paid_method);
        const pnum = this.next("EGR");
        this.payAcc[pnum] = acc;
        c.payments.push({ number: pnum, date, amount_minor: clp, method: input.paid_method, status: "vigente" });
        c.payable.status = "pagada";
        text += ` · pagado (${input.paid_method}) · ${pnum}`;
      } else text += ` · queda en Dinero que debes (vence ${c.payable.due})`;
    }
    h.costs.push(c);
    this.impLog(h, text, "importacion.costo");
    return wait(this.impDetail(h));
  }
  async updateImportCost(u: string, costId: number, input: ImportCostInput): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    const i = h.costs.findIndex((c) => c.id === costId);
    const cur = h.costs[i];
    if (!cur) throw new AppError("no_encontrado", "No encontramos ese costo.");
    if (cur.status !== "vigente" || cur.payable) throw new AppError("estado", "Este costo ya está en Dinero: anúlalo y regístralo de nuevo.");
    h.costs[i] = { ...this.impCostRec(h, input, costId), created_at: cur.created_at };
    this.impLog(h, `${COST_LABEL[input.kind]} actualizado${cur.is_estimate && !input.is_estimate ? ": ahora es el monto real" : ""}`, "importacion.costo");
    return wait(this.impDetail(h));
  }
  async removeImportCost(u: string, costId: number, reason?: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    const cur = h.costs.find((c) => c.id === costId && c.status === "vigente");
    if (!cur) throw new AppError("no_encontrado", "No encontramos ese costo.");
    if (cur.is_estimate) { h.costs = h.costs.filter((c) => c !== cur); this.impLog(h, `Estimado quitado: ${COST_LABEL[cur.kind]}`, "importacion.costo"); }
    else {
      if (!reason?.trim()) throw new AppError("motivo", "Escribe el motivo: los costos reales se anulan, no se borran.");
      cur.status = "anulado";
      const paid = cur.payments.some((p) => p.status === "vigente");
      cur.payments.forEach((p) => { p.status = "anulado"; });
      if (cur.payable) cur.payable.status = "anulada";
      this.impLog(h, `Costo anulado: ${COST_LABEL[cur.kind]} · ${reason.trim()}${paid ? " · sus pagos se anularon y el dinero vuelve a la cuenta" : ""}`, "importacion.costo");
    }
    return wait(this.impDetail(h));
  }
  async payImportCost(u: string, costId: number, amount: number, method: string, date: string, accountUid?: string): Promise<ImportDetail> {
    this.require("dinero.registrar");
    const h = this.findImp(u);
    const c = h.costs.find((x) => x.id === costId && x.status === "vigente");
    if (!c?.payable || c.payable.status !== "abierta") throw new AppError("estado", "Este costo no tiene saldo por pagar.");
    const due = c.payable.amount - this.paidOf(c.payments.filter((p) => p.status === "vigente"));
    if (amount <= 0 || amount > due) throw new AppError("monto", "El monto debe ser mayor que cero y no superar el saldo.");
    const acc = this.accountFor(accountUid, method);
    const pnum = this.next("EGR");
    this.payAcc[pnum] = acc;
    c.payments.push({ number: pnum, date, amount_minor: amount, method, status: "vigente" });
    if (amount === due) c.payable.status = "pagada";
    this.impLog(h, `${amount === due ? "Pago final" : "Abono"} de ${COST_LABEL[c.kind].toLowerCase()} (${method}) · ${pnum}`, "importacion.pagar");
    return wait(this.impDetail(h));
  }
  async receiveImport(u: string, lines: ImportReceiveLine[], date: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    const d = this.impDetail(h);
    if (!d.receivable) throw new AppError("estado", h.stage === "cotizacion" ? "Confirma la importación (pásala a Ordenada) antes de recibir." : "No hay mercadería pendiente de recibir.");
    if (!h.supplier_uid) throw new AppError("validacion", "Indica el proveedor de la importación antes de recibir.");
    const plan: [ImpItemRec, number, number][] = [];
    h.items.forEach((it, i) => {
      if (!it.product_uid) return;
      const pending = it.qty_milli - it.received_milli;
      const l = lines.length ? lines.find((x) => x.item_id === it.id) : { item_id: it.id, qty_milli: pending };
      if (!l) return;
      if (l.qty_milli < 0 || l.qty_milli > pending) throw new AppError("validacion", `${it.description}: puedes recibir hasta lo pendiente.`);
      if (l.qty_milli > 0) plan.push([it, l.qty_milli, d.calc.items[i]!.unit_cost_e4]);
    });
    if (!plan.length) throw new AppError("validacion", "Indica qué cantidades llegaron.");
    const rnum = this.next("REC");
    for (const [it, qty, cost] of plan) { it.received_milli += qty; this.stockInE4(it.product_uid, qty, cost, rnum, "IMP", h.uid, date); }
    h.receipts.push({ number: rnum, date });
    h.fob_minor = d.calc.fob_minor; h.landed_total_clp = d.calc.landed_clp;
    h.items.forEach((it, i) => { it.landed_unit_cost_e4 = d.calc.items[i]!.unit_cost_e4; });
    const complete = h.items.filter((i) => i.product_uid).every((i) => i.received_milli >= i.qty_milli);
    if (complete) { this.impStage(h, "recibida", rnum); h.reception_date = date; }
    this.impLog(h, `${complete ? "Mercadería recibida completa" : "Recepción parcial"} (${rnum}): stock y costo promedio actualizados al costo puesto en bodega${d.has_estimates ? " · incluye costos estimados" : ""}`, "importacion.recibir");
    return wait(this.impDetail(h));
  }
  async closeImport(u: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    const d = this.impDetail(h);
    if (h.stage !== "recibida") throw new AppError("estado", "Solo se cierra una importación recibida completa.");
    if (d.has_estimates) throw new AppError("estado", "Quedan costos estimados: reemplázalos por los montos reales (o quítalos) antes de cerrar.");
    h.landed_total_clp = d.calc.landed_clp;
    h.items.forEach((it, i) => { it.landed_unit_cost_e4 = d.calc.items[i]!.unit_cost_e4; });
    this.impStage(h, "cerrada");
    const diff = h.estimated_landed_clp === null ? null : d.calc.landed_clp - h.estimated_landed_clp;
    const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
    this.impLog(h, `Cerrada: costo final $${fmt(d.calc.landed_clp)}${diff === null ? "" : ` · estimado $${fmt(h.estimated_landed_clp!)} · diferencia ${diff < 0 ? "−" : "+"}$${fmt(Math.abs(diff))}`}`, "importacion.cerrar");
    return wait(this.impDetail(h));
  }
  async voidImport(u: string, reason: string): Promise<ImportDetail> {
    this.require("comex.editar");
    const h = this.findImp(u);
    if (!reason.trim()) throw new AppError("motivo", "Escribe el motivo de la anulación.");
    if (h.stage === "anulada") throw new AppError("estado", "La importación ya está anulada.");
    if (h.items.some((i) => i.received_milli > 0)) throw new AppError("estado", "Ya se recibió mercadería: no se puede anular (corrige con un ajuste de inventario).");
    let paid = false;
    for (const c of h.costs.filter((x) => x.status === "vigente" && !x.is_estimate)) {
      c.status = "anulado"; if (c.payable) c.payable.status = "anulada";
      c.payments.forEach((p) => { if (p.status === "vigente") paid = true; p.status = "anulado"; });
    }
    h.void_reason = reason.trim();
    this.impStage(h, "anulada", reason.trim());
    this.impLog(h, `Anulada: ${reason.trim()}${paid ? " · los pagos de sus costos se anularon" : ""}`, "importacion.anular");
    return wait(this.impDetail(h));
  }

  private seedComex(): void {
    const t = this.today;
    const duty = reglas.values.find((v) => v.code === "ARANCEL_GENERAL_PPM")?.value ?? null;
    const sup: Supplier = { id: this.suppliers.length + 1, uid: "sup-ningbo", rut: null, name: "Ningbo Power Tools Co., Ltd. (ficticio)", email: "sales@ejemplo.cn", phone: null, payment_terms_days: 0, created_at: `${addDays(t, -120)}T12:00:00Z` };
    const fwd: Supplier = { id: this.suppliers.length + 2, uid: "sup-fwd", rut: "77.111.222-3", name: "Transportes y Aduanas Ejemplo Ltda.", email: null, phone: null, payment_terms_days: 30, created_at: `${addDays(t, -120)}T12:00:00Z` };
    this.suppliers.push(sup, fwd);
    const p = (sku: string) => this.products.find((x) => x.sku === sku)!;
    const item = (sku: string, qty: number, priceCents: number, w: number): ImpItemRec => {
      const x = p(sku);
      return { id: ++this.impItemSeq, product_uid: x.uid, sku: x.sku, description: x.name, qty_milli: qty * 1000, received_milli: 0, unit_price_minor: priceCents, weight_g: w, volume_cm3: null, duty_ppm: duty, hs_code: null, landed_unit_cost_e4: null, estimated_unit_cost_e4: null };
    };
    const cost = (kind: CostKind, amount: number, currency: string, estimate: boolean, extra: Partial<ImpCostRec> = {}): ImpCostRec => ({
      id: ++this.impItemSeq, kind, description: null, supplier_uid: null, currency_code: currency, currency_decimals: this.impDecimals(currency), amount_minor: amount,
      rate_e6: null, is_estimate: estimate, recoverable_tax: false, allocation_basis: null, status: "vigente", document_ref: null, cost_date: null,
      created_at: now(), payable: null, payments: [], ...extra,
    });
    const base = (n: string, stage: ImportStage, extra: Partial<ImpRec>): ImpRec => ({
      uid: `imp-${n}`, number: this.next("IMP"), supplier_uid: sup.uid, incoterm: "FOB", incoterm_version: "2020", transport_mode: "maritimo", origin_country: "China",
      origin_port: "Ningbo", destination_port: "San Antonio", currency_code: "USD", rate_e6: 945_000_000, stage, purchase_date: null, production_eta: null,
      shipment_date: null, eta: null, arrival_date: null, reception_date: null, allocation_basis: "valor", vat_ppm: TAX_PPM, vat_recoverable: true, notional_insurance_ppm: null, transport_freight_minor: null, fob_minor: null,
      landed_total_clp: null, estimated_landed_clp: null, estimated_at: null, notes: null, void_reason: null, created_at: now(), items: [], costs: [], stages: [], etas: [],
      receipts: [], timeline: [], ...extra,
    });
    const at = (d: number) => `${addDays(t, d)}T15:00:00Z`;
    const step = (h: ImpRec, to: ImportStage, d: number, note: string | null = null) => { h.stages.push({ from_stage: h.stage, to_stage: to, changed_at: at(d), changed_by: "Dueño", note }); h.stage = to; h.timeline.push({ at: at(d), text: `Etapa: ${STAGE_LABEL[to]}${note ? ` · ${note}` : ""}` }); };

    // 1) Cerrada hace un mes: costos reales, estimado vs. real.
    const c1 = base("c1", "cotizacion", { rate_e6: 938_500_000, purchase_date: addDays(t, -95), shipment_date: addDays(t, -80), arrival_date: addDays(t, -42), reception_date: addDays(t, -38) });
    c1.items = [item("CAB-25", 500, 30, 30), item("AMP-LED", 100, 70, 50)];
    c1.timeline.push({ at: at(-100), text: `${c1.number} creada como cotización` });
    c1.costs = [cost("flete", 16_000, "USD", true), cost("seguro", 4_000, "CLP", true), cost("agente_aduana", 85_000, "CLP", true), cost("transporte_interno", 30_000, "CLP", true)];
    c1.eta = addDays(t, -45);
    let calc = this.impCalc(c1);
    c1.estimated_landed_clp = calc.landed_clp; c1.estimated_at = at(-96);
    c1.items.forEach((it, i) => { it.estimated_unit_cost_e4 = calc.items[i]!.unit_cost_e4; });
    step(c1, "ordenada", -96, "Pedido confirmado · se guardó el costo estimado"); step(c1, "embarcada", -80); step(c1, "arribada", -42);
    c1.etas.push({ old_eta: addDays(t, -45), new_eta: addDays(t, -42), reason: "Congestión en puerto de destino", changed_at: at(-50), changed_by: "Dueño" });
    c1.eta = addDays(t, -42);
    const real = (k: CostKind, amount: number, currency: string, d: number, ref: string | null, supplier: string | null) => {
      const x = cost(k, amount, currency, false, { supplier_uid: supplier, document_ref: ref, cost_date: addDays(t, d) });
      const clp = this.impCostClp(x, c1);
      const pnum = this.next("EGR");
      x.payable = { due: addDays(t, d), amount: clp, status: "pagada" };
      x.payments = [{ number: pnum, date: addDays(t, d + 2), amount_minor: clp, method: "Transferencia", status: "vigente" }];
      this.payAcc[pnum] = "cta-banco";
      return x;
    };
    c1.costs = [
      real("flete", 17_250, "USD", -82, "BL-88213", fwd.uid), real("seguro", 4_100, "CLP", -82, null, fwd.uid),
      real("derechos", 23_480, "CLP", -41, "DIN 51234", null), real("iva_importacion", 78_350, "CLP", -41, "DIN 51234", null),
      real("agente_aduana", 92_000, "CLP", -40, "F-4410", fwd.uid), real("transporte_interno", 28_500, "CLP", -39, null, fwd.uid),
    ];
    c1.costs.find((c) => c.kind === "iva_importacion")!.recoverable_tax = true;
    calc = this.impCalc(c1);
    const rnum = this.next("REC");
    c1.items.forEach((it, i) => {
      it.received_milli = it.qty_milli; it.landed_unit_cost_e4 = calc.items[i]!.unit_cost_e4;
      // El stock recibido ya está en el stock actual de la demostración: se descuenta del inicial.
      const init = this.moves.find((m) => m.product_uid === it.product_uid && m.kind === "inicial");
      if (init) init.qty -= it.qty_milli;
      this.moves.push({ id: this.moves.length + 1, date: addDays(t, -38), product_uid: it.product_uid!, wh: "wh-principal", kind: "entrada", document: rnum, source_type: "IMP", source_uid: c1.uid, qty: it.qty_milli, cost_e4: calc.items[i]!.unit_cost_e4, reason: null });
    });
    this.moves.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    c1.receipts = [{ number: rnum, date: addDays(t, -38) }];
    c1.fob_minor = calc.fob_minor; c1.landed_total_clp = calc.landed_clp;
    step(c1, "recibida", -38, rnum); step(c1, "cerrada", -30);
    const fmt = (n: number) => new Intl.NumberFormat("es-CL").format(n);
    const diff = calc.landed_clp - c1.estimated_landed_clp;
    c1.timeline.push({ at: at(-30), text: `Cerrada: costo final $${fmt(calc.landed_clp)} · estimado $${fmt(c1.estimated_landed_clp)} · diferencia ${diff < 0 ? "−" : "+"}$${fmt(Math.abs(diff))}` });

    // 2) En tránsito: la ETA cambió dos veces; flete real por pagar y el resto estimado.
    const c2 = base("c2", "cotizacion", { rate_e6: 951_200_000, purchase_date: addDays(t, -40), shipment_date: addDays(t, -12), notes: "Reposición de temporada alta" });
    c2.items = [item("TAL-18V", 60, 2_150, 2_300), item("ATO-SET", 150, 310, 650), item("ESC-5", 12, 3_600, 9_500)];
    c2.timeline.push({ at: at(-45), text: `${c2.number} creada como cotización` });
    c2.costs = [cost("flete", 85_000, "USD", true), cost("seguro", 24_000, "CLP", true), cost("agente_aduana", 175_000, "CLP", true), cost("gastos_portuarios", 140_000, "CLP", true), cost("transporte_interno", 110_000, "CLP", true)];
    c2.eta = addDays(t, 9);
    calc = this.impCalc(c2);
    c2.estimated_landed_clp = calc.landed_clp; c2.estimated_at = at(-40);
    c2.items.forEach((it, i) => { it.estimated_unit_cost_e4 = calc.items[i]!.unit_cost_e4; });
    step(c2, "ordenada", -40, "Pedido confirmado · se guardó el costo estimado"); step(c2, "pagada", -38, "Pago 100 % por transferencia"); step(c2, "produccion", -36); step(c2, "embarcada", -12); step(c2, "en_transito", -11);
    c2.etas.push({ old_eta: addDays(t, 9), new_eta: addDays(t, 14), reason: "Naviera omitió escala (blank sailing)", changed_at: at(-20), changed_by: "Dueño" });
    c2.etas.push({ old_eta: addDays(t, 14), new_eta: addDays(t, 18), reason: "Transbordo en Callao", changed_at: at(-6), changed_by: "Dueño" });
    c2.eta = addDays(t, 18);
    c2.timeline.push({ at: at(-20), text: `ETA cambió de ${addDays(t, 9)} a ${addDays(t, 14)}: Naviera omitió escala (blank sailing)` }, { at: at(-6), text: `ETA cambió de ${addDays(t, 14)} a ${addDays(t, 18)}: Transbordo en Callao` });
    const flete = c2.costs[0]!;
    Object.assign(flete, { is_estimate: false, amount_minor: 92_000, supplier_uid: fwd.uid, document_ref: "BL-90551", cost_date: addDays(t, -12) });
    flete.payable = { due: addDays(t, 18), amount: this.impCostClp(flete, c2), status: "abierta" };
    c2.timeline.push({ at: at(-12), text: "Costo real flete internacional · queda en Dinero que debes" });

    // 3) Cotización aérea en evaluación.
    const c3 = base("c3", "cotizacion", { incoterm: "FCA", transport_mode: "aereo", origin_port: "Shenzhen", destination_port: "Santiago (SCL)", rate_e6: 951_200_000, allocation_basis: "peso", notes: "Comparar contra envío marítimo" });
    c3.items = [item("FOC-LED", 80, 1_150, 1_400), item("AMP-LED", 400, 95, 60)];
    c3.costs = [cost("flete", 98_000, "USD", true), cost("agente_aduana", 120_000, "CLP", true), cost("transporte_interno", 45_000, "CLP", true)];
    c3.timeline.push({ at: at(-3), text: `${c3.number} creada como cotización` });
    this.imps.push(c1, c2, c3);
  }

  /* ───────────── Dinero ───────────── */

  private accountFor(accountUid: string | null | undefined, method: string): string {
    if (accountUid) {
      const a = this.accs.find((x) => x.uid === accountUid);
      if (!a || a.archived) throw new AppError("cuenta", "Elige una cuenta activa.");
      return a.uid;
    }
    const active = this.accs.filter((a) => !a.archived);
    const order: AccountKind[] = methodCode(method) === "efectivo" ? ["caja", "banco", "billetera"] : ["banco", "billetera", "caja"];
    for (const k of order) { const a = active.find((x) => x.kind === k); if (a) return a.uid; }
    const caja: AccRec = { uid: uid("cta"), kind: "caja", name: "Caja", bank_name: null, account_label: null, opening_minor: 0, opening_date: null, archived: false };
    this.accs.push(caja);
    return caja.uid;
  }
  private accName(u: string): string { return this.accs.find((a) => a.uid === u)?.name ?? "Cuenta"; }
  /** Libro de dinero: cada cobro, pago y traspaso con su cuenta. */
  private cashMoves(): (LedgerRow & { acc: string; seq: number })[] {
    const out: (LedgerRow & { acc: string; seq: number })[] = [];
    let seq = 0;
    const acc = (number: string, method: string) => this.payAcc[number] ?? this.accountFor(null, method);
    for (const s of this.sales) for (const p of s.payments) out.push({ acc: acc(p.number, p.method), seq: ++seq, date: p.date, kind: "cobro", document: p.number, detail: `Cobro ${s.number} · ${this.customerName(s.customer_uid)}`, amount_minor: p.amount_minor, link: `/ventas/${s.uid}`, status: s.commercial_state === "anulada" ? "anulado" : "vigente" });
    for (const c of this.purchases) for (const p of c.payments) out.push({ acc: acc(p.number, p.method), seq: ++seq, date: p.date, kind: "pago", document: p.number, detail: `Pago ${c.doc_kind && c.doc_number ? `${c.doc_kind} ${c.doc_number}` : c.number} · ${this.supplierName(c.supplier_uid)}`, amount_minor: -p.amount_minor, link: `/compras/doc/${c.uid}`, status: "vigente" });
    for (const g of this.gastos) for (const p of g.payments) out.push({ acc: acc(p.number, p.method), seq: ++seq, date: p.date, kind: "pago", document: p.number, detail: `Gasto ${g.number} · ${g.description}`, amount_minor: -p.amount_minor, link: `/dinero/gasto/${g.uid}`, status: g.status === "anulado" ? "anulado" : "vigente" });
    for (const h of this.imps) for (const c of h.costs) for (const p of c.payments) out.push({ acc: acc(p.number, p.method), seq: ++seq, date: p.date, kind: "pago", document: p.number, detail: `Importación ${h.number} · ${c.description ?? COST_LABEL[c.kind]}`, amount_minor: -p.amount_minor, link: `/comex/importacion/${h.uid}`, status: p.status });
    for (const t of this.transfers) {
      const n = t.notes ? ` · ${t.notes}` : "";
      out.push({ acc: t.to, seq: ++seq, date: t.date, kind: "traspaso_entrada", document: "Traspaso", detail: `Desde ${this.accName(t.from)}${n}`, amount_minor: t.amount, link: null, status: "vigente" });
      out.push({ acc: t.from, seq: ++seq, date: t.date, kind: "traspaso_salida", document: "Traspaso", detail: `A ${this.accName(t.to)}${n}`, amount_minor: -t.amount, link: null, status: "vigente" });
    }
    return out;
  }
  private accountRows(): MoneyAccount[] {
    const moves = this.cashMoves();
    return this.accs.map((a) => ({ ...a, balance_minor: a.opening_minor + moves.filter((m) => m.acc === a.uid && m.status === "vigente").reduce((x, m) => x + m.amount_minor, 0) }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }
  private seedMoney(): void {
    const t = this.today;
    const start = addDays(t, -150);
    this.accs = [
      { uid: "cta-caja", kind: "caja", name: "Caja del local", bank_name: null, account_label: null, opening_minor: 350_000, opening_date: start, archived: false },
      { uid: "cta-banco", kind: "banco", name: "Cuenta corriente", bank_name: "Banco Ejemplo", account_label: "CC ···· 4821", opening_minor: 2_900_000, opening_date: start, archived: false },
      { uid: "cta-mp", kind: "billetera", name: "Billetera digital", bank_name: null, account_label: null, opening_minor: 0, opening_date: start, archived: false },
    ];
    for (const s of this.sales) for (const p of s.payments) this.payAcc[p.number] = this.accountFor(null, p.method);
    for (const c of this.purchases) for (const p of c.payments) this.payAcc[p.number] = this.accountFor(null, p.method);
    const cat = (n: string) => DEMO_CATEGORIES.find((c) => c.name === n)!.id;
    const monthDay = (offsetMonths: number, day: number) => { const d = new Date(`${t}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() + offsetMonths); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`; };
    const begin = monthDay(-2, 1);
    this.recs = [
      { id: 1, direction: "egreso", description: "Arriendo del local", category_id: cat("Arriendo"), category: "Arriendo", amount_minor: 650_000, frequency: "mensual", day_of_period: 5, starts_on: begin, ends_on: null, active: true },
      { id: 2, direction: "egreso", description: "Internet y teléfono", category_id: cat("Internet y telefonía"), category: "Internet y telefonía", amount_minor: 39_990, frequency: "mensual", day_of_period: 12, starts_on: begin, ends_on: null, active: true },
      { id: 3, direction: "egreso", description: "Sueldos", category_id: cat("Remuneraciones"), category: "Remuneraciones", amount_minor: 1_850_000, frequency: "mensual", day_of_period: 30, starts_on: begin, ends_on: null, active: true },
      { id: 4, direction: "ingreso", description: "Mantención mensual · Constructora (contrato)", category_id: null, category: null, amount_minor: 180_000, frequency: "mensual", day_of_period: 15, starts_on: begin, ends_on: null, active: true },
    ];
    // Gastos de los dos meses anteriores y del actual (los recurrentes ya pagados no se repiten en el calendario).
    const add = (date: string, category: string, description: string, total: number, paid: string | null, due = date, recurring_id: number | null = null, supplier_uid: string | null = null) => {
      if (date > t) return;
      const ppm = this.taxPpm();
      const affected = !["Arriendo", "Remuneraciones", "Impuestos y contribuciones", "Honorarios"].includes(category);
      const net = affected && ppm ? Math.round((total * 1_000_000) / (1_000_000 + ppm)) : total;
      const g: GasRec = { uid: uid("gas"), number: this.next("GAS"), category_id: cat(category), supplier_uid, date, due_date: due, description, net, tax: total - net, total, status: "registrado", payments: [], void_reason: null, notes: null, recurring_id, timeline: [{ at: `${date}T15:00:00Z`, text: `Registrado · ${category} · ${description}` }] };
      if (paid) {
        const pnum = this.next("EGR");
        g.payments.push({ number: pnum, date, amount_minor: total, method: paid });
        this.payAcc[pnum] = this.accountFor(null, paid);
        g.timeline.push({ at: `${date}T15:00:00Z`, text: `Pagado (${paid}) · ${pnum}` });
      } else g.timeline.push({ at: `${date}T15:00:00Z`, text: `Queda en Dinero que debes (vence ${due})` });
      this.gastos.push(g);
    };
    for (const m of [-2, -1, 0]) {
      add(monthDay(m, 5), "Arriendo", "Arriendo del local", 650_000, "Transferencia", monthDay(m, 5), 1);
      add(monthDay(m, 12), "Internet y telefonía", "Internet y teléfono", 39_990, "Transferencia", monthDay(m, 12), 2);
      if (m < 0) add(monthDay(m, 28), "Remuneraciones", "Sueldos", 1_850_000, "Transferencia", monthDay(m, 28), 3);
      add(monthDay(m, 8), "Transporte", "Fletes y combustible", 68_400 + (m + 2) * 4_150, "Efectivo");
    }
    add(addDays(t, -4), "Electricidad", "Cuenta de luz", 84_350, null, addDays(t, 8));
    add(addDays(t, -9), "Marketing", "Avisos en redes sociales", 45_000, "Tarjeta de crédito");
    add(addDays(t, -20), "Honorarios", "Contador (honorarios del mes)", 180_000, null, addDays(t, -3));
    this.transfers = [{ uid: uid("trs"), from: "cta-caja", to: "cta-banco", date: addDays(t, -14), amount: 400_000, notes: "Depósito de efectivo" }];
  }
  private findGasto(u: string): GasRec {
    const g = this.gastos.find((x) => x.uid === u);
    if (!g) throw new AppError("no_encontrado", "No encontramos ese gasto.");
    return g;
  }
  private gastoSummary(g: GasRec): ExpenseSummary {
    const paid = this.paidOf(g.payments);
    return {
      uid: g.uid, number: g.number, date: g.date, due_date: g.due_date, category: this.cats.find((c) => c.id === g.category_id)?.name ?? "Otros",
      supplier_name: g.supplier_uid ? this.supplierName(g.supplier_uid) : null, description: g.description, total_minor: g.total, paid_minor: g.status === "anulado" ? 0 : paid,
      status: g.status, payment_state: g.status === "anulado" ? "anulado" : paid >= g.total ? "pagado" : paid > 0 ? "abonado" : "por_pagar",
    };
  }
  private gastoDetail(g: GasRec): ExpenseDetail {
    return { ...this.gastoSummary(g), supplier_uid: g.supplier_uid, net_minor: g.net, tax_minor: g.tax, payments: g.payments, void_reason: g.void_reason, notes: g.notes, timeline: g.timeline };
  }
  private dues(): { rec: DueRow[]; pay: DueRow[] } {
    const rec: DueRow[] = this.sales.filter((s) => s.commercial_state === "efectuada" || s.commercial_state === "cerrada")
      .map((s) => ({ kind: "cobro" as const, due_date: s.due_date ?? s.issue_date, party: this.customerName(s.customer_uid), document: s.number, link: `/ventas/${s.uid}`, amount_minor: s.totals.total_minor, pending_minor: s.totals.total_minor - this.paid(s) }))
      .filter((d) => d.pending_minor > 0);
    const pay: DueRow[] = [
      ...this.purchases.filter((c) => c.status === "registrada").map((c) => ({ kind: "pago" as const, due_date: c.due_date ?? c.issue_date, party: this.supplierName(c.supplier_uid), document: c.doc_kind && c.doc_number ? `${c.doc_kind} ${c.doc_number}` : c.number, link: `/compras/doc/${c.uid}`, amount_minor: c.totals.total_minor, pending_minor: c.totals.total_minor - this.paidOf(c.payments) })),
      ...this.gastos.filter((g) => g.status === "registrado").map((g) => ({ kind: "pago" as const, due_date: g.due_date ?? g.date, party: g.supplier_uid ? this.supplierName(g.supplier_uid) : this.gastoSummary(g).category, document: `${g.number} · ${g.description}`, link: `/dinero/gasto/${g.uid}`, amount_minor: g.total, pending_minor: g.total - this.paidOf(g.payments) })),
      ...this.imps.flatMap((h) => h.costs.filter((c) => c.status === "vigente" && c.payable?.status === "abierta").map((c) => ({
        kind: "pago" as const, due_date: c.payable!.due, party: c.supplier_uid ? this.supplierName(c.supplier_uid) : "Importación",
        document: `${h.number} · ${c.description ?? COST_LABEL[c.kind].toLowerCase()}`, link: `/comex/importacion/${h.uid}`, amount_minor: c.payable!.amount,
        pending_minor: c.payable!.amount - this.paidOf(c.payments.filter((p) => p.status === "vigente")),
      }))),
    ].filter((d) => d.pending_minor > 0);
    const by = (a: DueRow, b: DueRow) => a.due_date.localeCompare(b.due_date);
    return { rec: rec.sort(by), pay: pay.sort(by) };
  }
  private calendarItems(from: string, to: string): CalendarItem[] {
    const t = this.today;
    const { rec, pay } = this.dues();
    const out: CalendarItem[] = [...rec, ...pay].filter((d) => d.due_date <= to)
      .map((d) => ({ date: d.due_date, kind: d.kind, label: d.document, party: d.party, amount_minor: d.pending_minor, link: d.link, overdue: d.due_date < t }));
    for (const r of this.recs.filter((x) => x.active)) {
      for (const d of occurrences(r, from, to)) {
        const half = r.frequency === "semanal" ? 3 : 15;
        if (r.direction === "egreso" && this.gastos.some((g) => g.recurring_id === r.id && g.status === "registrado" && g.date >= addDays(d, -half) && g.date <= addDays(d, half))) continue;
        out.push({ date: d, kind: r.direction === "ingreso" ? "ingreso_recurrente" : "egreso_recurrente", label: r.description, party: r.category ?? "Recurrente", amount_minor: r.amount_minor, link: null, overdue: false });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  async moneyAccounts(): Promise<MoneyAccount[]> { this.require("dinero.ver"); return wait(this.accountRows()); }
  private accountInput(input: AccountInput): Omit<AccRec, "uid" | "archived"> {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new AppError("validacion", "Ponle un nombre a la cuenta (hasta 80 caracteres).");
    if (!["caja", "banco", "billetera"].includes(input.kind)) throw new AppError("validacion", "Elige el tipo de cuenta.");
    const label = input.account_label?.trim() || null;
    if (label && (label.match(/\d/g)?.length ?? 0) > 8) throw new AppError("validacion", "Para la referencia de la cuenta anota solo los últimos 4 dígitos: NÚCLEO no guarda números de cuenta completos.");
    if (!Number.isFinite(input.opening_minor)) throw new AppError("validacion", "Revisa el saldo inicial.");
    return { kind: input.kind, name, bank_name: input.bank_name?.trim() || null, account_label: label, opening_minor: Math.round(input.opening_minor), opening_date: input.opening_date || this.today };
  }
  async createMoneyAccount(input: AccountInput): Promise<MoneyAccount[]> {
    this.require("dinero.registrar");
    const f = this.accountInput(input);
    if (this.accs.some((a) => !a.archived && norm(a.name) === norm(f.name))) throw new AppError("duplicado", "Ya tienes una cuenta con ese nombre.");
    this.accs.push({ uid: uid("cta"), archived: false, ...f });
    this.log("cuenta.crear", "cuenta", f.name);
    return wait(this.accountRows());
  }
  async updateMoneyAccount(u: string, input: AccountInput): Promise<MoneyAccount[]> {
    this.require("dinero.registrar");
    const a = this.accs.find((x) => x.uid === u);
    if (!a) throw new AppError("no_encontrado", "No encontramos esa cuenta.");
    Object.assign(a, this.accountInput(input));
    this.log("cuenta.editar", "cuenta", a.name);
    return wait(this.accountRows());
  }
  async archiveMoneyAccount(u: string): Promise<MoneyAccount[]> {
    this.require("dinero.registrar");
    const row = this.accountRows().find((x) => x.uid === u);
    if (!row) throw new AppError("no_encontrado", "No encontramos esa cuenta.");
    if (row.balance_minor !== 0) throw new AppError("saldo", "Solo se archivan cuentas con saldo cero: traspasa primero el dinero a otra cuenta.");
    if (this.accs.filter((a) => !a.archived).length <= 1) throw new AppError("ultima", "Necesitas al menos una cuenta activa.");
    this.accs.find((x) => x.uid === u)!.archived = true;
    this.log("cuenta.archivar", "cuenta", row.name);
    return wait(this.accountRows());
  }
  async accountLedger(u: string): Promise<LedgerRow[]> {
    this.require("dinero.ver");
    return wait(this.cashMoves().filter((m) => m.acc === u).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq).slice(0, 500)
      .map(({ acc: _a, seq: _s, ...r }) => r));
  }
  async transferMoney(input: MoneyTransferInput): Promise<MoneyAccount[]> {
    this.require("dinero.registrar");
    if (input.from_uid === input.to_uid) throw new AppError("validacion", "Elige dos cuentas distintas.");
    const rows = this.accountRows();
    const from = rows.find((a) => a.uid === input.from_uid && !a.archived);
    const to = rows.find((a) => a.uid === input.to_uid && !a.archived);
    if (!from || !to) throw new AppError("cuenta", "Elige cuentas activas.");
    if (!(input.amount_minor > 0)) throw new AppError("monto", "El monto debe ser mayor que cero.");
    this.transfers.push({ uid: uid("trs"), from: from.uid, to: to.uid, date: input.date, amount: input.amount_minor, notes: input.notes?.trim() || null });
    this.log("dinero.traspasar", "cuenta", `${from.name} → ${to.name}`);
    return wait(this.accountRows());
  }
  async expenseCategories(): Promise<ExpenseCategory[]> { return wait([...this.cats].sort((a, b) => a.name.localeCompare(b.name))); }
  async addExpenseCategory(name: string, fixed: boolean): Promise<ExpenseCategory[]> {
    this.require("dinero.registrar");
    const n = name.trim();
    if (!n || n.length > 60) throw new AppError("validacion", "Escribe el nombre de la categoría (hasta 60 caracteres).");
    if (this.cats.some((c) => norm(c.name) === norm(n))) throw new AppError("duplicado", "Esa categoría ya existe.");
    this.cats.push({ id: this.cats.length + 1, name: n, behavior: fixed ? "fijo" : "variable" });
    return this.expenseCategories();
  }
  async listExpenses(filter: ExpenseFilter): Promise<ExpenseSummary[]> {
    this.require("dinero.ver");
    const q = norm(filter.query?.trim() ?? "");
    const rows = this.gastos.map((g) => this.gastoSummary(g)).filter((g) =>
      (filter.include_void || g.status !== "anulado") && (!filter.from || g.date >= filter.from) && (!filter.to || g.date <= filter.to)
      && (!q || norm(`${g.number} ${g.description} ${g.category} ${g.supplier_name ?? ""}`).includes(q)));
    return wait(rows.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)));
  }
  async expense(u: string): Promise<ExpenseDetail> { this.require("dinero.ver"); return wait(this.gastoDetail(this.findGasto(u))); }
  async registerExpense(input: ExpenseInput): Promise<ExpenseDetail> {
    this.require("dinero.registrar");
    const cat = this.cats.find((c) => c.id === input.category_id);
    if (!cat) throw new AppError("no_encontrado", "Elige una categoría.");
    if (input.supplier_uid) this.findSupplier(input.supplier_uid);
    const description = input.description.trim();
    if (!description || description.length > 200) throw new AppError("validacion", "Describe el gasto (hasta 200 caracteres).");
    if (!(input.total_minor > 0)) throw new AppError("monto", "El monto debe ser mayor que cero.");
    const due = input.due_date || input.date;
    if (due < input.date) throw new AppError("vencimiento", "El vencimiento no puede ser anterior al gasto.");
    const ppm = this.taxPpm();
    const net = input.tax_included && ppm ? Math.round((input.total_minor * 1_000_000) / (1_000_000 + ppm)) : input.total_minor;
    const g: GasRec = { uid: uid("gas"), number: this.next("GAS"), category_id: cat.id, supplier_uid: input.supplier_uid || null, date: input.date, due_date: due, description, net, tax: input.total_minor - net, total: input.total_minor, status: "registrado", payments: [], void_reason: null, notes: input.notes?.trim() || null, recurring_id: input.recurring_id, timeline: [] };
    g.timeline.push({ at: now(), text: `${g.number} registrado · ${cat.name} · ${description}` });
    if (input.paid_method) {
      const acc = this.accountFor(input.paid_account_uid, input.paid_method);
      const pnum = this.next("EGR");
      g.payments.push({ number: pnum, date: input.date, amount_minor: input.total_minor, method: input.paid_method });
      this.payAcc[pnum] = acc;
      g.timeline.push({ at: now(), text: `Pagado (${input.paid_method}) · ${pnum}` });
    } else g.timeline.push({ at: now(), text: `Queda en Dinero que debes (vence ${due})` });
    this.gastos.push(g);
    this.log("gasto.registrar", "gasto", g.number);
    return wait(this.gastoDetail(g));
  }
  async payExpense(u: string, amount: number, method: string, date: string, accountUid?: string): Promise<ExpenseDetail> {
    this.require("dinero.registrar");
    const g = this.findGasto(u);
    if (g.status !== "registrado") throw new AppError("estado", "El gasto está anulado.");
    const due = g.total - this.paidOf(g.payments);
    if (amount <= 0 || amount > due) throw new AppError("monto", "El monto debe ser mayor que cero y no superar el saldo.");
    const acc = this.accountFor(accountUid, method);
    const pnum = this.next("EGR");
    g.payments.push({ number: pnum, date, amount_minor: amount, method });
    this.payAcc[pnum] = acc;
    g.timeline.push({ at: now(), text: `${amount === due ? "Pago final" : "Abono"} (${method}) · ${pnum}` });
    this.log("gasto.pagar", "gasto", g.number);
    return wait(this.gastoDetail(g));
  }
  async voidExpense(u: string, reason: string): Promise<ExpenseDetail> {
    this.require("dinero.registrar");
    const g = this.findGasto(u);
    if (!reason.trim()) throw new AppError("motivo", "Escribe el motivo de la anulación.");
    if (g.status === "anulado") throw new AppError("estado", "El gasto ya está anulado.");
    g.status = "anulado"; g.void_reason = reason.trim();
    g.timeline.push({ at: now(), text: `Anulado: ${reason.trim()}` });
    if (g.payments.length) g.timeline.push({ at: now(), text: "Pagos anulados: el dinero vuelve a la cuenta" });
    this.log("gasto.anular", "gasto", g.number, reason.trim());
    return wait(this.gastoDetail(g));
  }
  async recurring(): Promise<Recurring[]> { this.require("dinero.ver"); return wait(this.recs); }
  async saveRecurring(input: RecurringInput): Promise<Recurring[]> {
    this.require("dinero.registrar");
    const description = input.description.trim();
    if (!description || description.length > 120) throw new AppError("validacion", "Describe el movimiento (hasta 120 caracteres).");
    if (!(input.amount_minor > 0)) throw new AppError("monto", "El monto debe ser mayor que cero.");
    if (input.day_of_period !== null && (input.day_of_period < 1 || input.day_of_period > 31)) throw new AppError("validacion", "El día debe estar entre 1 y 31.");
    if (input.ends_on && input.ends_on < input.starts_on) throw new AppError("validacion", "La fecha de término es anterior al inicio.");
    const category = input.category_id ? this.cats.find((c) => c.id === input.category_id)?.name ?? null : null;
    const row: Recurring = { ...input, description, ends_on: input.ends_on || null, category, id: input.id ?? Math.max(0, ...this.recs.map((r) => r.id)) + 1 };
    const i = this.recs.findIndex((r) => r.id === row.id);
    if (i >= 0) this.recs[i] = row; else this.recs.push(row);
    this.log("recurrente.guardar", "recurrente", description);
    return wait(this.recs);
  }
  async moneyOverview(): Promise<MoneyOverview> {
    this.require("dinero.ver");
    const t = this.today;
    const accounts = this.accountRows();
    const cash = accounts.filter((a) => !a.archived).reduce((x, a) => x + a.balance_minor, 0);
    const { rec, pay } = this.dues();
    const rAging = emptyAging(), pAging = emptyAging();
    const late = (d: string) => daysBetween(d, t);
    for (const r of rec) agingAdd(rAging, late(r.due_date), r.pending_minor);
    for (const p of pay) agingAdd(pAging, late(p.due_date), p.pending_minor);
    const end = addDays(t, PROJECTION_WEEKS * 7 - 1);
    const items = this.calendarItems(t, end).map((c) => ({ d: c.date < t ? t : c.date, v: (c.kind === "cobro" || c.kind === "ingreso_recurrente" ? 1 : -1) * c.amount_minor }));
    const projection: MoneyOverview["projection"] = [];
    let balance = cash, lowest = cash;
    let lowestWeek: string | null = null;
    for (let w = 0; w < PROJECTION_WEEKS; w++) {
      const a = addDays(t, w * 7), b = addDays(t, w * 7 + 6);
      const inW = items.filter((i) => i.d >= a && i.d <= b);
      const inflow = inW.filter((i) => i.v > 0).reduce((x, i) => x + i.v, 0);
      const outflow = -inW.filter((i) => i.v < 0).reduce((x, i) => x + i.v, 0);
      const opening = balance;
      balance += inflow - outflow;
      if (balance < lowest) { lowest = balance; lowestWeek = a; }
      projection.push({ start: a, end: b, opening_minor: opening, inflow_minor: inflow, outflow_minor: outflow, closing_minor: balance });
    }
    const d30 = addDays(t, 29);
    const in30 = items.filter((i) => i.d <= d30 && i.v > 0).reduce((x, i) => x + i.v, 0);
    const out30 = -items.filter((i) => i.d <= d30 && i.v < 0).reduce((x, i) => x + i.v, 0);
    const sum = (rows: DueRow[], overdue = false) => rows.filter((r) => !overdue || r.due_date < t).reduce((x, r) => x + r.pending_minor, 0);
    return wait({
      today: t, accounts, cash_minor: cash,
      receivable_minor: sum(rec), receivable_overdue_minor: sum(rec, true), receivable_aging: rAging,
      payable_minor: sum(pay), payable_overdue_minor: sum(pay, true), payable_aging: pAging,
      next30_in_minor: in30, next30_out_minor: out30, in30_minor: cash + in30 - out30,
      projection, shortfall_week: lowest < 0 ? lowestWeek : null, lowest_minor: lowest, receivables: rec, payables: pay,
    }, 120);
  }
  async moneyCalendar(days: number): Promise<CalendarItem[]> {
    this.require("dinero.ver");
    const n = Math.min(366, Math.max(1, days));
    return wait(this.calendarItems(this.today, addDays(this.today, n - 1)));
  }

  /* ───────────────────────────── Impuestos: F29 ───────────────────────────── */

  private taxProf: TaxProfile = { regime: "14d3", ppm_rate_ppm: 2_500, utm_decimals: null, due_day: 20, common_use_ppm: null };
  private taxDocs: (TaxDocLine & { period: string; id: number })[] = [];
  private taxBatches: { id: number; period: string; direction: "venta" | "compra"; file_name: string | null; rows: number; at: string }[] = [];
  private f29s: Record<string, { status: "borrador" | "declarado"; inputs: F29Inputs; declared: F29View["declared"] }> = {
    // El F29 de hace dos meses ya está declarado; el del mes pasado es el que toca preparar.
    [addDays(addDays(todayIso().slice(0, 8) + "01", -1).slice(0, 8) + "01", -1).slice(0, 7)]: { status: "declarado", inputs: {}, declared: { declared_77: 0, declared_91: 412_380, folio: "7451230987", at: `${addDays(todayIso().slice(0, 8) + "01", -12)}T15:00:00Z` } },
  };
  private taxSeq = 0;

  private checkPeriod(p: string): string {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.trim())) throw new AppError("validacion", "El período debe tener el formato AAAA-MM.");
    return p.trim();
  }
  private shiftPeriod(p: string, months: number): string {
    const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7));
    const idx = y * 12 + (m - 1) + months;
    return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12 + 12) % 12 + 1).padStart(2, "0")}`;
  }
  private nucleoTaxDocs(period: string, sales: boolean, purchases: boolean, checks: F29Note[]): TaxDocLine[] {
    const out: TaxDocLine[] = [];
    const base = { id: null, tax_non_rec_minor: 0, common_use_tax_minor: 0, not_of_business: false, count: 1, origin: "nucleo" as const };
    const check = (severity: F29Note["severity"], text: string) => checks.push({ code: null, severity, text });
    if (sales) {
      let pending = 0, pendingTotal = 0, voided = 0;
      for (const s of this.sales) {
        const date = s.external_ref?.issue_date ?? s.issue_date;
        if (!date.startsWith(period)) continue;
        if (s.commercial_state === "anulada") { if (s.documentation_state === "documentada") voided++; continue; }
        if (!["efectuada", "cerrada"].includes(s.commercial_state)) continue;
        if (s.documentation_state === "pendiente") { pending++; pendingTotal += s.totals.total_minor; continue; }
        if (s.documentation_state !== "documentada") continue;
        const t = siiTypeFromText(s.external_ref?.doc_kind ?? null, s.totals.tax_minor, s.totals.exempt_minor);
        if (t === null) continue;
        out.push({ ...base, direction: "venta", sii_type: t, folio: s.external_ref?.external_number ?? null, issue_date: date,
          counterpart: s.customer_uid ? this.customers.find((c) => c.uid === s.customer_uid)?.name ?? null : null,
          exempt_minor: s.totals.exempt_minor, net_minor: s.totals.net_minor, tax_minor: s.totals.tax_minor, kind: null, reference: s.number });
      }
      if (pending) check("aviso", `${pending} venta(s) del mes por ${clpText(pendingTotal)} siguen sin documentar: no entran al borrador hasta que anotes su factura o boleta.`);
      if (voided) check("aviso", `${voided} venta(s) documentada(s) se anularon: si emitiste la factura o boleta, regístrala con su nota de crédito.`);
    }
    if (purchases) {
      for (const p of this.purchases.filter((x) => x.status === "registrada" && x.issue_date.startsWith(period))) {
        const t = siiTypeFromText(p.doc_kind, p.totals.tax_minor, p.totals.exempt_minor);
        if (t === null) continue;
        out.push({ ...base, direction: "compra", sii_type: t, folio: p.doc_number, issue_date: p.issue_date, counterpart: this.supplierName(p.supplier_uid),
          exempt_minor: p.totals.exempt_minor, net_minor: p.totals.net_minor, tax_minor: p.totals.tax_minor, kind: "giro", reference: p.number });
      }
      const gastos = this.gastos.filter((g) => g.status === "registrado" && g.tax > 0 && g.date.startsWith(period));
      if (gastos.length) check("aviso", `${gastos.length} gasto(s) con IVA se tomaron como facturas del giro. Si alguno se pagó con boleta, su IVA no da crédito: importa el registro de compras del SII para usar lo que realmente recibiste.`);
      for (const g of gastos) out.push({ ...base, direction: "compra", sii_type: 33, folio: null, issue_date: g.date,
        counterpart: g.supplier_uid ? this.supplierName(g.supplier_uid) : g.description, exempt_minor: 0, net_minor: g.net, tax_minor: g.tax, kind: "giro", reference: g.number });
      let estimated = 0;
      const din = new Map<string, TaxDocLine>();
      for (const h of this.imps.filter((x) => x.stage !== "anulada")) {
        for (const c of h.costs.filter((x) => x.kind === "iva_importacion" && x.status === "vigente" && x.cost_date?.startsWith(period))) {
          if (c.is_estimate) { estimated++; continue; }
          const amount = this.impCostClp(c, h);
          const key = c.document_ref ?? `${h.number}·${c.cost_date}`;
          const d = din.get(key) ?? { ...base, direction: "compra" as const, sii_type: 914, folio: c.document_ref, issue_date: c.cost_date, counterpart: "Servicio Nacional de Aduanas",
            exempt_minor: 0, net_minor: 0, tax_minor: 0, kind: c.recoverable_tax ? "giro" as const : "sin_derecho" as const, reference: h.number };
          if (c.recoverable_tax) d.tax_minor += amount; else d.tax_non_rec_minor += amount;
          din.set(key, d);
        }
      }
      out.push(...din.values());
      if (estimated) check("aviso", `${estimated} IVA de importación del mes todavía es estimado: no entra al borrador hasta que ingreses el monto real de la declaración de ingreso.`);
    }
    return out;
  }
  private buildF29(period: string): F29View {
    const rec = this.f29s[period];
    const inputs = rec?.inputs ?? {};
    const checks: F29Note[] = [];
    const sources: F29Source[] = (["venta", "compra"] as const).map((dir) => {
      const b = this.taxBatches.filter((x) => x.period === period && x.direction === dir);
      const last = b[b.length - 1];
      return last ? { direction: dir, source: "rcv" as const, file_name: last.file_name, imported_at: last.at, rows: b.reduce((a, x) => a + x.rows, 0) }
        : { direction: dir, source: "nucleo" as const, file_name: null, imported_at: null, rows: 0 };
    });
    const docs: TaxDocLine[] = this.taxDocs.filter((d) => d.period === period).map(({ period: _p, ...d }) => d);
    const useV = sources[0]!.source === "nucleo", useC = sources[1]!.source === "nucleo";
    docs.push(...this.nucleoTaxDocs(period, useV, useC, checks));
    if (useV || useC) checks.push({ code: null, severity: "info", text: "Parte del borrador usa los datos de NÚCLEO. Para que coincida con sii.cl, importa el Registro de Compras y Ventas del mes." });
    const prev = this.shiftPeriod(period, -1);
    const prevRec = this.f29s[prev];
    const suggested = prevRec?.status === "declarado" ? prevRec.declared?.declared_77 ?? null : null;
    const remnant = inputs.remnant_amount ?? suggested ?? 0;
    const p = this.taxProf;
    const result = computeF29({
      docs: docs.map((d) => ({ direction: d.direction, sii_type: d.sii_type, count: d.count, exempt: d.exempt_minor, net: d.net_minor, tax: d.tax_minor,
        tax_non_recoverable: d.tax_non_rec_minor, common_use_tax: d.common_use_tax_minor, kind: d.kind, not_of_business: d.not_of_business })),
      remnant: remnant > 0 ? { amount: remnant, utm_prev: inputs.utm_prev ?? 0, utm_cur: inputs.utm_cur ?? 0, utm_decimals: p.utm_decimals } : null,
      ppm: p.ppm_rate_ppm !== null ? { rate_ppm: p.ppm_rate_ppm, credit: inputs.ppm_credit ?? 0, loss: !!inputs.ppm_loss, base_override: inputs.ppm_base_override ?? null } : null,
      common_use_ppm: inputs.common_use_ppm ?? p.common_use_ppm, manual: inputs.manual ?? {},
    });
    const periods = Object.entries(this.f29s).map(([k, v]) => ({ period: k, status: v.status, declared_91: v.declared?.declared_91 ?? null })).sort((a, b) => b.period.localeCompare(a.period));
    return {
      period, status: rec?.status ?? "borrador", profile: { ...p }, inputs: structuredClone(inputs), remnant_suggested: suggested, remnant_from: suggested !== null ? prev : null,
      sources, docs, result, checks, declared: rec?.status === "declarado" ? rec.declared : null,
      due_date: p.due_day ? `${this.shiftPeriod(period, 1)}-${String(p.due_day).padStart(2, "0")}` : null, periods,
    };
  }
  private requireOpenF29(period: string): void {
    if (this.f29s[period]?.status === "declarado") throw new AppError("estado", "Este F29 está marcado como declarado: reábrelo para cambiarlo.");
  }
  async taxProfile(): Promise<TaxProfile> { this.require("contabilidad.ver"); return wait({ ...this.taxProf }); }
  async saveTaxProfile(profile: TaxProfile): Promise<TaxProfile> {
    this.require("contabilidad.editar");
    if (!["14d3", "14d8", "14a"].includes(profile.regime)) throw new AppError("validacion", "Régimen tributario no válido.");
    if (profile.ppm_rate_ppm !== null && (profile.ppm_rate_ppm < 0 || profile.ppm_rate_ppm > 100_000)) throw new AppError("validacion", "La tasa de PPM debe estar entre 0 % y 10 %.");
    this.taxProf = { ...profile };
    this.log("impuestos.perfil", "impuestos", "perfil");
    return wait({ ...this.taxProf });
  }
  async f29(period: string): Promise<F29View> { this.require("contabilidad.ver"); return wait(this.buildF29(this.checkPeriod(period)), 120); }
  async saveF29Inputs(period: string, inputs: F29Inputs): Promise<F29View> {
    this.require("contabilidad.editar");
    const p = this.checkPeriod(period);
    this.requireOpenF29(p);
    for (const k of Object.keys(inputs.manual ?? {})) if (!MANUAL_CODES.includes(Number(k) as never)) throw new AppError("validacion", `El código ${k} no se ingresa a mano.`);
    this.f29s[p] = { status: "borrador", declared: null, ...this.f29s[p], inputs: structuredClone(inputs) };
    this.log("f29.datos", "f29", p);
    return wait(this.buildF29(p));
  }
  async importRcv(period: string, direction: "venta" | "compra", fileName: string | null, text: string): Promise<RcvImportReport> {
    this.require("contabilidad.editar");
    const p = this.checkPeriod(period);
    this.requireOpenF29(p);
    let parsed;
    try { parsed = parseRcv(text); } catch (e) { throw new AppError("validacion", `${(e as Error).message[0]!.toUpperCase()}${(e as Error).message.slice(1)}.`); }
    if (!parsed.rows.length) throw new AppError("validacion", "El archivo no tiene documentos.");
    this.taxDocs = this.taxDocs.filter((d) => !(d.period === p && d.direction === direction && d.origin === "rcv"));
    this.taxBatches = this.taxBatches.filter((b) => !(b.period === p && b.direction === direction));
    this.taxBatches.push({ id: ++this.taxSeq, period: p, direction, file_name: fileName, rows: parsed.rows.length, at: now() });
    for (const r of parsed.rows) {
      this.taxDocs.push({ period: p, id: ++this.taxSeq, origin: "rcv", direction, sii_type: r.sii_type, folio: r.folio, issue_date: r.issue_date,
        counterpart: r.counterpart_name ?? r.counterpart_rut, count: r.count, exempt_minor: r.exempt, net_minor: r.net, tax_minor: r.tax,
        tax_non_rec_minor: r.tax_non_recoverable, common_use_tax_minor: r.common_use_tax, kind: direction === "compra" ? rcvPurchaseKind(r) : null,
        not_of_business: direction === "venta" && rcvSaleNotOfBusiness(r), reference: null });
    }
    this.log("f29.importar", "f29", p);
    const otherPeriod = parsed.rows.filter((r) => r.issue_date && !r.issue_date.startsWith(p)).length;
    return wait({ rows: parsed.rows.length, skipped: parsed.skipped.map(([n, m]) => `Línea ${n}: ${m}`), other_period: otherPeriod, view: this.buildF29(p) }, 300);
  }
  async clearRcv(period: string, direction: "venta" | "compra"): Promise<F29View> {
    this.require("contabilidad.editar");
    const p = this.checkPeriod(period);
    this.requireOpenF29(p);
    this.taxDocs = this.taxDocs.filter((d) => !(d.period === p && d.direction === direction && d.origin === "rcv"));
    this.taxBatches = this.taxBatches.filter((b) => !(b.period === p && b.direction === direction));
    this.log("f29.quitar_registro", "f29", p);
    return wait(this.buildF29(p));
  }
  async addTaxDocument(period: string, d: TaxDocInput): Promise<F29View> {
    this.require("contabilidad.editar");
    const p = this.checkPeriod(period);
    this.requireOpenF29(p);
    if (!d.sii_type || d.sii_type > 999) throw new AppError("validacion", "Revisa el tipo de documento.");
    this.taxDocs.push({ period: p, id: ++this.taxSeq, origin: "manual", direction: d.direction, sii_type: d.sii_type, folio: d.folio || null, issue_date: d.issue_date || null,
      counterpart: d.counterpart_name || d.counterpart_rut || null, count: d.doc_count ?? 1, exempt_minor: d.exempt_minor, net_minor: d.net_minor, tax_minor: d.tax_minor,
      tax_non_rec_minor: 0, common_use_tax_minor: 0, kind: d.direction === "compra" ? d.purchase_kind ?? "giro" : null, not_of_business: !!d.not_of_business, reference: null });
    this.log("f29.documento", "f29", p);
    return wait(this.buildF29(p));
  }
  async deleteTaxDocument(id: number): Promise<F29View> {
    this.require("contabilidad.editar");
    const d = this.taxDocs.find((x) => x.id === id);
    if (!d) throw new AppError("no_encontrado", "No se encontró el documento.");
    this.requireOpenF29(d.period);
    if (d.origin !== "manual") throw new AppError("validacion", "Solo se quitan documentos ingresados a mano; para el registro del SII, vuelve a importarlo.");
    this.taxDocs = this.taxDocs.filter((x) => x.id !== id);
    this.log("f29.documento_quitar", "f29", d.period);
    return wait(this.buildF29(d.period));
  }
  async setTaxDocumentKind(id: number, kind: string): Promise<F29View> {
    this.require("contabilidad.editar");
    const d = this.taxDocs.find((x) => x.id === id);
    if (!d) throw new AppError("no_encontrado", "No se encontró el documento.");
    this.requireOpenF29(d.period);
    if (d.direction !== "compra") throw new AppError("validacion", "Solo las compras se clasifican.");
    d.kind = kind as PurchaseKind;
    this.log("f29.clasificar", "f29", d.period);
    return wait(this.buildF29(d.period));
  }
  async markF29Declared(period: string, declared77: number, declared91: number, folio: string | null): Promise<F29View> {
    this.require("contabilidad.editar");
    const p = this.checkPeriod(period);
    this.requireOpenF29(p);
    if (declared77 < 0 || declared91 < 0) throw new AppError("validacion", "Revisa los montos declarados.");
    this.f29s[p] = { inputs: this.f29s[p]?.inputs ?? {}, status: "declarado", declared: { declared_77: declared77, declared_91: declared91, folio: folio || null, at: now() } };
    this.log("f29.declarar", "f29", p);
    return wait(this.buildF29(p));
  }
  async reopenF29(period: string, reason: string): Promise<F29View> {
    this.require("contabilidad.editar");
    const p = this.checkPeriod(period);
    if (!reason.trim()) throw new AppError("validacion", "Indica por qué se reabre.");
    const r = this.f29s[p];
    if (r) { r.status = "borrador"; }
    this.log("f29.reabrir", "f29", p, reason.trim());
    return wait(this.buildF29(p));
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

const clpText = (v: number) => `$${Math.round(v).toLocaleString("es-CL")}`;
