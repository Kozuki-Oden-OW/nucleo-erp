// Puerto único de datos de la interfaz. Lo implementan:
//  - TauriBackend: comandos Rust del escritorio (datos reales, cifrados, en el computador).
//  - DemoBackend: datos de demostración en memoria (navegador, prototipos y pruebas de usabilidad).
// Las pantallas solo conocen esta interfaz; así un prototipo de la Fase 3 se convierte en pantalla
// real cuando el comando Rust correspondiente existe.
import type {
  ImportCostInput, ImportDetail, ImportInput, ImportReceiveLine, ImportStage, ImportSummary, IncotermDef,
  AccountInput, CalendarItem, ExpenseCategory, ExpenseDetail, ExpenseFilter, ExpenseInput, ExpenseSummary, LedgerRow, MoneyAccount,
  MoneyOverview, MoneyTransferInput, Recurring, RecurringInput,
  AdjustmentInput, InventoryOverview, InventorySettings, ProductInventory, ReorderInput, StockDocDone, StockDocRow, TransferInput, Warehouse,
  AppInfo, AttachmentRow, AuditRow, BackupDone, BusinessProfile, BusinessSettings, ChainReport, CreatedCompany, CurrencyRow,
  Customer, CustomerDetail, Dashboard, EffectInput, EntityRef, ExternalRefInput, NewCustomer, NewProduct, NewUser,
  PermissionRow, PriceHistoryRow, Product, ProductPatch, PurchaseDetail, PurchaseInput, PurchaseOrderDetail, PurchaseOrderInput,
  PurchaseOrderSummary, PurchaseSummary, ReceiveLine, NewSupplier, Supplier, SupplierDetail, QuoteDetail, QuoteInput, QuoteSummary, RateRow, RoleRow,
  SaleDetail, SaleInput, SaleSummary, SearchHit, SecuritySettings, SequenceRow, SessionInfo, UserPatch, UserRow,
} from "./types";

/** Archivo elegido para adjuntar: ruta en el escritorio o archivo del navegador en la demostración. */
export type FileSource = { path: string } | { file: File };

export interface PurchaseFilter {
  query?: string;
  view?: "todas" | "por_pagar" | "anuladas";
}

export interface SaleFilter {
  query?: string;
  view?: "todas" | "por_cobrar" | "pendientes_doc" | "borradores" | "anuladas";
}

/** Módulos que el backend ya implementa. La interfaz oculta o marca "próximamente" lo que falte. */
export type Feature =
  | "dashboard" | "clientes" | "productos" | "ventas" | "compras" | "comex" | "negocio" | "respaldos" | "busqueda"
  | "usuarios" | "documentos" | "numeracion" | "monedas" | "auditoria" | "inventario" | "dinero";

export interface Backend {
  readonly kind: "tauri" | "demo";
  readonly features: ReadonlySet<Feature>;

  // Núcleo
  appInfo(): Promise<AppInfo>;
  createCompany(name: string, profile: BusinessProfile): Promise<CreatedCompany>;
  openCompany(uid: string): Promise<SessionInfo>;
  recoverKey(uid: string, recovery: string): Promise<void>;
  sessionInfo(): Promise<SessionInfo>;
  login(username: string, password: string): Promise<SessionInfo>;
  logout(): Promise<SessionInfo>;
  business(): Promise<BusinessSettings>;
  /** Campos de texto: cadena vacía = borrar el dato. */
  updateBusiness(patch: Partial<BusinessSettings>): Promise<BusinessSettings>;
  globalSearch(query: string): Promise<SearchHit[]>;
  /** Valor normativo vigente (paquete cargado), o null si no hay uno con fuente. */
  ruleValue(code: string): Promise<{ value: number; source: string } | null>;
  verifyAudit(): Promise<ChainReport>;
  auditLog(query: string, beforeId?: number): Promise<AuditRow[]>;
  security(): Promise<SecuritySettings>;
  updateSecurity(s: SecuritySettings): Promise<SecuritySettings>;

  // Usuarios y roles
  listUsers(): Promise<UserRow[]>;
  roles(): Promise<{ roles: RoleRow[]; permissions: PermissionRow[] }>;
  createUser(input: NewUser): Promise<UserRow>;
  updateUser(uid: string, patch: UserPatch): Promise<UserRow>;
  setPassword(uid: string, password: string | null): Promise<void>;
  updateRolePermissions(role: string, permissions: string[]): Promise<RoleRow>;

  // Numeración y monedas
  sequences(): Promise<SequenceRow[]>;
  updateSequence(docType: string, prefix: string, nextNumber: number, width: number): Promise<SequenceRow>;
  currencies(): Promise<CurrencyRow[]>;
  rates(currency: string): Promise<RateRow[]>;
  setRate(currency: string, date: string, rateE6: number, note?: string): Promise<void>;

  // Documentos adjuntos (cifrados en el computador)
  addAttachment(source: FileSource, description: string | null, link: EntityRef | null): Promise<AttachmentRow>;
  listAttachments(query: string, link: EntityRef | null): Promise<AttachmentRow[]>;
  /** Guarda una copia descifrada donde la persona elija. Devuelve false si canceló. */
  exportAttachment(row: AttachmentRow): Promise<boolean>;
  attachmentPreview(uid: string): Promise<string | null>;
  archiveAttachment(uid: string, reason: string): Promise<void>;
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
  updateProduct(uid: string, patch: ProductPatch): Promise<Product>;
  updateCustomer(uid: string, input: NewCustomer): Promise<Customer>;

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
  registerPayment(uid: string, amount_minor: number, method: string, date: string, accountUid?: string): Promise<SaleDetail>;
  markDocumented(uid: string, ref: ExternalRefInput): Promise<SaleDetail>;
  setDocumentationNotApplicable(uid: string): Promise<SaleDetail>;
  voidSale(uid: string, reason: string): Promise<SaleDetail>;

