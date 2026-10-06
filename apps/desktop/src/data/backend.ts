// Puerto único de datos de la interfaz. Lo implementan:
//  - TauriBackend: comandos Rust del escritorio (datos reales, cifrados, en el computador).
//  - DemoBackend: datos de demostración en memoria (navegador, prototipos y pruebas de usabilidad).
// Las pantallas solo conocen esta interfaz; así un prototipo de la Fase 3 se convierte en pantalla
// real cuando el comando Rust correspondiente existe.
import type {
  AppInfo, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, Customer, CustomerDetail,
  Dashboard, EffectInput, ExternalRefInput, NewCustomer, NewProduct, Product, PurchaseOrderDetail,
  PurchaseOrderSummary, QuoteDetail, QuoteInput, QuoteSummary, SaleDetail, SaleInput, SaleSummary, SearchHit, SessionInfo,
} from "./types";

export interface SaleFilter {
  query?: string;
  view?: "todas" | "por_cobrar" | "pendientes_doc" | "borradores" | "anuladas";
}

/** Módulos que el backend ya implementa. La interfaz oculta o marca "próximamente" lo que falte. */
export type Feature = "dashboard" | "clientes" | "productos" | "ventas" | "compras" | "comex" | "negocio" | "respaldos" | "busqueda";

export interface Backend {
  readonly kind: "tauri" | "demo";
  readonly features: ReadonlySet<Feature>;

  // Núcleo
  appInfo(): Promise<AppInfo>;
  createCompany(name: string, profile: BusinessProfile): Promise<CreatedCompany>;
  openCompany(uid: string): Promise<SessionInfo>;
  recoverKey(uid: string, recovery: string): Promise<void>;
  business(): Promise<BusinessSettings>;
  updateBusiness(patch: Partial<BusinessSettings>): Promise<BusinessSettings>;
  globalSearch(query: string): Promise<SearchHit[]>;
  /** Valor normativo vigente (paquete cargado), o null si no hay uno con fuente. */
  ruleValue(code: string): Promise<{ value: number; source: string } | null>;
  verifyAudit(): Promise<ChainReport>;
  createBackup(password: string): Promise<BackupDone>;
  restoreBackup(path: string, password: string): Promise<{ name: string }>;

  // Inicio
  dashboard(): Promise<Dashboard>;

  // Clientes y productos
  searchCustomers(query: string): Promise<Customer[]>;
  customer(uid: string): Promise<CustomerDetail>;
  addCustomer(input: NewCustomer): Promise<Customer>;
  searchProducts(query: string): Promise<Product[]>;
  addProduct(input: NewProduct): Promise<Product>;

  // Ventas
  listQuotes(query?: string): Promise<QuoteSummary[]>;
  quote(uid: string): Promise<QuoteDetail>;
  saveQuote(input: QuoteInput, uid?: string): Promise<QuoteDetail>;
  setQuoteStatus(uid: string, status: "enviada" | "aceptada" | "rechazada" | "anulada"): Promise<QuoteDetail>;
  convertQuote(uid: string): Promise<SaleDetail>;
  listSales(filter: SaleFilter): Promise<SaleSummary[]>;
  sale(uid: string): Promise<SaleDetail>;
  saveSale(input: SaleInput, uid?: string): Promise<SaleDetail>;
  effectSale(uid: string, input: EffectInput): Promise<SaleDetail>;
  registerPayment(uid: string, amount_minor: number, method: string, date: string): Promise<SaleDetail>;
  markDocumented(uid: string, ref: ExternalRefInput): Promise<SaleDetail>;
  setDocumentationNotApplicable(uid: string): Promise<SaleDetail>;
  voidSale(uid: string, reason: string): Promise<SaleDetail>;

  // Compras (prototipo)
  listPurchaseOrders(): Promise<PurchaseOrderSummary[]>;
  purchaseOrder(uid: string): Promise<PurchaseOrderDetail>;
  receivePurchaseOrder(uid: string): Promise<PurchaseOrderDetail>;
}

/** Error con mensaje en lenguaje claro, listo para mostrar. */
export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
