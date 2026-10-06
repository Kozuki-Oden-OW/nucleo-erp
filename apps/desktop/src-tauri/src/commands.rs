//! Comandos IPC: capa delgada sobre `nucleo-app`. Aquí no hay reglas de negocio ni permisos:
//! cada caso de uso de `nucleo-app` verifica el permiso de quien opera y audita.

use nucleo_app::company::BackupDone;
use nucleo_app::core_ops::{
    BusinessPatch, BusinessSettings, CurrentUser, EntityRef, NewUser, SecuritySettings, UserPatch,
};
use nucleo_app::inventory_ops::{
    AdjustmentInput, InventoryOverview, InventorySettings, ProductInventory, ReorderInput,
    StockDocDone, TransferInput,
};
use nucleo_app::nucleo_db::audit::{AuditRow, ChainReport};
use nucleo_app::nucleo_db::core::{AttachmentRow, CurrencyRow, RateRow, SearchHit, SequenceRow};
use nucleo_app::nucleo_db::customers::CustomerRow;
use nucleo_app::nucleo_db::inventory::{StockDocRow, WarehouseRow};
use nucleo_app::nucleo_db::products::ProductRow;
use nucleo_app::nucleo_db::purchases::PriceHistoryRow;
use nucleo_app::nucleo_db::suppliers::SupplierRow;
use nucleo_app::nucleo_db::users::{PermissionRow, RoleRow, UserRow};
use nucleo_app::purchase_ops::{
    NewSupplier, PoDetail, PoInput, PoSummary, PurchaseDetail, PurchaseFilter, PurchaseInput,
    PurchaseSummary, ReceiveLine, SupplierDetail,
};
use nucleo_app::sales_ops::{
    CustomerDetail, EffectInput, ExternalRefInput, NewProduct, ProductPatch, QuoteDetail,
    QuoteInput, QuoteSummary, SaleDetail, SaleFilter, SaleInput, SaleSummary,
};
use nucleo_app::{
    AppError, AppService, BusinessProfile, CompanyInfo, CompanySession, CreatedCompany, NewCustomer,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub service: Mutex<AppService>,
    pub session: Mutex<Option<CompanySession>>,
    pub backups_dir: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl From<AppError> for CommandError {
    fn from(e: AppError) -> Self {
        let message = e.to_string();
        // Primera letra en mayúscula para mostrarlo tal cual.
        let mut c = message.chars();
        let message = match c.next() {
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            None => message,
        };
        Self {
            code: e.code(),
            message,
        }
    }
}

fn internal(msg: &str) -> CommandError {
    CommandError {
        code: "interno",
        message: msg.to_string(),
    }
}

type CmdResult<T> = Result<T, CommandError>;

#[derive(Serialize)]
pub struct AppInfo {
    version: &'static str,
    data_dir: String,
    backups_dir: String,
    companies: Vec<CompanyInfo>,
}

#[derive(Serialize)]
pub struct SessionInfo {
    company: CompanyInfo,
    cipher_version: String,
    customers: i64,
    audit: ChainReport,
    /// `true` = hay usuarios con contraseña y falta iniciar sesión.
    login_required: bool,
    user: Option<CurrentUser>,
    /// Usuarios que pueden iniciar sesión: (usuario, nombre visible).
    login_users: Vec<(String, String)>,
    lock_minutes: u32,
}

fn session_info_of(s: &CompanySession, created_at: String) -> CmdResult<SessionInfo> {
    let logged = !s.login_required();
    Ok(SessionInfo {
        company: CompanyInfo {
            uid: s.uid().into(),
            name: s.name().into(),
            profile: s.profile(),
            created_at,
        },
        cipher_version: s.cipher_version()?,
        customers: if s.can("clientes.ver") {
            s.count_customers()?
        } else {
            0
        },
        audit: s.verify_audit()?,
        login_required: !logged,
        user: s.current_user(),
        login_users: s.login_candidates()?,
        lock_minutes: if logged {
            s.security()?.lock_minutes
        } else {
            0
        },
    })
}

fn svc<'a>(state: &'a State<'_, AppState>) -> CmdResult<std::sync::MutexGuard<'a, AppService>> {
    state
        .service
        .lock()
        .map_err(|_| internal("servicio bloqueado"))
}

fn with_session<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut CompanySession) -> CmdResult<T>,
) -> CmdResult<T> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| internal("sesión bloqueada"))?;
    let s = guard
        .as_mut()
        .ok_or_else(|| internal("no hay un negocio abierto"))?;
    f(s)
}

