// Contratos de datos entre la interfaz y el backend (Rust vía Tauri, o el backend de demostración).
// Montos en unidad mínima (*_minor), cantidades en milésimas (qty_milli), proporciones en ppm.

export type BusinessProfile = "emprendedor" | "negocio" | "empresa";
export type ViewMode = "simple" | "contador";

export interface CompanyInfo {
  uid: string;
  name: string;
  profile: BusinessProfile;
  created_at: string;
}
export interface CreatedCompany {
  company: CompanyInfo;
  recovery_key: string;
}
export interface AppInfo {
  version: string;
  data_dir: string;
  backups_dir: string;
  companies: CompanyInfo[];
  /** "demo" = datos de demostración en memoria (navegador o prueba de usabilidad). */
  mode: "tauri" | "demo";
}
export interface ChainReport {
  entries: number;
  ok: boolean;
  broken_at: number | null;
}
export interface CurrentUser {
  uid: string;
  username: string;
  display_name: string;
  roles: string[];
  permissions: string[];
}
export interface SessionInfo {
  company: CompanyInfo;
  cipher_version: string;
  customers: number;
  audit: ChainReport;
  /** Hay usuarios con contraseña y falta iniciar sesión. */
  login_required: boolean;
  user: CurrentUser | null;
  /** [usuario, nombre visible] de quienes pueden iniciar sesión. */
  login_users: [string, string][];
  /** Minutos sin actividad antes de bloquear (0 = nunca). */
  lock_minutes: number;
}

/* ───── Usuarios y permisos ───── */

export interface UserRow {
  id: number;
  uid: string;
  username: string;
  display_name: string;
  has_password: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  roles: string[];
}
export interface RoleRow { code: string; name: string; is_system: boolean; permissions: string[] }
export interface PermissionRow { code: string; description: string }
export interface NewUser { username: string; display_name: string; roles: string[]; password?: string }
export interface UserPatch { display_name: string; is_active: boolean; roles: string[] }
export interface SecuritySettings { lock_minutes: number }

/* ───── Numeración y monedas ───── */

export interface SequenceRow { doc_type: string; name: string; prefix: string; next_number: number; width: number; last_used: number }
export interface CurrencyRow { code: string; name: string; decimals: number; symbol: string; last_rate_e6: number | null; last_rate_date: string | null }
export interface RateRow { currency_code: string; rate_date: string; rate_e6: number; note: string | null; created_at: string }

/* ───── Documentos y auditoría ───── */

export interface AttachmentRow {
  id: number;
  uid: string;
  sha256: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  created_by: string | null;
  created_at: string;
  links: string[];
}
export interface EntityRef { entity: "cliente" | "proveedor" | "producto" | "cotizacion" | "venta" | "orden_compra" | "compra" | "gasto" | "importacion"; uid: string }
export interface AuditRow {
  id: number;
  ts_utc: string;
  user_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
}

/* ───── Negocio ───── */

export interface BusinessSettings {
  name: string;
  profile: BusinessProfile;
  /** Datos tributarios opcionales (solo para imprimir en documentos internos). */
  rut: string | null;
  legal_name: string | null;
  activity: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Si las ventas nacen "pendientes de documentación tributaria". */
  documentation_reminder: boolean;
  /** Si los documentos calculan IVA (informativo). Emprendedor sin iniciación: false. */
  tax_enabled: boolean;
  /** Tasa informativa vigente según el paquete normativo cargado (ppm) y su origen. */
  tax_rate_ppm: number | null;
  tax_rule_source: string | null;
  /** Tasa anotada por el usuario (se usa si no hay paquete normativo). */
  tax_rate_user_ppm: number | null;
  /** Logo del negocio (imagen data: PNG, JPG o WebP) para la interfaz y los documentos. */
  logo: string | null;
}

/* ───── Maestros ───── */

export interface Customer {
  id: number;
  uid: string;
  rut: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}
export interface NewCustomer {
  name: string;
  rut?: string;
  email?: string;
  phone?: string;
}
export interface CustomerDetail extends Customer {
  sales_count: number;
  revenue_minor: number;
  receivable_minor: number;
  last_sale_date: string | null;
  avg_days_between: number | null;
  recent: SaleSummary[];
}

