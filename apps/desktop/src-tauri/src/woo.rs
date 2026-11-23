//! Comandos de WooCommerce. Igual que Mercado Libre, la red se usa **sin** tener tomada la sesión: se
//! prepara con la sesión, se consulta a la tienda fuera de ella y se aplica con la sesión.

use crate::commands::{AppState, CommandError};
use nucleo_app::nucleo_db::integrations::WooOrderRow;
use nucleo_app::woo_ops::{
    self, UreqHttp, WooConnectInput, WooPushReport, WooStatus, WooSyncReport,
};
use nucleo_app::{AppError, CompanySession};
use tauri::State;

type CmdResult<T> = Result<T, CommandError>;

fn err(msg: impl Into<String>) -> CommandError {
    AppError::Validation(msg.into()).into()
}

fn with<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&mut CompanySession) -> Result<T, AppError>,
) -> CmdResult<T> {
    let mut g = state.session.lock().map_err(|_| err("sesión bloqueada"))?;
    let s = g.as_mut().ok_or_else(|| err("no hay un negocio abierto"))?;
    Ok(f(s)?)
}

#[tauri::command]
pub fn woo_status(state: State<'_, AppState>) -> CmdResult<WooStatus> {
    with(&state, |s| s.woo_status())
}

/// Prueba las llaves contra la tienda y, si responde bien, guarda la conexión.
#[tauri::command]
pub async fn woo_connect(
    state: State<'_, AppState>,
    input: WooConnectInput,
) -> CmdResult<WooStatus> {
    let cfg = with(&state, |s| s.woo_connect_plan(&input))?;
    let (cfg, info) = tauri::async_runtime::spawn_blocking(move || {
        let r = woo_ops::check(&UreqHttp::default(), &cfg);
        (cfg, r)
    })
    .await
    .map_err(|e| err(e.to_string()))?;
    let info = info.map_err(|e| err(e.to_string()))?;
    with(&state, |s| s.woo_connected(&cfg, &info))
}

#[tauri::command]
pub fn woo_disconnect(state: State<'_, AppState>) -> CmdResult<WooStatus> {
    with(&state, |s| s.woo_disconnect())
}

/// Trae los pedidos desde `from` (AAAA-MM-DD; vacío = últimos 30 días) y los pasa a clientes, ventas
/// y envíos. Después anota en cada pedido de la tienda el número de la venta.
#[tauri::command]
pub async fn woo_sync(
    state: State<'_, AppState>,
    from: Option<String>,
) -> CmdResult<WooSyncReport> {
    let plan = with(&state, |s| s.woo_sync_plan(from.as_deref()))?;
    let (plan, orders) = tauri::async_runtime::spawn_blocking(move || {
        let r = woo_ops::fetch(&UreqHttp::default(), &plan);
        (plan, r)
    })
    .await
    .map_err(|e| err(e.to_string()))?;
    let orders = orders.map_err(|e| err(e.to_string()))?;
    let mut report = with(&state, |s| s.woo_apply(&orders))?;
    if plan.config.write_back && !report.to_write_back.is_empty() {
        let items = std::mem::take(&mut report.to_write_back);
        let failed = tauri::async_runtime::spawn_blocking(move || {
            woo_ops::write_back(&UreqHttp::default(), &plan.config, &items)
        })
        .await
        .map_err(|e| err(e.to_string()))?;
        report.messages.extend(failed);
    }
    Ok(report)
}

#[tauri::command]
pub fn woo_orders(state: State<'_, AppState>, limit: Option<i64>) -> CmdResult<Vec<WooOrderRow>> {
    with(&state, |s| s.woo_orders(limit))
}

/// Compara stock y precios de NÚCLEO con la tienda. Con `apply` envía los cambios; sin él, solo
/// muestra qué cambiaría.
#[tauri::command]
pub async fn woo_push(
    state: State<'_, AppState>,
    stock: bool,
    prices: bool,
    apply: bool,
) -> CmdResult<WooPushReport> {
    let plan = with(&state, |s| s.woo_push_plan(stock, prices))?;
    let report = tauri::async_runtime::spawn_blocking(move || {
        woo_ops::push(&UreqHttp::default(), &plan, apply)
    })
    .await
    .map_err(|e| err(e.to_string()))?
    .map_err(|e| err(e.to_string()))?;
    with(&state, |s| s.woo_push_done(&report))?;
    Ok(report)
}