/* ───────────────────────────── Empresas y sesión ───────────────────────────── */

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> CmdResult<AppInfo> {
    let svc = svc(&state)?;
    Ok(AppInfo {
        version: nucleo_app::APP_VERSION,
        data_dir: svc.data_dir().to_string_lossy().into(),
        backups_dir: state.backups_dir.to_string_lossy().into(),
        companies: svc.list_companies()?,
    })
}

#[tauri::command]
pub fn create_company(
    state: State<'_, AppState>,
    name: String,
    profile: BusinessProfile,
) -> CmdResult<CreatedCompany> {
    Ok(svc(&state)?.create_company(&name, profile)?)
}

#[tauri::command]
pub fn open_company(state: State<'_, AppState>, uid: String) -> CmdResult<SessionInfo> {
    let svc = svc(&state)?;
    let created_at = svc
        .list_companies()?
        .into_iter()
        .find(|c| c.uid == uid)
        .map(|c| c.created_at)
        .unwrap_or_default();
    let session = svc.open_company(&uid)?;
    let info = session_info_of(&session, created_at)?;
    *state
        .session
        .lock()
        .map_err(|_| internal("sesión bloqueada"))? = Some(session);
    Ok(info)
}

#[tauri::command]
pub fn session_info(state: State<'_, AppState>) -> CmdResult<SessionInfo> {
    with_session(&state, |s| session_info_of(s, String::new()))
}

