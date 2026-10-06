//! Contrato IPC de punta a punta con el runtime simulado de Tauri: cada llamada usa exactamente
//! el nombre de comando y los argumentos que envía `src/data/tauri.ts` (camelCase incluido), y
//! pasa por los comandos reales, `nucleo-app` y una base cifrada en una carpeta temporal.

use crate::commands::AppState;
use nucleo_app::{AppService, MemoryKeyStore};
use serde_json::{Value, json};
use std::sync::Mutex;
use tauri::Manager;
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};

struct Ipc {
    _dir: tempfile::TempDir,
    webview: tauri::WebviewWindow<MockRuntime>,
    _app: tauri::App<MockRuntime>,
}

impl Ipc {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let app = crate::with_commands(mock_builder())
            .build(tauri::generate_context!())
            .unwrap();
        let service = AppService::open(dir.path(), Box::new(MemoryKeyStore::default())).unwrap();
        app.manage(AppState {
            service: Mutex::new(service),
            session: Mutex::new(None),
            backups_dir: dir.path().join("respaldos"),
        });
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        Ipc {
            _dir: dir,
            webview,
            _app: app,
        }
    }

    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.webview,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|b| b.deserialize::<Value>().unwrap())
    }

    fn ok(&self, cmd: &str, args: Value) -> Value {
        self.call(cmd, args.clone())
            .unwrap_or_else(|e| panic!("{cmd} {args} → {e}"))
    }
}

const HOY: &str = "2026-10-06";

#[test]
fn ciclo_de_venta_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Ferretería IPC", "profile": "negocio" }),
    );
    let uid = created["company"]["uid"].as_str().unwrap().to_string();
    let s = ipc.ok("open_company", json!({ "uid": uid }));
    assert_eq!(s["login_required"], false);

    // Tasa de EJEMPLO anotada por el usuario (no normativa).
    let b = ipc.ok(
        "update_business",
        json!({ "patch": { "tax_enabled": true, "tax_rate_user_ppm": 100000, "rut": "" } }),
    );
    assert_eq!(b["tax_rate_ppm"], 100000);

    let c = ipc.ok(
        "add_customer",
        json!({ "input": { "name": "Constructora Sur", "rut": "76.543.210-3" } }),
    );
    let cust = c["uid"].as_str().unwrap().to_string();
    let p = ipc.ok("add_product", json!({ "input": {
        "name": "Martillo", "unit": "un", "kind": "producto", "price_minor": 10000, "cost_minor": 6000, "initial_stock_milli": 10000
    } }));
    let prod = p["uid"].as_str().unwrap().to_string();
    assert_eq!(p["on_hand_milli"], 10000);
    assert_eq!(
        ipc.ok("search_products", json!({ "query": "mart" }))
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let line = json!({ "product_uid": prod, "description": "Martillo", "qty_milli": 3000, "unit_price_minor": 10000, "discount_ppm": 100000, "taxable": true });
    let q = ipc.ok(
        "save_quote",
        json!({ "input": {
        "customer_uid": cust, "issue_date": HOY, "valid_until": null, "lines": [line]
    }, "uid": null }),
    );
    assert_eq!(q["total_minor"], 29700);
    let quid = q["uid"].as_str().unwrap().to_string();
    ipc.ok(
        "set_quote_status",
        json!({ "uid": quid, "status": "enviada" }),
    );
    assert_eq!(
        ipc.ok("list_quotes", json!({ "query": null }))
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let v = ipc.ok("convert_quote", json!({ "uid": quid }));
    let vuid = v["uid"].as_str().unwrap().to_string();
    assert_eq!(v["quote_number"], "COT-000001");
    let v = ipc.ok("effect_sale", json!({ "uid": vuid, "input": { "mode": "credito", "method": "Efectivo", "due_date": "2026-11-05" } }));
    assert_eq!(v["commercial_state"], "efectuada");
    let v = ipc.ok(
        "register_payment",
        json!({ "uid": vuid, "amountMinor": 29700, "method": "Transferencia", "date": HOY }),
    );
    assert_eq!(v["payment_state"], "pagada");
    let v = ipc.ok(
        "mark_documented",
        json!({ "uid": vuid, "reference": { "doc_kind": "Factura", "external_number": "563" } }),
    );
    assert_eq!(v["commercial_state"], "cerrada");
    assert_eq!(v["external_ref"]["external_number"], "563");
    assert!(v["timeline"].as_array().unwrap().len() >= 4);

    let list = ipc.ok(
        "list_sales",
        json!({ "filter": { "query": null, "view": "todas" } }),
    );
    assert_eq!(list.as_array().unwrap().len(), 1);
    let detail = ipc.ok("customer", json!({ "uid": cust }));
    assert_eq!(detail["revenue_minor"], 29700);
    assert_eq!(detail["recent"].as_array().unwrap().len(), 1);

    // Factura interna en borrador, editada y anulada.
    let fv = ipc.ok("save_sale", json!({ "input": { "doc_type": "FV", "customer_uid": null, "issue_date": HOY, "lines": [line] }, "uid": null }));
    let fuid = fv["uid"].as_str().unwrap().to_string();
    ipc.ok("save_sale", json!({ "input": { "doc_type": "FV", "customer_uid": cust, "issue_date": HOY, "lines": [line], "notes": "Retira en tienda" }, "uid": fuid }));
    let fv = ipc.ok("void_sale", json!({ "uid": fuid, "reason": "Duplicada" }));
    assert_eq!(fv["commercial_state"], "anulada");
    ipc.ok("set_documentation_not_applicable", json!({ "uid": vuid }));

    ipc.ok("update_product", json!({ "uid": prod, "patch": { "name": "Martillo 16 oz", "sku": "MAR-16", "unit": "un", "price_minor": 11990, "taxable": true, "min_milli": 2000 } }));
    ipc.ok(
        "update_customer",
        json!({ "uid": cust, "input": { "name": "Constructora Sur Ltda." } }),
    );
    assert!(
        !ipc.ok("global_search", json!({ "query": "MAR-16" }))
            .as_array()
            .unwrap()
            .is_empty()
    );

    // Argumentos en camelCase de la Fase 4.
    ipc.ok(
        "update_sequence",
        json!({ "docType": "VEN", "prefix": "V", "nextNumber": 100, "width": 5 }),
    );
    ipc.ok(
        "set_rate",
        json!({ "currency": "USD", "date": HOY, "rateE6": 950_250_000i64, "note": null }),
    );
    let audit = ipc.ok("audit_log", json!({ "query": "", "beforeId": null }));
    assert!(!audit.as_array().unwrap().is_empty());
    assert_eq!(ipc.ok("verify_audit", json!({}))["ok"], true);

    // Los errores llegan con código estable y mensaje para la persona.
    let e = ipc
        .call(
            "register_payment",
            json!({ "uid": vuid, "amountMinor": 1, "method": "Efectivo", "date": HOY }),
        )
        .unwrap_err();
    assert_eq!(e["code"], "validacion");
    assert!(
        e["message"]
            .as_str()
            .unwrap()
            .starts_with(char::is_uppercase)
    );
}