export interface Product {
  uid: string;
  sku: string;
  name: string;
  unit: string;
  kind: "producto" | "servicio";
  price_minor: number;
  cost_e4: number;
  on_hand_milli: number;
  min_milli: number;
  taxable: boolean;
}
export interface NewProduct {
  sku?: string;
  name: string;
  unit?: string;
  kind: "producto" | "servicio";
  price_minor: number;
  cost_minor?: number;
  taxable?: boolean;
  /** Stock con que parte (milésimas). Solo productos. */
  initial_stock_milli?: number;
}

export interface ProductPatch {
  name: string;
  sku: string;
  unit: string;
  price_minor: number;
  taxable: boolean;
  min_milli: number;
}

/* ───── Ventas ───── */

export type QuoteStatus = "borrador" | "enviada" | "aceptada" | "rechazada" | "vencida" | "convertida" | "anulada";
export type CommercialState = "borrador" | "cotizada" | "aceptada" | "efectuada" | "cerrada" | "anulada";
export type PaymentState = "sin_pago" | "abonada" | "pagada";
export type DocumentationState = "no_aplica" | "pendiente" | "documentada";
export type SaleDocType = "VEN" | "FV";

export interface LineInput {
  product_uid: string | null;
  description: string;
  qty_milli: number;
  unit_price_minor: number;
  discount_ppm: number;
  taxable: boolean;
}
export interface Line extends LineInput {
  line_no: number;
  net_minor: number;
  discount_minor: number;
  unit_cost_e4: number | null;
}
export interface Totals {
  net_minor: number;
  exempt_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
}

export interface DocLink {
  number: string;
  kind: "COT" | "VEN" | "FV" | "PAG" | "REF" | "COM" | "OC";
  uid: string | null;
  label: string;
}

export interface QuoteSummary {
  uid: string;
  number: string;
  customer_name: string;
  issue_date: string;
  valid_until: string | null;
  status: QuoteStatus;
  total_minor: number;
}
export interface QuoteDetail extends QuoteSummary {
  customer_uid: string | null;
  lines: Line[];
  totals: Totals;
  notes: string | null;
  sale_uid: string | null;
  sale_number: string | null;
}
export interface QuoteInput {
  customer_uid: string | null;
  prospect_name?: string;
  issue_date: string;
  valid_until: string | null;
  lines: LineInput[];
  notes?: string;
}

export interface SaleSummary {
  uid: string;
  doc_type: SaleDocType;
  number: string;
  customer_name: string;
  issue_date: string;
  due_date: string | null;
  commercial_state: CommercialState;
  payment_state: PaymentState;
  documentation_state: DocumentationState;
  total_minor: number;
  paid_minor: number;
}
export interface Payment {
  number: string;
  date: string;
  amount_minor: number;
  method: string;
}
export interface ExternalRef {
  doc_kind: string | null;
  external_number: string | null;
  issue_date: string | null;
  observation: string | null;
  marked_at: string;
}
export interface SaleDetail extends SaleSummary {
  customer_uid: string | null;
  lines: Line[];
  totals: Totals;
  cost_minor: number;
  payment_method: string | null;
  notes: string | null;
  quote_uid: string | null;
  quote_number: string | null;
  payments: Payment[];
  external_ref: ExternalRef | null;
  void_reason: string | null;
  chain: DocLink[];
  timeline: { at: string; text: string }[];
}
export interface SaleInput {
  doc_type: SaleDocType;
  customer_uid: string | null;
  issue_date: string;
  lines: LineInput[];
  notes?: string;
}
export interface EffectInput {
  mode: "contado" | "credito";
  method: string;
  due_date: string | null;
  /** Cuenta donde entra el dinero; vacío = según el medio (efectivo → caja, otros → banco). */
  account_uid?: string | null;
}
export interface ExternalRefInput {
  doc_kind?: string;
  external_number?: string;
  issue_date?: string;
  observation?: string;
}

/* ───── Compras ───── */

export interface Supplier {
  id: number;
  uid: string;
  rut: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  /** Días de plazo de pago habituales (0 = contado). */
  payment_terms_days: number;
  created_at: string;
}
export interface NewSupplier { name: string; rut?: string; email?: string; phone?: string; payment_terms_days?: number }
export interface SupplierDetail extends Supplier {
  purchases_count: number;
  purchased_minor: number;
  payable_minor: number;
  last_purchase_date: string | null;
  orders: PurchaseOrderSummary[];
  purchases: PurchaseSummary[];
}