#[tauri::command]
pub fn login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> CmdResult<SessionInfo> {
    with_session(&state, |s| {
        s.login(&username, &password)?;
        session_info_of(s, String::new())
    })
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> CmdResult<SessionInfo> {
    with_session(&state, |s| {
        s.logout()?;
        session_info_of(s, String::new())
    })
}

#[tauri::command]
pub fn recover_key(state: State<'_, AppState>, uid: String, recovery: String) -> CmdResult<()> {
    Ok(svc(&state)?.recover_key(&uid, &recovery)?)
}

/* ───────────────────────────── Negocio ───────────────────────────── */

#[tauri::command]
pub fn business(state: State<'_, AppState>) -> CmdResult<BusinessSettings> {
    with_session(&state, |s| Ok(s.business()?))
}

#[tauri::command]
pub fn update_business(
    state: State<'_, AppState>,
    patch: BusinessPatch,
) -> CmdResult<BusinessSettings> {
    let b = with_session(&state, |s| Ok(s.update_business(&patch)?))?;
    let uid = with_session(&state, |s| Ok(s.uid().to_string()))?;
    svc(&state)?.update_company(&uid, &b.name, b.profile)?;
    Ok(b)
}

#[tauri::command]
pub fn security(state: State<'_, AppState>) -> CmdResult<SecuritySettings> {
    with_session(&state, |s| Ok(s.security()?))
}

#[tauri::command]
pub fn update_security(
    state: State<'_, AppState>,
    settings: SecuritySettings,
) -> CmdResult<SecuritySettings> {
    with_session(&state, |s| Ok(s.update_security(&settings)?))
}

/* ───────────────────────────── Usuarios y roles ───────────────────────────── */

#[derive(Serialize)]
pub struct RolesInfo {
    roles: Vec<RoleRow>,
    permissions: Vec<PermissionRow>,
}

#[tauri::command]
pub fn list_users(state: State<'_, AppState>) -> CmdResult<Vec<UserRow>> {
    with_session(&state, |s| Ok(s.list_users()?))
}

#[tauri::command]
pub fn roles(state: State<'_, AppState>) -> CmdResult<RolesInfo> {
    with_session(&state, |s| {
        let (roles, permissions) = s.roles()?;
        Ok(RolesInfo { roles, permissions })
    })
}

#[tauri::command]
pub fn create_user(state: State<'_, AppState>, input: NewUser) -> CmdResult<UserRow> {
    with_session(&state, |s| Ok(s.create_user(&input)?))
}

#[tauri::command]
pub fn update_user(
    state: State<'_, AppState>,
    uid: String,
    patch: UserPatch,
) -> CmdResult<UserRow> {
    with_session(&state, |s| Ok(s.update_user(&uid, &patch)?))
}

#[tauri::command]
pub fn set_password(
    state: State<'_, AppState>,
    uid: String,
    password: Option<String>,
) -> CmdResult<()> {
    with_session(&state, |s| Ok(s.set_password(&uid, password.as_deref())?))
}

#[tauri::command]
pub fn update_role_permissions(
    state: State<'_, AppState>,
    role: String,
    permissions: Vec<String>,
) -> CmdResult<RoleRow> {
    with_session(&state, |s| {
        Ok(s.update_role_permissions(&role, &permissions)?)
    })
}

/* ───────────────────────────── Numeración y monedas ───────────────────────────── */

#[tauri::command]
pub fn sequences(state: State<'_, AppState>) -> CmdResult<Vec<SequenceRow>> {
    with_session(&state, |s| Ok(s.sequences()?))
}

#[tauri::command]
pub fn update_sequence(
    state: State<'_, AppState>,
    doc_type: String,
    prefix: String,
    next_number: i64,
    width: i64,
) -> CmdResult<SequenceRow> {
    with_session(&state, |s| {
        Ok(s.update_sequence(&doc_type, &prefix, next_number, width)?)
    })
}

#[tauri::command]
pub fn currencies(state: State<'_, AppState>) -> CmdResult<Vec<CurrencyRow>> {
    with_session(&state, |s| Ok(s.currencies()?))
}

#[tauri::command]
pub fn rates(state: State<'_, AppState>, currency: String) -> CmdResult<Vec<RateRow>> {
    with_session(&state, |s| Ok(s.rates(&currency)?))
}

#[tauri::command]
pub fn set_rate(
    state: State<'_, AppState>,
    currency: String,
    date: String,
    rate_e6: i64,
    note: Option<String>,
) -> CmdResult<()> {
    with_session(&state, |s| {
        Ok(s.set_rate(&currency, &date, rate_e6, note.as_deref())?)
    })
}

/* ───────────────────────────── Documentos ───────────────────────────── */

#[tauri::command]
pub fn add_attachment(
    state: State<'_, AppState>,
    path: String,
    description: Option<String>,
    link: Option<EntityRef>,
) -> CmdResult<AttachmentRow> {
    with_session(&state, |s| {
        Ok(s.add_attachment(path.as_ref(), description.as_deref(), link.as_ref())?)
    })
}

#[tauri::command]
pub fn list_attachments(
    state: State<'_, AppState>,
    query: String,
    link: Option<EntityRef>,
) -> CmdResult<Vec<AttachmentRow>> {
    with_session(&state, |s| Ok(s.list_attachments(&query, link.as_ref())?))
}

#[tauri::command]
pub fn export_attachment(state: State<'_, AppState>, uid: String, path: String) -> CmdResult<()> {
    with_session(&state, |s| Ok(s.export_attachment(&uid, path.as_ref())?))
}

/// Vista previa de imágenes: contenido descifrado en base64 (solo tipos de imagen, hasta 15 MB).
#[tauri::command]
pub fn attachment_preview(state: State<'_, AppState>, uid: String) -> CmdResult<Option<String>> {
    with_session(&state, |s| {
        let (row, bytes) = s.attachment_bytes(&uid)?;
        if !row.mime_type.starts_with("image/") || bytes.len() > 15 * 1024 * 1024 {
            return Ok(None);
        }
        Ok(Some(format!(
            "data:{};base64,{}",
            row.mime_type,
            data_encoding::BASE64.encode(&bytes)
        )))
    })
}

#[tauri::command]
pub fn archive_attachment(
    state: State<'_, AppState>,
    uid: String,
    reason: String,
) -> CmdResult<()> {
    with_session(&state, |s| Ok(s.archive_attachment(&uid, &reason)?))
}

/* ───────────────────────────── Clientes, búsqueda y auditoría ───────────────────────────── */

#[tauri::command]
pub fn add_customer(state: State<'_, AppState>, input: NewCustomer) -> CmdResult<CustomerRow> {
    with_session(&state, |s| Ok(s.add_customer(&input)?))
}

#[tauri::command]
pub fn search_customers(state: State<'_, AppState>, query: String) -> CmdResult<Vec<CustomerRow>> {
    with_session(&state, |s| Ok(s.search_customers(&query, 200)?))
}

#[tauri::command]
pub fn global_search(state: State<'_, AppState>, query: String) -> CmdResult<Vec<SearchHit>> {
    with_session(&state, |s| Ok(s.global_search(&query)?))
}

#[tauri::command]
pub fn audit_log(
    state: State<'_, AppState>,
    query: String,
    before_id: Option<i64>,
) -> CmdResult<Vec<AuditRow>> {
    with_session(&state, |s| Ok(s.audit_log(&query, before_id)?))
}

#[tauri::command]
pub fn verify_audit(state: State<'_, AppState>) -> CmdResult<ChainReport> {
    with_session(&state, |s| Ok(s.verify_audit()?))
}

/* ───────────────────────────── Respaldos ───────────────────────────── */

#[tauri::command]
pub fn create_backup(state: State<'_, AppState>, password: String) -> CmdResult<BackupDone> {
    let dir = state.backups_dir.clone();
    with_session(&state, |s| Ok(s.create_backup(&dir, &password)?))
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<CompanyInfo> {
    // Restaurar crea un negocio nuevo; se exige el permiso en el negocio abierto.
    let user = with_session(&state, |s| {
        if !s.can("respaldos.restaurar") {
            return Err(AppError::Forbidden("restaurar respaldos".into()).into());
        }
        Ok(s.actor_name()?)
    })?;
    Ok(svc(&state)?.restore_backup(path.as_ref(), &password, &user)?)
}

/* ───────────────────────────── Ventas (Fase 5) ───────────────────────────── */

#[tauri::command]
pub fn search_products(state: State<'_, AppState>, query: String) -> CmdResult<Vec<ProductRow>> {
    with_session(&state, |s| Ok(s.search_products(&query, 300)?))
}

#[tauri::command]
pub fn add_product(state: State<'_, AppState>, input: NewProduct) -> CmdResult<ProductRow> {
    with_session(&state, |s| Ok(s.add_product(&input)?))
}

#[tauri::command]
pub fn customer(state: State<'_, AppState>, uid: String) -> CmdResult<CustomerDetail> {
    with_session(&state, |s| Ok(s.customer_detail(&uid)?))
}

#[tauri::command]
pub fn list_quotes(
    state: State<'_, AppState>,
    query: Option<String>,
) -> CmdResult<Vec<QuoteSummary>> {
    with_session(&state, |s| {
        Ok(s.list_quotes(query.as_deref().unwrap_or(""))?)
    })
}

#[tauri::command]
pub fn quote(state: State<'_, AppState>, uid: String) -> CmdResult<QuoteDetail> {
    with_session(&state, |s| Ok(s.quote(&uid)?))
}

#[tauri::command]
pub fn save_quote(
    state: State<'_, AppState>,
    input: QuoteInput,
    uid: Option<String>,
) -> CmdResult<QuoteDetail> {
    with_session(&state, |s| Ok(s.save_quote(&input, uid.as_deref())?))
}

#[tauri::command]
pub fn set_quote_status(
    state: State<'_, AppState>,
    uid: String,
    status: String,
) -> CmdResult<QuoteDetail> {
    with_session(&state, |s| Ok(s.set_quote_status(&uid, &status)?))
}

#[tauri::command]
pub fn convert_quote(state: State<'_, AppState>, uid: String) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.convert_quote(&uid)?))
}

#[tauri::command]
pub fn list_sales(state: State<'_, AppState>, filter: SaleFilter) -> CmdResult<Vec<SaleSummary>> {
    with_session(&state, |s| Ok(s.list_sales(&filter)?))
}

#[tauri::command]
pub fn sale(state: State<'_, AppState>, uid: String) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.sale(&uid)?))
}

#[tauri::command]
pub fn save_sale(
    state: State<'_, AppState>,
    input: SaleInput,
    uid: Option<String>,
) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.save_sale(&input, uid.as_deref())?))
}

