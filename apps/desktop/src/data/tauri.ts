// Backend del escritorio: comandos Rust (apps/desktop/src-tauri/src/commands.rs).
// Lo que aún no tiene comando responde con un error claro y la interfaz lo marca "próximamente".
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AppError, type Backend, type Feature, type FileSource } from "./backend";
import type {
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, EntityRef, NewCustomer, NewProduct, NewUser, PermissionRow, Product,
  PurchaseOrderDetail, PurchaseOrderSummary, QuoteDetail, QuoteSummary, RateRow, RoleRow, SaleDetail, SaleSummary, SearchHit,
  SecuritySettings, SequenceRow, SessionInfo, UserPatch, UserRow,
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

/** Texto vacío para los campos que se borran (contrato de `BusinessPatch` en Rust). */
function businessPatch(p: Partial<BusinessSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "tax_rate_ppm" || k === "tax_rule_source") continue;
    out[k] = v === null ? "" : v;
  }
  return out;
}

export class TauriBackend implements Backend {
  readonly kind = "tauri" as const;
  readonly features: ReadonlySet<Feature> = new Set<Feature>([
    "clientes", "respaldos", "negocio", "busqueda", "usuarios", "documentos", "numeracion", "monedas", "auditoria",
  ]);

  async appInfo(): Promise<AppInfo> {
    return { ...(await call<Omit<AppInfo, "mode">>("app_info")), mode: "tauri" };
  }
  createCompany(name: string, profile: BusinessProfile) { return call<CreatedCompany>("create_company", { name, profile }); }
  openCompany(uid: string) { return call<SessionInfo>("open_company", { uid }); }
  sessionInfo() { return call<SessionInfo>("session_info"); }
  login(username: string, password: string) { return call<SessionInfo>("login", { username, password }); }
  logout() { return call<SessionInfo>("logout"); }
  recoverKey(uid: string, recovery: string) { return call<void>("recover_key", { uid, recovery }); }
  verifyAudit() { return call<ChainReport>("verify_audit"); }
  auditLog(query: string, beforeId?: number) { return call<AuditRow[]>("audit_log", { query, beforeId: beforeId ?? null }); }
  createBackup(password: string) { return call<BackupDone>("create_backup", { password }); }
  restoreBackup(path: string, password: string) { return call<{ name: string }>("restore_backup", { path, password }); }
  searchCustomers(query: string) { return call<Customer[]>("search_customers", { query }); }
  addCustomer(input: NewCustomer) { return call<Customer>("add_customer", { input }); }
  business() { return call<BusinessSettings>("business"); }
  updateBusiness(patch: Partial<BusinessSettings>) { return call<BusinessSettings>("update_business", { patch: businessPatch(patch) }); }
  security() { return call<SecuritySettings>("security"); }
  updateSecurity(settings: SecuritySettings) { return call<SecuritySettings>("update_security", { settings }); }
  globalSearch(query: string) { return call<SearchHit[]>("global_search", { query }); }

  listUsers() { return call<UserRow[]>("list_users"); }
  roles() { return call<{ roles: RoleRow[]; permissions: PermissionRow[] }>("roles"); }
  createUser(input: NewUser) { return call<UserRow>("create_user", { input: { ...input, password: input.password || null } }); }
  updateUser(uid: string, patch: UserPatch) { return call<UserRow>("update_user", { uid, patch }); }
  setPassword(uid: string, password: string | null) { return call<void>("set_password", { uid, password }); }
  updateRolePermissions(role: string, permissions: string[]) { return call<RoleRow>("update_role_permissions", { role, permissions }); }

  sequences() { return call<SequenceRow[]>("sequences"); }
  updateSequence(docType: string, prefix: string, nextNumber: number, width: number) {
    return call<SequenceRow>("update_sequence", { docType, prefix, nextNumber, width });
  }
  currencies() { return call<CurrencyRow[]>("currencies"); }
  rates(currency: string) { return call<RateRow[]>("rates", { currency }); }
  setRate(currency: string, date: string, rateE6: number, note?: string) { return call<void>("set_rate", { currency, date, rateE6, note: note ?? null }); }

  async addAttachment(source: FileSource, description: string | null, link: EntityRef | null): Promise<AttachmentRow> {
    if (!("path" in source)) throw new AppError("archivo", "Elige el archivo con el botón “Adjuntar”.");
    return call<AttachmentRow>("add_attachment", { path: source.path, description, link });
  }
  listAttachments(query: string, link: EntityRef | null) { return call<AttachmentRow[]>("list_attachments", { query, link }); }
  async exportAttachment(row: AttachmentRow): Promise<boolean> {
    const path = await save({ defaultPath: row.file_name, title: "Guardar una copia del documento" });
    if (!path) return false;
    await call<void>("export_attachment", { uid: row.uid, path });
    return true;
  }
  attachmentPreview(uid: string) { return call<string | null>("attachment_preview", { uid }); }
  archiveAttachment(uid: string, reason: string) { return call<void>("archive_attachment", { uid, reason }); }

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

/** Selector de archivo del escritorio para adjuntar documentos. */
export async function pickFileForAttachment(): Promise<FileSource | null> {
  const f = await open({ multiple: false, directory: false, title: "Elegir un documento para adjuntar" });
  return typeof f === "string" ? { path: f } : null;
}