export type PoStatus = "borrador" | "emitida" | "parcial" | "recibida" | "anulada";
export interface BuyLineInput {
  product_uid: string | null;
  description: string;
  qty_milli: number;
  unit_cost_minor: number;
  taxable: boolean;
}
export interface PurchaseOrderSummary {
  uid: string;
  number: string;
  supplier_name: string;
  issue_date: string;
  expected_date: string | null;
  status: PoStatus;
  total_minor: number;
}
export interface PoLine extends BuyLineInput { line_no: number; received_milli: number; net_minor: number }
export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  supplier_uid: string;
  lines: PoLine[];
  totals: Totals;
  notes: string | null;
  void_reason: string | null;
  receipts: { number: string; date: string }[];
  purchases: DocLink[];
  timeline: { at: string; text: string }[];
}
export interface PurchaseOrderInput {
  supplier_uid: string;
  issue_date: string;
  expected_date: string | null;
  lines: BuyLineInput[];
  notes?: string;
}
export interface ReceiveLine { line_no: number; qty_milli: number }

export interface PurchaseSummary {
  uid: string;
  number: string;
  supplier_name: string;
  doc_kind: string | null;
  doc_number: string | null;
  issue_date: string;
  due_date: string | null;
  status: "registrada" | "anulada";
  payment_state: PaymentState;
  total_minor: number;
  paid_minor: number;
}
export interface PurchaseLine extends BuyLineInput { line_no: number; net_minor: number }
export interface PurchaseDetail extends PurchaseSummary {
  supplier_uid: string;
  lines: PurchaseLine[];
  totals: Totals;
  order_uid: string | null;
  order_number: string | null;
  payments: Payment[];
  received_stock: boolean;
  notes: string | null;
  void_reason: string | null;
  timeline: { at: string; text: string }[];
}
export interface PurchaseInput {
  supplier_uid: string;
  doc_kind?: string;
  doc_number?: string;
  issue_date: string;
  due_date: string | null;
  order_uid: string | null;
  receive_stock: boolean;
  lines: BuyLineInput[];
  notes?: string;
  paid_method: string | null;
  paid_account_uid?: string | null;
}
export interface PriceHistoryRow { supplier_uid: string; supplier_name: string; date: string; document: string; unit_price_minor: number; qty_milli: number }

/* ───── Inventario ───── */

export interface InventorySettings { allow_negative: boolean }
export interface Warehouse {
  uid: string;
  code: string;
  name: string;
  is_default: boolean;
  archived: boolean;
  stock_value_minor: number;
  products_with_stock: number;
}
export type StockStatus = "sin_stock" | "riesgo_quiebre" | "bajo_minimo" | "exceso" | "sin_movimiento" | "ok";
export interface StockAnalysis {
  uid: string;
  sku: string;
  name: string;
  unit: string;
  on_hand_milli: number;
  reserved_milli: number;
  in_purchase_milli: number;
  future_milli: number;
  min_milli: number;
  avg_cost_e4: number;
  stock_value_minor: number;
  sold_milli: number;
  days_with_stock: number;
  velocity_milli: number | null;
  coverage_days: number | null;
  next_arrival: string | null;
  last_movement: string | null;
  status: StockStatus;
  advice: { kind: "comprar" | "no_comprar" | "exceso" | "sin_datos"; quantity_milli: number | null; explanation: string };
}
export interface InventoryOverview { window_days: number; total_value_minor: number; rows: StockAnalysis[] }
export interface StockByWarehouse { warehouse_uid: string; warehouse_name: string; on_hand_milli: number; avg_cost_e4: number }
export interface KardexRow {
  id: number;
  date: string;
  warehouse_name: string;
  kind: "entrada" | "salida" | "ajuste" | "transferencia_entrada" | "transferencia_salida" | "inicial";
  document: string;
  source_type: string;
  source_uid: string | null;
  qty_milli: number;
  unit_cost_e4: number;
  avg_cost_after_e4: number;
  balance_milli: number;
  reason: string | null;
}
export interface ReorderSettings { safety_days: number; target_coverage_days: number; excess_coverage_days: number; lead_time_days: number | null }
export interface ProductInventory { product: Product; by_warehouse: StockByWarehouse[]; kardex: KardexRow[]; analysis: StockAnalysis | null; settings: ReorderSettings }
export interface StockLineInput { product_uid: string; qty_milli: number }
export interface AdjustmentInput { warehouse_uid: string; date: string; kind: "ajuste" | "conteo"; reason: string; lines: StockLineInput[] }
export interface TransferInput { from_uid: string; to_uid: string; date: string; notes?: string; lines: StockLineInput[] }
export interface StockDocDone { number: string; moved_lines: number }
export interface StockDocRow { uid: string; number: string; kind: "ajuste" | "conteo" | "transferencia"; date: string; description: string; lines: number; created_by: string | null }
export interface ReorderInput extends ReorderSettings { min_milli: number }