#[tauri::command]
pub fn effect_sale(
    state: State<'_, AppState>,
    uid: String,
    input: EffectInput,
) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.effect_sale(&uid, &input)?))
}

#[tauri::command]
pub fn register_payment(
    state: State<'_, AppState>,
    uid: String,
    amount_minor: i64,
    method: String,
    date: String,
) -> CmdResult<SaleDetail> {
    with_session(&state, |s| {
        Ok(s.register_payment(&uid, amount_minor, &method, &date)?)
    })
}

#[tauri::command]
pub fn mark_documented(
    state: State<'_, AppState>,
    uid: String,
    reference: ExternalRefInput,
) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.mark_documented(&uid, &reference)?))
}

#[tauri::command]
pub fn set_documentation_not_applicable(
    state: State<'_, AppState>,
    uid: String,
) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.set_documentation_not_applicable(&uid)?))
}

#[tauri::command]
pub fn void_sale(state: State<'_, AppState>, uid: String, reason: String) -> CmdResult<SaleDetail> {
    with_session(&state, |s| Ok(s.void_sale(&uid, &reason)?))
}

#[tauri::command]
pub fn update_product(
    state: State<'_, AppState>,
    uid: String,
    patch: ProductPatch,
) -> CmdResult<ProductRow> {
    with_session(&state, |s| Ok(s.update_product(&uid, &patch)?))
}

