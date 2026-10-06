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
  kind: "COT" | "VEN" | "FV" | "PAG" | "REF";
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
}
export interface ExternalRefInput {
  doc_kind?: string;
  external_number?: string;
  issue_date?: string;
  observation?: string;
}

/* ───── Compras (prototipo Fase 3; módulo real en Fase 6) ───── */

export interface PurchaseOrderSummary {
  uid: string;
  number: string;
  supplier_name: string;
  issue_date: string;
  expected_date: string | null;
  status: "borrador" | "emitida" | "parcial" | "recibida" | "anulada";
  total_minor: number;
}
export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  lines: { product_uid: string | null; description: string; qty_milli: number; received_milli: number; unit_cost_minor: number }[];
  totals: Totals;
}

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
