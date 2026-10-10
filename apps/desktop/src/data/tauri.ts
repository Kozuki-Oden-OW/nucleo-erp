// Backend del escritorio: comandos Rust (apps/desktop/src-tauri/src/commands.rs).
// Lo que aún no tiene comando responde con un error claro y la interfaz lo marca "próximamente".
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AppError, type Backend, type Feature, type FileSource, type ImportView, type PurchaseFilter, type SaleFilter } from "./backend";
import type {
  F29Inputs, F29View, RcvImportReport, TaxDocInput, TaxProfile,
  ImportCostInput, ImportDetail, ImportInput, ImportReceiveLine, ImportStage, ImportSummary, IncotermDef,
  AccountInput, CalendarItem, ExpenseCategory, ExpenseDetail, ExpenseFilter, ExpenseInput, ExpenseSummary, LedgerRow, MoneyAccount,
  MoneyOverview, MoneyTransferInput, Recurring, RecurringInput,
  AdjustmentInput, InventoryOverview, InventorySettings, ProductInventory, ReorderInput, StockDocDone, StockDocRow, TransferInput, Warehouse,
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, EffectInput, EntityRef, ExternalRefInput, NewCustomer, NewProduct, NewUser, PermissionRow,
  PriceHistoryRow, Product, ProductPatch, PurchaseDetail, PurchaseInput, PurchaseOrderDetail, PurchaseOrderInput, PurchaseOrderSummary,
  PurchaseSummary, ReceiveLine, NewSupplier, Supplier, SupplierDetail, QuoteDetail, QuoteInput, QuoteSummary, RateRow, RoleRow, SaleDetail, SaleInput,
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
    "productos", "ventas", "compras", "inventario", "dinero", "dashboard", "comex", "impuestos",
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
  dashboard() { return call<Dashboard>("dashboard"); }
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
  registerPayment(uid: string, amount_minor: number, method: string, date: string, accountUid?: string) {
    return call<SaleDetail>("register_payment", { uid, amountMinor: amount_minor, method, date, accountUid: accountUid ?? null });
  }
  markDocumented(uid: string, ref: ExternalRefInput) { return call<SaleDetail>("mark_documented", { uid, reference: ref }); }
  setDocumentationNotApplicable(uid: string) { return call<SaleDetail>("set_documentation_not_applicable", { uid }); }
  voidSale(uid: string, reason: string) { return call<SaleDetail>("void_sale", { uid, reason }); }
  searchSuppliers(query: string) { return call<Supplier[]>("search_suppliers", { query }); }
  supplier(uid: string) { return call<SupplierDetail>("supplier", { uid }); }
  addSupplier(input: NewSupplier) { return call<Supplier>("add_supplier", { input }); }
  updateSupplier(uid: string, input: NewSupplier) { return call<Supplier>("update_supplier", { uid, input }); }
  priceHistory(productUid: string) { return call<PriceHistoryRow[]>("price_history", { productUid }); }
  listPurchaseOrders(query?: string) { return call<PurchaseOrderSummary[]>("list_purchase_orders", { query: query ?? null }); }
  purchaseOrder(uid: string) { return call<PurchaseOrderDetail>("purchase_order", { uid }); }
  savePurchaseOrder(input: PurchaseOrderInput, uid?: string) { return call<PurchaseOrderDetail>("save_purchase_order", { input, uid: uid ?? null }); }
  issuePurchaseOrder(uid: string) { return call<PurchaseOrderDetail>("issue_purchase_order", { uid }); }
  voidPurchaseOrder(uid: string, reason: string) { return call<PurchaseOrderDetail>("void_purchase_order", { uid, reason }); }
  receivePurchaseOrder(uid: string, lines: ReceiveLine[], date: string) { return call<PurchaseOrderDetail>("receive_purchase_order", { uid, lines, date }); }
  listPurchases(filter: PurchaseFilter) { return call<PurchaseSummary[]>("list_purchases", { filter: { query: filter.query ?? null, view: filter.view ?? null } }); }
  purchase(uid: string) { return call<PurchaseDetail>("purchase", { uid }); }
  registerPurchase(input: PurchaseInput) { return call<PurchaseDetail>("register_purchase", { input }); }
  payPurchase(uid: string, amount_minor: number, method: string, date: string, accountUid?: string) {
    return call<PurchaseDetail>("pay_purchase", { uid, amountMinor: amount_minor, method, date, accountUid: accountUid ?? null });
  }
  voidPurchase(uid: string, reason: string) { return call<PurchaseDetail>("void_purchase", { uid, reason }); }
  inventorySettings() { return call<InventorySettings>("inventory_settings"); }
  updateInventorySettings(settings: InventorySettings) { return call<InventorySettings>("update_inventory_settings", { settings }); }
  warehouses() { return call<Warehouse[]>("warehouses"); }
  createWarehouse(name: string) { return call<Warehouse[]>("create_warehouse", { name }); }
  renameWarehouse(uid: string, name: string) { return call<Warehouse[]>("rename_warehouse", { uid, name }); }
  setDefaultWarehouse(uid: string) { return call<Warehouse[]>("set_default_warehouse", { uid }); }
  archiveWarehouse(uid: string) { return call<Warehouse[]>("archive_warehouse", { uid }); }
  adjustStock(input: AdjustmentInput) { return call<StockDocDone>("adjust_stock", { input }); }
  transferStock(input: TransferInput) { return call<StockDocDone>("transfer_stock", { input: { ...input, notes: input.notes ?? null } }); }
  stockDocuments() { return call<StockDocRow[]>("stock_documents"); }
  inventoryOverview() { return call<InventoryOverview>("inventory_overview"); }
  productInventory(uid: string, warehouseUid?: string) { return call<ProductInventory>("product_inventory", { uid, warehouseUid: warehouseUid ?? null }); }
  updateReorderSettings(uid: string, input: ReorderInput) { return call<ProductInventory>("update_reorder_settings", { uid, input }); }
  moneyAccounts() { return call<MoneyAccount[]>("money_accounts"); }
  createMoneyAccount(input: AccountInput) { return call<MoneyAccount[]>("create_money_account", { input }); }
  updateMoneyAccount(uid: string, input: AccountInput) { return call<MoneyAccount[]>("update_money_account", { uid, input }); }
  archiveMoneyAccount(uid: string) { return call<MoneyAccount[]>("archive_money_account", { uid }); }
  accountLedger(uid: string) { return call<LedgerRow[]>("account_ledger", { uid }); }
  transferMoney(input: MoneyTransferInput) { return call<MoneyAccount[]>("transfer_money", { input: { ...input, notes: input.notes ?? null } }); }
  expenseCategories() { return call<ExpenseCategory[]>("expense_categories"); }
  addExpenseCategory(name: string, fixed: boolean) { return call<ExpenseCategory[]>("add_expense_category", { name, fixed }); }
  listExpenses(filter: ExpenseFilter) { return call<ExpenseSummary[]>("list_expenses", { filter }); }
  expense(uid: string) { return call<ExpenseDetail>("expense", { uid }); }
  registerExpense(input: ExpenseInput) { return call<ExpenseDetail>("register_expense", { input }); }
  payExpense(uid: string, amount_minor: number, method: string, date: string, accountUid?: string) {
    return call<ExpenseDetail>("pay_expense", { uid, amountMinor: amount_minor, method, date, accountUid: accountUid ?? null });
  }
  voidExpense(uid: string, reason: string) { return call<ExpenseDetail>("void_expense", { uid, reason }); }
  recurring() { return call<Recurring[]>("recurring"); }
  saveRecurring(input: RecurringInput) { return call<Recurring[]>("save_recurring", { input }); }
  moneyOverview() { return call<MoneyOverview>("money_overview"); }
  moneyCalendar(days: number) { return call<CalendarItem[]>("money_calendar", { days }); }

  incoterms() { return call<IncotermDef[]>("incoterms"); }
  listImports(view: ImportView, query: string) { return call<ImportSummary[]>("list_imports", { view, query }); }
  import(uid: string) { return call<ImportDetail>("import", { uid }); }
  saveImport(input: ImportInput, uid?: string) { return call<ImportDetail>("save_import", { input, uid: uid ?? null }); }
  setImportStage(uid: string, stage: ImportStage, note?: string) { return call<ImportDetail>("set_import_stage", { uid, stage, note: note ?? null }); }
  changeImportEta(uid: string, eta: string, reason?: string) { return call<ImportDetail>("change_import_eta", { uid, eta, reason: reason ?? null }); }
  addImportCost(uid: string, input: ImportCostInput) { return call<ImportDetail>("add_import_cost", { uid, input }); }
  updateImportCost(uid: string, costId: number, input: ImportCostInput) { return call<ImportDetail>("update_import_cost", { uid, costId, input }); }
  removeImportCost(uid: string, costId: number, reason?: string) { return call<ImportDetail>("remove_import_cost", { uid, costId, reason: reason ?? null }); }
  payImportCost(uid: string, costId: number, amount_minor: number, method: string, date: string, accountUid?: string) {
    return call<ImportDetail>("pay_import_cost", { uid, costId, amountMinor: amount_minor, method, date, accountUid: accountUid ?? null });
  }
  receiveImport(uid: string, lines: ImportReceiveLine[], date: string) { return call<ImportDetail>("receive_import", { uid, lines, date }); }
  closeImport(uid: string) { return call<ImportDetail>("close_import", { uid }); }
  voidImport(uid: string, reason: string) { return call<ImportDetail>("void_import", { uid, reason }); }

  taxProfile() { return call<TaxProfile>("tax_profile"); }
  saveTaxProfile(profile: TaxProfile) { return call<TaxProfile>("save_tax_profile", { profile }); }
  f29(period: string) { return call<F29View>("f29", { period }); }
  saveF29Inputs(period: string, inputs: F29Inputs) { return call<F29View>("save_f29_inputs", { period, inputs }); }
  importRcv(period: string, direction: "venta" | "compra", fileName: string | null, text: string) {
    return call<RcvImportReport>("import_rcv", { period, direction, fileName, text });
  }
  clearRcv(period: string, direction: "venta" | "compra") { return call<F29View>("clear_rcv", { period, direction }); }
  addTaxDocument(period: string, input: TaxDocInput) { return call<F29View>("add_tax_document", { period, input }); }
  deleteTaxDocument(id: number) { return call<F29View>("delete_tax_document", { id }); }
  setTaxDocumentKind(id: number, kind: string) { return call<F29View>("set_tax_document_kind", { id, kind }); }
  markF29Declared(period: string, declared77: number, declared91: number, folio: string | null) {
    return call<F29View>("mark_f29_declared", { period, declared77, declared91, folio });
  }
  reopenF29(period: string, reason: string) { return call<F29View>("reopen_f29", { period, reason }); }
}

/** Selector de archivo del escritorio para adjuntar documentos. */
export async function pickFileForAttachment(): Promise<FileSource | null> {
  const f = await open({ multiple: false, directory: false, title: "Elegir un documento para adjuntar" });
  return typeof f === "string" ? { path: f } : null;
}