#[tauri::command]
pub fn update_customer(
    state: State<'_, AppState>,
    uid: String,
    input: NewCustomer,
) -> CmdResult<CustomerRow> {
    with_session(&state, |s| Ok(s.update_customer(&uid, &input)?))
}

/* ───────────────────────────── Compras (Fase 6) ───────────────────────────── */

#[tauri::command]
pub fn search_suppliers(state: State<'_, AppState>, query: String) -> CmdResult<Vec<SupplierRow>> {
    with_session(&state, |s| Ok(s.search_suppliers(&query, 300)?))
}

#[tauri::command]
pub fn supplier(state: State<'_, AppState>, uid: String) -> CmdResult<SupplierDetail> {
    with_session(&state, |s| Ok(s.supplier_detail(&uid)?))
}

#[tauri::command]
pub fn add_supplier(state: State<'_, AppState>, input: NewSupplier) -> CmdResult<SupplierRow> {
    with_session(&state, |s| Ok(s.add_supplier(&input)?))
}

#[tauri::command]
pub fn update_supplier(
    state: State<'_, AppState>,
    uid: String,
    input: NewSupplier,
) -> CmdResult<SupplierRow> {
    with_session(&state, |s| Ok(s.update_supplier(&uid, &input)?))
}

#[tauri::command]
pub fn price_history(
    state: State<'_, AppState>,
    product_uid: String,
) -> CmdResult<Vec<PriceHistoryRow>> {
    with_session(&state, |s| Ok(s.price_history(&product_uid)?))
}

#[tauri::command]
pub fn list_purchase_orders(
    state: State<'_, AppState>,
    query: Option<String>,
) -> CmdResult<Vec<PoSummary>> {
    with_session(&state, |s| {
        Ok(s.list_purchase_orders(query.as_deref().unwrap_or(""))?)
    })
}

#[tauri::command]
pub fn purchase_order(state: State<'_, AppState>, uid: String) -> CmdResult<PoDetail> {
    with_session(&state, |s| Ok(s.purchase_order(&uid)?))
}

#[tauri::command]
pub fn save_purchase_order(
    state: State<'_, AppState>,
    input: PoInput,
    uid: Option<String>,
) -> CmdResult<PoDetail> {
    with_session(&state, |s| {
        Ok(s.save_purchase_order(&input, uid.as_deref())?)
    })
}

#[tauri::command]
pub fn issue_purchase_order(state: State<'_, AppState>, uid: String) -> CmdResult<PoDetail> {
    with_session(&state, |s| Ok(s.issue_purchase_order(&uid)?))
}

#[tauri::command]
pub fn void_purchase_order(
    state: State<'_, AppState>,
    uid: String,
    reason: String,
) -> CmdResult<PoDetail> {
    with_session(&state, |s| Ok(s.void_purchase_order(&uid, &reason)?))
}

#[tauri::command]
pub fn receive_purchase_order(
    state: State<'_, AppState>,
    uid: String,
    lines: Vec<ReceiveLine>,
    date: String,
) -> CmdResult<PoDetail> {
    with_session(&state, |s| {
        Ok(s.receive_purchase_order(&uid, &lines, &date)?)
    })
}

#[tauri::command]
pub fn list_purchases(
    state: State<'_, AppState>,
    filter: PurchaseFilter,
) -> CmdResult<Vec<PurchaseSummary>> {
    with_session(&state, |s| Ok(s.list_purchases(&filter)?))
}