/* ───── Dinero ───── */

export type AccountKind = "caja" | "banco" | "billetera";
export interface MoneyAccount {
  uid: string;
  kind: AccountKind;
  name: string;
  bank_name: string | null;
  account_label: string | null;
  opening_minor: number;
  opening_date: string | null;
  archived: boolean;
  balance_minor: number;
}
export interface AccountInput { kind: AccountKind; name: string; bank_name?: string; account_label?: string; opening_minor: number; opening_date?: string }
export interface LedgerRow {
  date: string;
  kind: "cobro" | "pago" | "traspaso_entrada" | "traspaso_salida";
  document: string;
  detail: string;
  amount_minor: number;
  link: string | null;
  status: "vigente" | "anulado";
}
export interface MoneyTransferInput { from_uid: string; to_uid: string; date: string; amount_minor: number; notes?: string }
export interface ExpenseCategory { id: number; name: string; behavior: "fijo" | "variable" }
export interface ExpenseInput {
  category_id: number;
  supplier_uid: string | null;
  date: string;
  description: string;
  total_minor: number;
  tax_included: boolean;
  due_date: string | null;
  paid_method: string | null;
  paid_account_uid: string | null;
  notes?: string;
  recurring_id: number | null;
}
export interface ExpenseSummary {
  uid: string;
  number: string;
  date: string;
  due_date: string | null;
  category: string;
  supplier_name: string | null;
  description: string;
  total_minor: number;
  paid_minor: number;
  status: "registrado" | "anulado";
  payment_state: "pagado" | "abonado" | "por_pagar" | "anulado";
}
export interface ExpenseDetail extends ExpenseSummary {
  supplier_uid: string | null;
  net_minor: number;
  tax_minor: number;
  payments: Payment[];
  void_reason: string | null;
  notes: string | null;
  timeline: { at: string; text: string }[];
}
export interface ExpenseFilter { query?: string; from?: string; to?: string; include_void?: boolean }
export type Frequency = "semanal" | "mensual" | "bimestral" | "trimestral" | "anual";
export interface Recurring {
  id: number;
  direction: "ingreso" | "egreso";
  description: string;
  category_id: number | null;
  category: string | null;
  amount_minor: number;
  frequency: Frequency;
  day_of_period: number | null;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
}
export interface RecurringInput extends Omit<Recurring, "id" | "category"> { id: number | null }
export interface Aging { current_minor: number; d1_30_minor: number; d31_60_minor: number; d61_90_minor: number; d90_plus_minor: number }
export interface WeekFlow { start: string; end: string; opening_minor: number; inflow_minor: number; outflow_minor: number; closing_minor: number }
export interface DueRow { kind: "cobro" | "pago"; due_date: string; party: string; document: string; link: string; amount_minor: number; pending_minor: number }
export interface CalendarItem {
  date: string;
  kind: "cobro" | "pago" | "ingreso_recurrente" | "egreso_recurrente";
  label: string;
  party: string;
  amount_minor: number;
  link: string | null;
  overdue: boolean;
}
export interface MoneyOverview {
  today: string;
  accounts: MoneyAccount[];
  cash_minor: number;
  receivable_minor: number;
  receivable_overdue_minor: number;
  receivable_aging: Aging;
  payable_minor: number;
  payable_overdue_minor: number;
  payable_aging: Aging;
  next30_in_minor: number;
  next30_out_minor: number;
  in30_minor: number;
  projection: WeekFlow[];
  shortfall_week: string | null;
  lowest_minor: number;
  receivables: DueRow[];
  payables: DueRow[];
}

/* ───── COMEX ───── */

export type ImportStage =
  | "cotizacion" | "ordenada" | "pagada" | "produccion" | "lista_despacho" | "embarcada" | "en_transito"
  | "arribada" | "internacion" | "transporte_local" | "recibida" | "cerrada" | "anulada";