  // Proveedores y compras
  searchSuppliers(query: string): Promise<Supplier[]>;
  supplier(uid: string): Promise<SupplierDetail>;
  addSupplier(input: NewSupplier): Promise<Supplier>;
  updateSupplier(uid: string, input: NewSupplier): Promise<Supplier>;
  priceHistory(productUid: string): Promise<PriceHistoryRow[]>;
  listPurchaseOrders(query?: string): Promise<PurchaseOrderSummary[]>;
  purchaseOrder(uid: string): Promise<PurchaseOrderDetail>;
  savePurchaseOrder(input: PurchaseOrderInput, uid?: string): Promise<PurchaseOrderDetail>;
  issuePurchaseOrder(uid: string): Promise<PurchaseOrderDetail>;
  voidPurchaseOrder(uid: string, reason: string): Promise<PurchaseOrderDetail>;
  /** `lines` vacío = recibir todo lo pendiente. */
  receivePurchaseOrder(uid: string, lines: ReceiveLine[], date: string): Promise<PurchaseOrderDetail>;
  listPurchases(filter: PurchaseFilter): Promise<PurchaseSummary[]>;
  purchase(uid: string): Promise<PurchaseDetail>;
  registerPurchase(input: PurchaseInput): Promise<PurchaseDetail>;
  payPurchase(uid: string, amount_minor: number, method: string, date: string, accountUid?: string): Promise<PurchaseDetail>;
  voidPurchase(uid: string, reason: string): Promise<PurchaseDetail>;

  // Inventario
  inventorySettings(): Promise<InventorySettings>;
  updateInventorySettings(s: InventorySettings): Promise<InventorySettings>;
  warehouses(): Promise<Warehouse[]>;
  createWarehouse(name: string): Promise<Warehouse[]>;
  renameWarehouse(uid: string, name: string): Promise<Warehouse[]>;
  setDefaultWarehouse(uid: string): Promise<Warehouse[]>;
  archiveWarehouse(uid: string): Promise<Warehouse[]>;
  adjustStock(input: AdjustmentInput): Promise<StockDocDone>;
  transferStock(input: TransferInput): Promise<StockDocDone>;
  stockDocuments(): Promise<StockDocRow[]>;
  inventoryOverview(): Promise<InventoryOverview>;
  productInventory(uid: string, warehouseUid?: string): Promise<ProductInventory>;
  updateReorderSettings(uid: string, input: ReorderInput): Promise<ProductInventory>;

  // Dinero
  moneyAccounts(): Promise<MoneyAccount[]>;
  createMoneyAccount(input: AccountInput): Promise<MoneyAccount[]>;
  updateMoneyAccount(uid: string, input: AccountInput): Promise<MoneyAccount[]>;
  archiveMoneyAccount(uid: string): Promise<MoneyAccount[]>;
  accountLedger(uid: string): Promise<LedgerRow[]>;
  transferMoney(input: MoneyTransferInput): Promise<MoneyAccount[]>;
  expenseCategories(): Promise<ExpenseCategory[]>;
  addExpenseCategory(name: string, fixed: boolean): Promise<ExpenseCategory[]>;
  listExpenses(filter: ExpenseFilter): Promise<ExpenseSummary[]>;
  expense(uid: string): Promise<ExpenseDetail>;
  registerExpense(input: ExpenseInput): Promise<ExpenseDetail>;
  payExpense(uid: string, amount_minor: number, method: string, date: string, accountUid?: string): Promise<ExpenseDetail>;
  voidExpense(uid: string, reason: string): Promise<ExpenseDetail>;
  recurring(): Promise<Recurring[]>;
  saveRecurring(input: RecurringInput): Promise<Recurring[]>;
  moneyOverview(): Promise<MoneyOverview>;
  moneyCalendar(days: number): Promise<CalendarItem[]>;

  // COMEX: carpetas de importación
  incoterms(): Promise<IncotermDef[]>;
  listImports(view: ImportView, query: string): Promise<ImportSummary[]>;
  import(uid: string): Promise<ImportDetail>;
  saveImport(input: ImportInput, uid?: string): Promise<ImportDetail>;
  setImportStage(uid: string, stage: ImportStage, note?: string): Promise<ImportDetail>;
  changeImportEta(uid: string, eta: string, reason?: string): Promise<ImportDetail>;
  addImportCost(uid: string, input: ImportCostInput): Promise<ImportDetail>;
  updateImportCost(uid: string, costId: number, input: ImportCostInput): Promise<ImportDetail>;
  removeImportCost(uid: string, costId: number, reason?: string): Promise<ImportDetail>;
  payImportCost(uid: string, costId: number, amount_minor: number, method: string, date: string, accountUid?: string): Promise<ImportDetail>;
  /** `lines` vacío = recibir todo lo pendiente. */
  receiveImport(uid: string, lines: ImportReceiveLine[], date: string): Promise<ImportDetail>;
  closeImport(uid: string): Promise<ImportDetail>;
  voidImport(uid: string, reason: string): Promise<ImportDetail>;
}

export type ImportView = "en_curso" | "cotizaciones" | "cerradas" | "anuladas" | "todas";

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