#[tauri::command]
pub fn purchase(state: State<'_, AppState>, uid: String) -> CmdResult<PurchaseDetail> {
    with_session(&state, |s| Ok(s.purchase(&uid)?))
}

#[tauri::command]
pub fn register_purchase(
    state: State<'_, AppState>,
    input: PurchaseInput,
) -> CmdResult<PurchaseDetail> {
    with_session(&state, |s| Ok(s.register_purchase(&input)?))
}

#[tauri::command]
pub fn pay_purchase(
    state: State<'_, AppState>,
    uid: String,
    amount_minor: i64,
    method: String,
    date: String,
) -> CmdResult<PurchaseDetail> {
    with_session(&state, |s| {
        Ok(s.pay_purchase(&uid, amount_minor, &method, &date)?)
    })
}

#[tauri::command]
pub fn void_purchase(
    state: State<'_, AppState>,
    uid: String,
    reason: String,
) -> CmdResult<PurchaseDetail> {
    with_session(&state, |s| Ok(s.void_purchase(&uid, &reason)?))
}

/* ───────────────────────────── Inventario (Fase 7) ───────────────────────────── */

#[tauri::command]
pub fn inventory_settings(state: State<'_, AppState>) -> CmdResult<InventorySettings> {
    with_session(&state, |s| Ok(s.inventory_settings()?))
}

#[tauri::command]
pub fn update_inventory_settings(
    state: State<'_, AppState>,
    settings: InventorySettings,
) -> CmdResult<InventorySettings> {
    with_session(&state, |s| Ok(s.update_inventory_settings(&settings)?))
}

#[tauri::command]
pub fn warehouses(state: State<'_, AppState>) -> CmdResult<Vec<WarehouseRow>> {
    with_session(&state, |s| Ok(s.warehouses()?))
}

#[tauri::command]
pub fn create_warehouse(state: State<'_, AppState>, name: String) -> CmdResult<Vec<WarehouseRow>> {
    with_session(&state, |s| Ok(s.create_warehouse(&name)?))
}

#[tauri::command]
pub fn rename_warehouse(
    state: State<'_, AppState>,
    uid: String,
    name: String,
) -> CmdResult<Vec<WarehouseRow>> {
    with_session(&state, |s| Ok(s.rename_warehouse(&uid, &name)?))
}

#[tauri::command]
pub fn set_default_warehouse(
    state: State<'_, AppState>,
    uid: String,
) -> CmdResult<Vec<WarehouseRow>> {
    with_session(&state, |s| Ok(s.set_default_warehouse(&uid)?))
}

#[tauri::command]
pub fn archive_warehouse(state: State<'_, AppState>, uid: String) -> CmdResult<Vec<WarehouseRow>> {
    with_session(&state, |s| Ok(s.archive_warehouse(&uid)?))
}

#[tauri::command]
pub fn adjust_stock(state: State<'_, AppState>, input: AdjustmentInput) -> CmdResult<StockDocDone> {
    with_session(&state, |s| Ok(s.adjust_stock(&input)?))
}

#[tauri::command]
pub fn transfer_stock(state: State<'_, AppState>, input: TransferInput) -> CmdResult<StockDocDone> {
    with_session(&state, |s| Ok(s.transfer_stock(&input)?))
}

#[tauri::command]
pub fn stock_documents(state: State<'_, AppState>) -> CmdResult<Vec<StockDocRow>> {
    with_session(&state, |s| Ok(s.stock_documents()?))
}

#[tauri::command]
pub fn inventory_overview(state: State<'_, AppState>) -> CmdResult<InventoryOverview> {
    with_session(&state, |s| Ok(s.inventory_overview()?))
}

#[tauri::command]
pub fn product_inventory(
    state: State<'_, AppState>,
    uid: String,
    warehouse_uid: Option<String>,
) -> CmdResult<ProductInventory> {
    with_session(&state, |s| {
        Ok(s.product_inventory(&uid, warehouse_uid.as_deref())?)
    })
}

#[tauri::command]
pub fn update_reorder_settings(
    state: State<'_, AppState>,
    uid: String,
    input: ReorderInput,
) -> CmdResult<ProductInventory> {
    with_session(&state, |s| Ok(s.update_reorder_settings(&uid, &input)?))
}
