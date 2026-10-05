//! Comandos IPC: capa delgada sobre `nucleo-app`. Aquí no hay reglas de negocio.

use nucleo_app::company::BackupDone;
use nucleo_app::nucleo_db::audit::ChainReport;
use nucleo_app::nucleo_db::customers::CustomerRow;
use nucleo_app::{
    AppError, AppService, BusinessProfile, CompanyInfo, CompanySession, CreatedCompany, NewCustomer,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Fase 1: aún no hay usuarios ni roles (Fase 4). Todo se registra como usuario local.
const LOCAL_USER: &str = "usuario-local";

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
        Self {
            code: e.code(),
            message: e.to_string(),
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
}

fn session_info_of(s: &CompanySession, created_at: String) -> CmdResult<SessionInfo> {
    Ok(SessionInfo {
        company: CompanyInfo {
            uid: s.uid().into(),
            name: s.name().into(),
            profile: s.profile(),
            created_at,
        },
        cipher_version: s.cipher_version()?,
        customers: s.count_customers()?,
        audit: s.verify_audit()?,
    })
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

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> CmdResult<AppInfo> {
    let svc = state
        .service
        .lock()
        .map_err(|_| internal("servicio bloqueado"))?;
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
    let mut svc = state
        .service
        .lock()
        .map_err(|_| internal("servicio bloqueado"))?;
    Ok(svc.create_company(&name, profile, LOCAL_USER)?)
}

#[tauri::command]
pub fn open_company(state: State<'_, AppState>, uid: String) -> CmdResult<SessionInfo> {
    let svc = state
        .service
        .lock()
        .map_err(|_| internal("servicio bloqueado"))?;
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
pub fn add_customer(state: State<'_, AppState>, input: NewCustomer) -> CmdResult<CustomerRow> {
    with_session(&state, |s| Ok(s.add_customer(&input, LOCAL_USER)?))
}

#[tauri::command]
pub fn search_customers(state: State<'_, AppState>, query: String) -> CmdResult<Vec<CustomerRow>> {
    with_session(&state, |s| Ok(s.search_customers(&query, 50)?))
}

#[tauri::command]
pub fn create_backup(state: State<'_, AppState>, password: String) -> CmdResult<BackupDone> {
    let dir = state.backups_dir.clone();
    with_session(
        &state,
        |s| Ok(s.create_backup(&dir, &password, LOCAL_USER)?),
    )
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> CmdResult<CompanyInfo> {
    let mut svc = state
        .service
        .lock()
        .map_err(|_| internal("servicio bloqueado"))?;
    Ok(svc.restore_backup(path.as_ref(), &password, LOCAL_USER)?)
}

#[tauri::command]
pub fn verify_audit(state: State<'_, AppState>) -> CmdResult<ChainReport> {
    with_session(&state, |s| Ok(s.verify_audit()?))
}

#[tauri::command]
pub fn recover_key(state: State<'_, AppState>, uid: String, recovery: String) -> CmdResult<()> {
    let svc = state
        .service
        .lock()
        .map_err(|_| internal("servicio bloqueado"))?;
    Ok(svc.recover_key(&uid, &recovery)?)
}
