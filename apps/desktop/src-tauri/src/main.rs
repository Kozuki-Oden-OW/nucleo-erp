// Sin consola extra en Windows en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use nucleo_app::AppService;
use nucleo_app::keys::OsKeyStore;
use std::sync::Mutex;
use tauri::Manager;

/// Almacén de claves: el del sistema operativo. Solo en compilaciones de desarrollo,
/// `NUCLEO_EPHEMERAL_KEYS=1` usa claves en memoria (se pierden al cerrar) para pruebas
/// automáticas en entornos sin almacén seguro. En versiones publicadas no existe esta opción.
fn key_store() -> Box<dyn nucleo_app::KeyStore> {
    #[cfg(debug_assertions)]
    if std::env::var("NUCLEO_EPHEMERAL_KEYS").as_deref() == Ok("1") {
        return Box::new(nucleo_app::MemoryKeyStore::default());
    }
    Box::new(OsKeyStore::new("NucleoERP"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // %LOCALAPPDATA%\NucleoERP en Windows (Blueprint §8.2).
            let data_dir = app.path().local_data_dir()?.join("NucleoERP");
            let backups_dir = app
                .path()
                .document_dir()
                .unwrap_or_else(|_| data_dir.clone())
                .join("NUCLEO ERP Respaldos");
            let service = AppService::open(&data_dir, key_store())
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            app.manage(commands::AppState {
                service: Mutex::new(service),
                session: Mutex::new(None),
                backups_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::create_company,
            commands::open_company,
            commands::session_info,
            commands::login,
            commands::logout,
            commands::recover_key,
            commands::business,
            commands::update_business,
            commands::security,
            commands::update_security,
            commands::list_users,
            commands::roles,
            commands::create_user,
            commands::update_user,
            commands::set_password,
            commands::update_role_permissions,
            commands::sequences,
            commands::update_sequence,
            commands::currencies,
            commands::rates,
            commands::set_rate,
            commands::add_attachment,
            commands::list_attachments,
            commands::export_attachment,
            commands::attachment_preview,
            commands::archive_attachment,
            commands::add_customer,
            commands::search_customers,
            commands::global_search,
            commands::audit_log,
            commands::verify_audit,
            commands::create_backup,
            commands::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar NÚCLEO ERP");
}
