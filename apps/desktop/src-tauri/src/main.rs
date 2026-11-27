// Sin consola extra en Windows en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod access;
mod agent;
mod auto;
mod browser;
mod commands;
#[cfg(test)]
mod ipc_tests;
mod mail;
mod ml;
mod quotedoc;
mod sii;
mod sync;
mod woo;
mod wsp;

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

/// Registra todos los comandos IPC (también lo usan las pruebas del contrato con el runtime simulado).
fn with_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
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
        commands::search_products,
        commands::add_product,
        commands::customer,
        commands::list_quotes,
        commands::quote,
        commands::save_quote,
        commands::set_quote_status,
        commands::convert_quote,
        commands::list_sales,
        commands::sale,
        commands::save_sale,
        commands::effect_sale,
        commands::register_payment,
        commands::mark_documented,
        commands::import_historical_sales,
        commands::set_documentation_not_applicable,
        commands::void_sale,
        commands::update_product,
        commands::product_categories,
        commands::save_category,
        commands::delete_category,
        commands::assign_category,
        commands::remove_product_category,
        commands::reference_kinds,
        commands::add_reference_kind,
        commands::archive_reference_kind,
        commands::report_catalog,
        commands::report,
        commands::save_report_file,
        commands::launch_company,
        commands::open_new_window,
        commands::set_window_title,
        commands::promotions,
        commands::save_promotion,
        commands::set_promotion_active,
        commands::delete_promotion,
        commands::shipments,
        commands::save_shipment,
        ml::ml_status,
        ml::ml_save_app,
        ml::ml_connect,
        ml::ml_wait,
        ml::ml_finish,
        ml::ml_disconnect,
        ml::ml_sync,
        ml::ml_orders,
        ml::ml_register_manual,
        ml::ml_link_item,
        quotedoc::quote_doc_settings,
        quotedoc::save_quote_doc_settings,
        quotedoc::quote_numbering,
        quotedoc::quote_terms,
        quotedoc::save_quote_terms,
        quotedoc::save_quote_pdf,
        sync::sync_status,
        sync::sync_enable,
        sync::sync_pair_start,
        sync::sync_pair_cancel,
        sync::sync_revoke,
        sync::sync_join,
        sync::sync_now,
        access::accesses,
        access::save_access,
        access::delete_access,
        access::signing_key_status,
        access::save_signing_key,
        access::delete_signing_key,
        woo::woo_status,
        woo::woo_connect,
        woo::woo_disconnect,
        woo::woo_sync,
        woo::woo_orders,
        woo::woo_push,
        woo::woo_catalog,
        woo::woo_save_equivalence,
        mail::mail_status,
        mail::mail_presets,
        mail::mail_save,
        mail::mail_disconnect,
        mail::mail_templates,
        mail::mail_save_templates,
        mail::mail_draft,
        mail::mail_send,
        mail::mail_test,
        mail::mail_log,
        wsp::wsp_status,
        wsp::wsp_save,
        wsp::wsp_disconnect,
        wsp::wsp_state,
        wsp::wsp_chats,
        wsp::wsp_conversation,
        wsp::wsp_send,
        auto::auto_run,
        auto::collect_round,
        auto::collect_save_settings,
        auto::collect_send,
        auto::digest_preview,
        auto::digest_save_settings,
        auto::digest_send,
        auto::sales_goal,
        auto::recurring_sales,
        auto::save_recurring_sale,
        auto::delete_recurring_sale,
        auto::recurring_run_now,
        auto::bank_rules,
        auto::save_bank_rule,
        auto::delete_bank_rule,
        auto::serials,
        auto::save_serial,
        auto::add_serials,
        auto::assign_serials,
        auto::release_serial,
        auto::delete_serial,
        auto::sii_start_import,
        sii::sii_status,
        sii::sii_save_setup,
        sii::sii_load_certificate,
        sii::sii_load_caf,
        sii::sii_test_connection,
        sii::sii_issue,
        sii::sii_documents,
        sii::sii_send,
        sii::sii_check,
        sii::sii_export_xml,
        sii::sii_libro_create,
        sii::sii_libros,
        sii::sii_libro_send,
        sii::sii_libro_check,
        sii::sii_libro_export_xml,
        sii::sii_document_print,
        sii::sii_intercambio_leer,
        sii::sii_intercambio_responder,
        sii::sii_sale_draft,
        commands::pending_dispatches,
        commands::dispatch_items,
        commands::warehouse_stock,
        commands::customer_credit,
        commands::save_credit_doc,
        commands::export_customer_folder,
        commands::update_customer,
        commands::search_suppliers,
        commands::supplier,
        commands::add_supplier,
        commands::update_supplier,
        commands::price_history,
        commands::list_purchase_orders,
        commands::purchase_order,
        commands::save_purchase_order,
        commands::issue_purchase_order,
        commands::void_purchase_order,
        commands::receive_purchase_order,
        commands::list_purchases,
        commands::purchase,
        commands::register_purchase,
        commands::pay_purchase,
        commands::void_purchase,
        commands::inventory_settings,
        commands::update_inventory_settings,
        commands::warehouses,
        commands::create_warehouse,
        commands::rename_warehouse,
        commands::set_default_warehouse,
        commands::archive_warehouse,
        commands::adjust_stock,
        commands::add_stock,
        commands::transfer_stock,
        commands::stock_documents,
        commands::inventory_overview,
        commands::product_inventory,
        commands::update_reorder_settings,
        commands::money_accounts,
        commands::create_money_account,
        commands::update_money_account,
        commands::archive_money_account,
        commands::account_ledger,
        commands::transfer_money,
        commands::expense_categories,
        commands::add_expense_category,
        commands::expense_categories_all,
        commands::save_expense_category,
        commands::expense_insights,
        commands::list_expenses,
        commands::expense,
        commands::register_expense,
        commands::pay_expense,
        commands::void_expense,
        commands::recurring,
        commands::save_recurring,
        commands::money_overview,
        commands::money_calendar,
        commands::dashboard,
        commands::alerts,
        commands::import_bank_statement,
        commands::bank_reconciliation,
        commands::reconcile_bank_line,
        commands::auto_reconcile_bank,
        commands::delete_bank_statement,
        commands::ledger_accounts,
        commands::save_ledger_account,
        commands::accounting_map,
        commands::update_accounting_map,
        commands::journal,
        commands::accounting_periods,
        commands::close_period,
        commands::reopen_period,
        commands::add_manual_entry,
        commands::reverse_manual_entry,
        commands::alert_settings,
        commands::update_alert_settings,
        commands::product_insights,
        commands::product_trend,
        commands::customer_insights,
        commands::incoterms,
        commands::list_imports,
        commands::import,
        commands::save_import,
        commands::set_import_stage,
        commands::change_import_eta,
        commands::add_import_cost,
        commands::update_import_cost,
        commands::remove_import_cost,
        commands::pay_import_cost,
        commands::receive_import,
        commands::close_import,
        commands::void_import,
        commands::set_business_logo,
        commands::tax_profile,
        commands::save_tax_profile,
        commands::f29,
        commands::save_f29_inputs,
        commands::import_rcv,
        commands::clear_rcv,
        commands::add_tax_document,
        commands::delete_tax_document,
        commands::set_tax_document_kind,
        commands::mark_f29_declared,
        commands::reopen_f29,
        commands::workers,
        commands::save_worker,
        commands::payroll_indicators,
        commands::save_payroll_indicators,
        commands::payroll,
        commands::payslip,
        commands::payslip_by_id,
        commands::save_payslip,
        commands::emit_payslip,
        commands::void_payslip,
        commands::discard_payslip,
        commands::payroll_settings,
        commands::save_payroll_settings,
        commands::previred,
        commands::lre,
        commands::export_lre,
        commands::severance,
        commands::f22,
        commands::save_f22_inputs,
        browser::browser_info,
        browser::browser_save_settings,
        browser::browser_grant,
        browser::browser_open,
        browser::browser_state,
        browser::browser_read,
        browser::browser_act,
        browser::browser_save_file,
        browser::browser_login,
        browser::browser_sign,
        browser::browser_close,
        agent::agent_settings,
        agent::agent_update,
        agent::agent_reply,
        agent::agent_connect_claude,
    ])
}

fn main() {
    // `nucleo-erp --mcp`: puente para la app de Claude (no abre ventana).
    if std::env::args().any(|a| a == "--mcp") {
        agent::bridge::run();
        return;
    }
    with_commands(tauri::Builder::default())
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
            let agent = std::sync::Arc::new(agent::AgentState::load(&data_dir));
            agent.apply(app.handle());
            app.manage(agent);
            app.manage(browser::BrowserState::default());
            app.manage(commands::AppState {
                service: Mutex::new(service),
                session: std::sync::Arc::new(Mutex::new(None)),
                sync: Mutex::new(None),
                backups_dir,
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar NÚCLEO ERP")
        .run(|app, event| match event {
            // Al cerrar: apaga el acceso para Claude y borra su archivo de conexión.
            tauri::RunEvent::Exit => {
                if let Some(agent) = app.try_state::<std::sync::Arc<agent::AgentState>>() {
                    agent.shutdown();
                }
            }
            // El navegador de NÚCLEO no queda abierto sin la ventana principal.
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } if label == "main" => browser::close(app),
            _ => {}
        });
}
