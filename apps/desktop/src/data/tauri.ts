// Backend del escritorio: comandos Rust (apps/desktop/src-tauri/src/commands.rs).
// Lo que aún no tiene comando responde con un error claro y la interfaz lo marca "próximamente".
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AppError, type Backend, type Feature, type FileSource, type SaleFilter } from "./backend";
import type {
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, EffectInput, EntityRef, ExternalRefInput, NewCustomer, NewProduct, NewUser, PermissionRow,
  Product, ProductPatch, PurchaseOrderDetail, PurchaseOrderSummary, QuoteDetail, QuoteInput, QuoteSummary, RateRow, RoleRow, SaleDetail, SaleInput,
  SaleSummary, SearchHit,
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
    if (k === "tax_rate_user_ppm") { out[k] = v ?? 0; continue; }
    out[k] = v === null ? "" : v;
  }
  return out;
}

export class TauriBackend implements Backend {
  readonly kind = "tauri" as const;
  readonly features: ReadonlySet<Feature> = new Set<Feature>([
    "clientes", "respaldos", "negocio", "busqueda", "usuarios", "documentos", "numeracion", "monedas", "auditoria",
    "productos", "ventas",
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
  customer(uid: string) { return call<CustomerDetail>("customer", { uid }); }
  searchProducts(query: string) { return call<Product[]>("search_products", { query }); }
  addProduct(input: NewProduct) { return call<Product>("add_product", { input }); }
  updateProduct(uid: string, patch: ProductPatch) { return call<Product>("update_product", { uid, patch }); }
  updateCustomer(uid: string, input: NewCustomer) { return call<Customer>("update_customer", { uid, input }); }
  listQuotes(query?: string) { return call<QuoteSummary[]>("list_quotes", { query: query ?? null }); }
  quote(uid: string) { return call<QuoteDetail>("quote", { uid }); }
  saveQuote(input: QuoteInput, uid?: string) { return call<QuoteDetail>("save_quote", { input, uid: uid ?? null }); }
  setQuoteStatus(uid: string, status: "enviada" | "aceptada" | "rechazada" | "anulada") { return call<QuoteDetail>("set_quote_status", { uid, status }); }
  convertQuote(uid: string) { return call<SaleDetail>("convert_quote", { uid }); }
  listSales(filter: SaleFilter) { return call<SaleSummary[]>("list_sales", { filter: { query: filter.query ?? null, view: filter.view ?? null } }); }
  sale(uid: string) { return call<SaleDetail>("sale", { uid }); }
  saveSale(input: SaleInput, uid?: string) { return call<SaleDetail>("save_sale", { input, uid: uid ?? null }); }
  effectSale(uid: string, input: EffectInput) { return call<SaleDetail>("effect_sale", { uid, input }); }
  registerPayment(uid: string, amount_minor: number, method: string, date: string) {
    return call<SaleDetail>("register_payment", { uid, amountMinor: amount_minor, method, date });
  }
  markDocumented(uid: string, ref: ExternalRefInput) { return call<SaleDetail>("mark_documented", { uid, reference: ref }); }
  setDocumentationNotApplicable(uid: string) { return call<SaleDetail>("set_documentation_not_applicable", { uid }); }
  voidSale(uid: string, reason: string) { return call<SaleDetail>("void_sale", { uid, reason }); }
  async listPurchaseOrders(): Promise<PurchaseOrderSummary[]> { return soon(6); }
  async purchaseOrder(): Promise<PurchaseOrderDetail> { return soon(6); }
  async receivePurchaseOrder(): Promise<PurchaseOrderDetail> { return soon(6); }
}

/** Selector de archivo del escritorio para adjuntar documentos. */
export async function pickFileForAttachment(): Promise<FileSource | null> {
  const f = await open({ multiple: false, directory: false, title: "Elegir un documento para adjuntar" });
  return typeof f === "string" ? { path: f } : null;
}
