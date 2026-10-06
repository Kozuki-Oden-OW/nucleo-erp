// Backend de demostración: implementa el mismo puerto que el escritorio, con datos ficticios en memoria.
// Sirve para el navegador (prueba de usabilidad de la Fase 3) y para desarrollar pantallas antes de
// que exista su comando Rust. No persiste nada: al recargar la página vuelve al estado inicial.
import { AppError, type Backend, type Feature, type FileSource, type SaleFilter } from "../backend";
import { computeLines, computeTotals, lineIsValid } from "../calc";
import type {
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, DocLink, EffectInput, EntityRef, ExternalRef, ExternalRefInput, Line, LineInput,
  NewCustomer, NewProduct, NewUser, Payment, PermissionRow, Product, PurchaseOrderDetail, PurchaseOrderSummary, QuoteDetail,
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
interface PoRec extends PurchaseOrderDetail {}

let uidSeq = 0;
const uid = (p: string) => `${p}-${(++uidSeq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const wait = <T,>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const now = () => new Date().toISOString().slice(0, 19) + "Z";

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  readonly features: ReadonlySet<Feature> = new Set<Feature>([
    "dashboard", "clientes", "productos", "ventas", "compras", "comex", "negocio", "busqueda",
    "usuarios", "documentos", "numeracion", "monedas", "auditoria",
  ]);
  private company = { uid: "demo-company", name: DEMO_COMPANY, profile: "empresa" as BusinessProfile, created_at: "2026-01-02T12:00:00Z" };
  private biz: BusinessSettings;
  private customers: Customer[] = [];
  private products: Product[] = [];
  private quotes: QuoteRec[] = [];
  private sales: SaleRec[] = [];
  private pos: PoRec[] = [];
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
      email: "contacto@ejemplo.cl", documentation_reminder: true, tax_enabled: true, tax_rate_ppm: TAX_PPM, tax_rule_source: TAX_SOURCE,
    };
    this.seed();
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

    // Órdenes de compra.
    const supplierLines = (idx: number[]) => idx.map((i) => {
      const p = this.products[i]!;
      return { product_uid: p.uid, description: p.name, qty_milli: (10 + Math.floor(r() * 20)) * 1000, received_milli: 0, unit_cost_minor: Math.round(p.cost_e4 / 10_000) };
    });
    const poDefs: [string, number[], number, PurchaseOrderSummary["status"]][] = [
      [SUPPLIER_NAMES[0]!, [10, 11, 18, 19], -6, "emitida"],
      [SUPPLIER_NAMES[2]!, [13, 14, 17], -2, "emitida"],
      [SUPPLIER_NAMES[4]!, [23, 24, 25], -20, "recibida"],
    ];
    for (const [supplier, idx, days, status] of poDefs) {
      const lines = supplierLines(idx);
      if (status === "recibida") lines.forEach((l) => (l.received_milli = l.qty_milli));
      const totals = computeTotals(lines.map((l) => ({ product_uid: l.product_uid, description: l.description, qty_milli: l.qty_milli, unit_price_minor: l.unit_cost_minor, discount_ppm: 0, taxable: true })), TAX_PPM);
      this.pos.push({ uid: uid("oc"), number: this.next("OC"), supplier_name: supplier, issue_date: addDays(this.today, days), expected_date: addDays(this.today, days + 7), status, total_minor: totals.total_minor, lines, totals });
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
    for (const o of this.pos) if (norm(`${o.number} ${o.supplier_name}`).includes(q)) hits.push({ kind: "orden_compra", uid: o.uid, title: `${o.number} · ${o.supplier_name}`, subtitle: o.issue_date });
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
    const payable = this.pos.filter((o) => o.status !== "anulada").reduce((a, o) => a + (o.status === "recibida" ? o.total_minor : 0), 0) + 640_000;
    const collected = live.reduce((a, s) => a + s.payments.filter((p) => p.date >= addDays(t, -45)).reduce((x, p) => x + p.amount_minor, 0), 0);
    const purchaseCredit = Math.round(this.pos.filter((o) => o.status === "recibida").reduce((a, o) => a + o.totals.tax_minor, 0));
    const series: Dashboard["series"] = [];
    for (let m = 11; m >= 0; m--) {
      const d = new Date(`${t}T12:00:00`); d.setDate(1); d.setMonth(d.getMonth() - m);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      series.push({ month: key, sales_minor: (this.history[key] ?? 0) + sumBy((s) => s.issue_date.startsWith(key), (s) => s.totals.total_minor) });
    }
    const upcoming: Dashboard["upcoming_payments"] = [
      ...open.filter((s) => s.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 4).map((s) => ({ label: `${s.number} · ${this.customerName(s.customer_uid)}`, date: s.due_date!, amount_minor: s.totals.total_minor - this.paid(s), kind: "cobro" as const })),
      { label: `Arriendo local`, date: addDays(t, 5), amount_minor: 650_000, kind: "pago" as const },
      { label: `${this.pos[2]?.number ?? "OC"} · ${SUPPLIER_NAMES[4]}`, date: addDays(t, 9), amount_minor: this.pos[2]?.total_minor ?? 0, kind: "pago" as const },
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
  async addCustomer(input: NewCustomer): Promise<Customer> {
    if (!input.name.trim()) throw new AppError("nombre", "El nombre del cliente es obligatorio.");
    let rut: string | null = null;
    if (input.rut?.trim()) {
      const clean = input.rut.replace(/[.\s]/g, "").toUpperCase();
      const m = /^(\d{1,8})-?([\dK])$/.exec(clean);
      if (!m || rutDv(Number(m[1])) !== m[2]) throw new AppError("rut", "El RUT no es válido: revisa el dígito verificador.");
      rut = `${m[1]}-${m[2]}`;
      if (this.customers.some((c) => c.rut === rut)) throw new AppError("rut_duplicado", "Ya existe un cliente con ese RUT.");
    }
    const c: Customer = { id: this.customers.length + 1, uid: uid("cli"), name: input.name.trim(), rut, email: input.email?.trim() || null, phone: input.phone?.trim() || null, created_at: now() };
    this.customers.push(c);
    this.log("cliente.crear", "cliente", c.uid);
    return wait(c);
  }
  async searchProducts(query: string): Promise<Product[]> {
    const q = norm(query.trim());
    const words = q.split(/\s+/).filter(Boolean);
    const rows = words.length ? this.products.filter((p) => { const h = norm(`${p.name} ${p.sku}`); return words.every((w) => h.includes(w)); }) : this.products;
    return wait(rows, 30);
  }
  async addProduct(input: NewProduct): Promise<Product> {
    if (!input.name.trim()) throw new AppError("nombre", "El nombre del producto es obligatorio.");
    const p: Product = {
      uid: uid("pro"), sku: input.sku?.trim() || `P-${this.products.length + 1}`, name: input.name.trim(), unit: input.unit || "un", kind: input.kind,
      price_minor: input.price_minor, cost_e4: (input.cost_minor ?? 0) * 10_000, on_hand_milli: 0, min_milli: 0, taxable: input.taxable ?? true,
    };
    this.products.push(p);
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
    for (const l of s.lines) {
      const p = this.products.find((x) => x.uid === l.product_uid);
      if (p && p.kind === "producto") { p.on_hand_milli -= l.qty_milli; l.unit_cost_e4 = p.cost_e4; }
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
        if (p && p.kind === "producto") p.on_hand_milli += l.qty_milli;
      }
    }
    s.commercial_state = "anulada";
    s.void_reason = reason.trim();
    s.timeline.push({ at: now(), text: `Anulada: ${reason.trim()} (stock devuelto)` });
    this.log("venta.anular", "venta", s.number);
    return wait(this.detail(s));
  }

  /* ───────────── Compras (prototipo) ───────────── */

  async listPurchaseOrders(): Promise<PurchaseOrderSummary[]> {
    return wait(this.pos.map(({ lines: _l, totals: _t, ...s }) => s).sort((a, b) => b.number.localeCompare(a.number)));
  }
  async purchaseOrder(u: string): Promise<PurchaseOrderDetail> {
    const o = this.pos.find((x) => x.uid === u);
    if (!o) throw new AppError("no_encontrado", "No encontramos esa orden de compra.");
    return wait(o);
  }
  async receivePurchaseOrder(u: string): Promise<PurchaseOrderDetail> {
    const o = this.pos.find((x) => x.uid === u);
    if (!o) throw new AppError("no_encontrado", "No encontramos esa orden de compra.");
    if (o.status === "recibida") throw new AppError("estado", "Esta orden ya fue recibida completa.");
    for (const l of o.lines) {
      const p = this.products.find((x) => x.uid === l.product_uid);
      const qty = l.qty_milli - l.received_milli;
      if (p) {
        // Costo promedio ponderado (vista previa; el cálculo real vive en nucleo-domain::inventory).
        const total = p.on_hand_milli + qty;
        if (total > 0) p.cost_e4 = Math.round((p.cost_e4 * Math.max(0, p.on_hand_milli) + l.unit_cost_minor * 10_000 * qty) / (Math.max(0, p.on_hand_milli) + qty));
        p.on_hand_milli = total;
      }
      l.received_milli = l.qty_milli;
    }
    o.status = "recibida";
    this.log("oc.recibir", "orden_compra", o.number);
    return wait(o);
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