export type TransportMode = "maritimo" | "aereo" | "terrestre" | "courier" | "multimodal";
export interface IncotermDef {
  code: string;
  version: string;
  name: string;
  content: {
    grupo: string; transporte: string; entrega: string; riesgo: string;
    vendedor: string[]; comprador: string[]; agregar: string[]; nota: string;
  };
  source: string;
}
export interface ImportSummary {
  uid: string;
  number: string;
  supplier_name: string | null;
  stage: ImportStage;
  incoterm: string | null;
  transport_mode: TransportMode | null;
  currency_code: string;
  fob_minor: number | null;
  eta: string | null;
  eta_changes: number;
  eta_shift_days: number;
  landed_total_clp: number | null;
  estimated_landed_clp: number | null;
  items: number;
  created_at: string;
}
export interface ImportItemRow {
  id: number;
  product_uid: string | null;
  sku: string | null;
  description: string;
  qty_milli: number;
  received_milli: number;
  unit_price_minor: number;
  weight_g: number | null;
  volume_cm3: number | null;
  duty_ppm: number | null;
  hs_code: string | null;
  landed_unit_cost_e4: number | null;
  estimated_unit_cost_e4: number | null;
}
export interface ImportCost {
  id: number;
  kind: import("./comex").CostKind;
  description: string | null;
  supplier_uid: string | null;
  supplier_name: string | null;
  currency_code: string;
  currency_decimals: number;
  amount_minor: number;
  rate_e6: number | null;
  is_estimate: boolean;
  recoverable_tax: boolean;
  allocation_basis: import("./comex").Basis | null;
  status: "vigente" | "anulado";
  document_ref: string | null;
  cost_date: string | null;
  created_at: string;
  payable_due: string | null;
  payable_amount_minor: number | null;
  payable_paid_minor: number | null;
  amount_clp: number;
  payments: Payment[];
}
export interface StageChange { from_stage: ImportStage | null; to_stage: ImportStage; changed_at: string; changed_by: string | null; note: string | null }
export interface EtaChange { old_eta: string | null; new_eta: string; reason: string | null; changed_at: string; changed_by: string | null }
export interface ImportDetail {
  uid: string;
  number: string;
  supplier_uid: string | null;
  supplier_name: string | null;
  incoterm: string | null;
  incoterm_version: string | null;
  transport_mode: TransportMode | null;
  origin_country: string | null;
  origin_port: string | null;
  destination_port: string | null;
  currency_code: string;
  currency_decimals: number;
  rate_e6: number | null;
  stage: ImportStage;
  purchase_date: string | null;
  production_eta: string | null;
  shipment_date: string | null;
  eta: string | null;
  arrival_date: string | null;
  reception_date: string | null;
  allocation_basis: import("./comex").Basis;
  vat_ppm: number | null;
  vat_recoverable: boolean;
  /** Seguro teórico (ppm de la mercadería) para el valor aduanero, si no se contrató seguro. */
  notional_insurance_ppm: number | null;
  /** Flete según el AWB o BL (moneda de la importación), solo para el valor aduanero. */
  transport_freight_minor: number | null;
  fob_minor: number | null;
  landed_total_clp: number | null;
  estimated_landed_clp: number | null;
  estimated_at: string | null;
  notes: string | null;
  void_reason: string | null;
  created_at: string;
  items: ImportItemRow[];
  costs: ImportCost[];
  calc: import("./comex").LandedResult;
  has_estimates: boolean;
  editable: boolean;
  receivable: boolean;
  stage_history: StageChange[];
  eta_history: EtaChange[];
  receipts: { number: string; date: string }[];
  incoterm_info: IncotermDef | null;
  timeline: { at: string; text: string }[];
}
export interface ImportItemInput {
  product_uid: string | null;
  description: string;
  qty_milli: number;
  unit_price_minor: number;
  weight_g: number | null;
  volume_cm3: number | null;
  duty_ppm: number | null;
  hs_code: string | null;
}
export interface ImportInput {
  supplier_uid: string | null;
  incoterm: string | null;
  transport_mode: TransportMode | null;
  origin_country: string | null;
  origin_port: string | null;
  destination_port: string | null;
  currency_code: string;
  rate_e6: number | null;
  purchase_date: string | null;
  production_eta: string | null;
  shipment_date: string | null;
  eta: string | null;
  arrival_date: string | null;
  allocation_basis: import("./comex").Basis;
  vat_ppm: number | null;
  vat_recoverable: boolean;
  notional_insurance_ppm?: number | null;
  transport_freight_minor?: number | null;
  notes: string | null;
  items: ImportItemInput[];
}
export interface ImportCostInput {
  kind: import("./comex").CostKind;
  description: string | null;
  supplier_uid: string | null;
  currency_code: string;
  amount_minor: number;
  rate_e6: number | null;
  is_estimate: boolean;
  recoverable_tax: boolean;
  allocation_basis: import("./comex").Basis | null;
  document_ref: string | null;
  cost_date: string | null;
  /** Solo costos reales. */
  payment: "por_pagar" | "pagado" | "no_registrar" | null;
  due_date: string | null;
  paid_method: string | null;
  paid_account_uid: string | null;
}
export interface ImportReceiveLine { item_id: number; qty_milli: number }

