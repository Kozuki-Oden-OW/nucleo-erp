// Backend del escritorio: comandos Rust (apps/desktop/src-tauri/src/commands.rs).
// Lo que aún no tiene comando responde con un error claro y la interfaz lo marca "próximamente".
import { invoke } from "@tauri-apps/api/core";
import { AppError, type Backend, type Feature } from "./backend";
import type {
  AppInfo, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, Customer, CustomerDetail, Dashboard,
  NewCustomer, NewProduct, Product, PurchaseOrderDetail, PurchaseOrderSummary, QuoteDetail, QuoteSummary, SaleDetail,
  SaleSummary, SearchHit, SessionInfo,
} from "./types";

interface CommandError { code: string; message: string }

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const err = e as Partial<CommandError>;
    throw new AppError(err.code ?? "interno", err.message ?? String(e));
  }
}

function soon(phase: number): never {
  throw new AppError("proximamente", `Esta función llega en la Fase ${phase}. Puedes probarla en la demostración.`);
}

export class TauriBackend implements Backend {
  readonly kind = "tauri" as const;
  readonly features: ReadonlySet<Feature> = new Set<Feature>(["clientes", "respaldos"]);

  async appInfo(): Promise<AppInfo> {
    return { ...(await call<Omit<AppInfo, "mode">>("app_info")), mode: "tauri" };
  }
  createCompany(name: string, profile: BusinessProfile) { return call<CreatedCompany>("create_company", { name, profile }); }
  openCompany(uid: string) { return call<SessionInfo>("open_company", { uid }); }
  recoverKey(uid: string, recovery: string) { return call<void>("recover_key", { uid, recovery }); }
  verifyAudit() { return call<ChainReport>("verify_audit"); }
  createBackup(password: string) { return call<BackupDone>("create_backup", { password }); }
  restoreBackup(path: string, password: string) { return call<{ name: string }>("restore_backup", { path, password }); }
  searchCustomers(query: string) { return call<Customer[]>("search_customers", { query }); }
  addCustomer(input: NewCustomer) { return call<Customer>("add_customer", { input }); }

  async business(): Promise<BusinessSettings> { return soon(4); }
  async updateBusiness(): Promise<BusinessSettings> { return soon(4); }
  async globalSearch(query: string): Promise<SearchHit[]> {
    const rows = await this.searchCustomers(query);
    return rows.slice(0, 20).map((c) => ({ kind: "cliente" as const, uid: c.uid, title: c.name, subtitle: c.rut ? `RUT ${c.rut}` : "Cliente" }));
  }
  async ruleValue(): Promise<{ value: number; source: string } | null> { return null; }
  async dashboard(): Promise<Dashboard> { return soon(12); }
  async customer(): Promise<CustomerDetail> { return soon(5); }
  async searchProducts(): Promise<Product[]> { return soon(5); }
  async addProduct(_input: NewProduct): Promise<Product> { return soon(5); }
  async listQuotes(): Promise<QuoteSummary[]> { return soon(5); }
  async quote(): Promise<QuoteDetail> { return soon(5); }
  async saveQuote(): Promise<QuoteDetail> { return soon(5); }
  async setQuoteStatus(): Promise<QuoteDetail> { return soon(5); }
  async convertQuote(): Promise<SaleDetail> { return soon(5); }
  async listSales(): Promise<SaleSummary[]> { return soon(5); }
  async sale(): Promise<SaleDetail> { return soon(5); }
  async saveSale(): Promise<SaleDetail> { return soon(5); }
  async effectSale(): Promise<SaleDetail> { return soon(5); }
  async registerPayment(): Promise<SaleDetail> { return soon(5); }
  async markDocumented(): Promise<SaleDetail> { return soon(5); }
  async setDocumentationNotApplicable(): Promise<SaleDetail> { return soon(5); }
  async voidSale(): Promise<SaleDetail> { return soon(5); }
  async listPurchaseOrders(): Promise<PurchaseOrderSummary[]> { return soon(6); }
  async purchaseOrder(): Promise<PurchaseOrderDetail> { return soon(6); }
  async receivePurchaseOrder(): Promise<PurchaseOrderDetail> { return soon(6); }
}