/* ───── Dashboard ───── */

export interface Dashboard {
  today_sales_minor: number;
  today_sales_count: number;
  month_sales_minor: number;
  month_prev_sales_minor: number;
  month_expenses_minor: number;
  month_profit_minor: number;
  receivable_minor: number;
  receivable_overdue_minor: number;
  payable_minor: number;
  cash_minor: number;
  tax_estimate_minor: number | null;
  low_stock: { uid: string; name: string; on_hand_milli: number; min_milli: number }[];
  pending_documentation: number;
  upcoming_payments: { label: string; date: string; amount_minor: number; kind: "cobro" | "pago" }[];
  series: { month: string; sales_minor: number }[];
}

/* ───── Búsqueda global ───── */

export interface SearchHit {
  kind: "cliente" | "proveedor" | "producto" | "venta" | "cotizacion" | "orden_compra" | "documento";
  uid: string;
  title: string;
  subtitle: string;
}

/* ───── Respaldos ───── */

export interface BackupDone {
  path: string;
  file_name: string;
  size_bytes: number;
  verified: boolean;
  manifest: { created_at: string; counts: Record<string, number>; schema_version: number };
}

/* ───────────────────────────── Impuestos: F29 ───────────────────────────── */

export type TaxRegime = "14d3" | "14d8" | "14a";
export interface TaxProfile {
  regime: TaxRegime;
  /** Tasa de PPM de la empresa en ppm de los ingresos (0,25 % = 2.500). */
  ppm_rate_ppm: number | null;
  utm_decimals: number | null;
  due_day: number | null;
  common_use_ppm: number | null;
}
export interface F29Inputs {
  remnant_amount?: number | null;
  utm_prev?: number | null;
  utm_cur?: number | null;
  ppm_loss?: boolean;
  ppm_credit?: number;
  ppm_base_override?: number | null;
  common_use_ppm?: number | null;
  manual?: Record<string, number>;
}
export interface TaxDocLine {
  origin: "rcv" | "manual" | "nucleo";
  id: number | null;
  direction: "venta" | "compra";
  sii_type: number;
  folio: string | null;
  issue_date: string | null;
  counterpart: string | null;
  count: number;
  exempt_minor: number;
  net_minor: number;
  tax_minor: number;
  tax_non_rec_minor: number;
  common_use_tax_minor: number;
  kind: import("./f29").PurchaseKind | null;
  not_of_business: boolean;
  reference: string | null;
}
export interface F29Source { direction: "venta" | "compra"; source: "rcv" | "nucleo"; file_name: string | null; imported_at: string | null; rows: number }
export interface F29View {
  period: string;
  status: "borrador" | "declarado";
  profile: TaxProfile;
  inputs: F29Inputs;
  remnant_suggested: number | null;
  remnant_from: string | null;
  sources: F29Source[];
  docs: TaxDocLine[];
  result: import("./f29").F29Result;
  checks: import("./f29").F29Note[];
  declared: { declared_77: number; declared_91: number; folio: string | null; at: string | null } | null;
  due_date: string | null;
  periods: { period: string; status: string; declared_91: number | null }[];
}
export interface TaxDocInput {
  direction: "venta" | "compra";
  sii_type: number;
  folio: string | null;
  issue_date: string | null;
  counterpart_rut: string | null;
  counterpart_name: string | null;
  doc_count?: number | null;
  exempt_minor: number;
  net_minor: number;
  tax_minor: number;
  purchase_kind?: import("./f29").PurchaseKind | null;
  not_of_business?: boolean;
  note?: string | null;
}
export interface RcvImportReport { rows: number; skipped: string[]; other_period: number; view: F29View }
