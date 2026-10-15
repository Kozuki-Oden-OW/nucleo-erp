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

    // Categorías: las iniciales, crear, asignar en lote, renombrar y eliminar.
    let cats = ipc.ok("product_categories", json!({}));
    assert_eq!(cats.as_array().unwrap().len(), 6);
    let cats = ipc.ok(
        "save_category",
        json!({ "uid": null, "name": "Herramientas" }),
    );
    let herr = cats
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "Herramientas")
        .unwrap()["uid"]
        .as_str()
        .unwrap()
        .to_string();
    let cats = ipc.ok(
        "assign_category",
        json!({ "productUids": [prod], "categoryUid": herr }),
    );
    let c = cats
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["uid"] == herr.as_str())
        .unwrap()
        .clone();
    assert_eq!(c["product_count"], 1);
    ipc.ok(
        "save_category",
        json!({ "uid": herr, "name": "Herramientas manuales" }),
    );
    let p = ipc.ok("update_product", json!({ "uid": prod, "patch": { "name": "Martillo 16 oz", "sku": "MAR-16", "unit": "un", "price_minor": 11990, "taxable": true, "min_milli": 2000, "category_uid": herr } }));
    assert_eq!(p["category"], "Herramientas manuales");
    ipc.ok("delete_category", json!({ "uid": herr }));
    // Servicio con costo avanzado: se fija y se puede corregir (no tiene stock).
    let srv = ipc.ok("add_product", json!({ "input": { "name": "Mapeo térmico", "kind": "servicio", "price_minor": 350000,
        "cost_sheet": { "labor_minor": 120000, "shipping_minor": 23800, "pesos_include_tax": true, "units_milli": 1000 } } }));
    // La empresa de prueba usa una tasa de 10 %: 120.000 + 23.800 / 1,10.
    assert_eq!(srv["cost_e4"], 1_416_360_000);
    assert_eq!(srv["cost_sheet"]["labor_minor"], 120000);

    // Análisis y reportes: todos se arman y la venta efectuada aparece.
    let cat = ipc.ok("report_catalog", json!({}));
    let ids: Vec<String> = cat
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap().to_string())
        .collect();
    assert!(ids.len() >= 13);
    for id in &ids {
        let r = ipc.ok(
            "report",
            json!({ "params": { "id": id, "from": "2026-01-01", "to": HOY, "group": null } }),
        );
        assert_eq!(
            r["rows"].as_array().unwrap().len(),
            r["links"].as_array().unwrap().len(),
            "{id}"
        );
    }
    // La venta se emite con la fecha del día en que corre la prueba.
    let r = ipc.ok(
        "report",
        json!({ "params": { "id": "ventas_cliente", "from": "2026-01-01", "to": "2035-12-31" } }),
    );
    assert_eq!(r["rows"].as_array().unwrap().len(), 1);
    let r = ipc.ok("report", json!({ "params": { "id": "ventas_periodo", "from": "2026-01-01", "to": "2035-12-31", "group": "dia" } }));
    assert_eq!(r["totals"][1], 1);
    // Ficha completa del cliente y condiciones de la factura interna, con los nombres de la interfaz.
    let c2 = ipc.ok("add_customer", json!({ "input": { "name": "Clínica Sur SpA", "kind": "empresa", "business_activity": "Salud",
        "commune": "Frutillar", "payment_terms_days": 30, "credit_limit_minor": null } }));
    assert_eq!(c2["business_activity"], "Salud");
    assert_eq!(c2["payment_terms_days"], 30);
    let fv2 = ipc.ok("save_sale", json!({ "input": { "doc_type": "FV", "customer_uid": c2["uid"], "issue_date": HOY, "lines": [line],
        "terms": { "payment": "credito", "credit_days": 30, "due_date": null, "card": null, "bank": null, "transfer_date": null, "operation": null,
            "references": [{ "kind": "801", "folio": "4500012345", "date": HOY, "note": null }],
            "receiver": { "name": "Clínica Sur SpA", "activity": "Salud", "commune": "Frutillar", "rut": null, "trade_name": null, "address": null,
                "city": null, "region": null, "email": null, "phone": null, "contact": null } } }, "uid": null }));
    assert_eq!(fv2["terms"]["references"][0]["folio"], "4500012345");
    assert_eq!(fv2["terms"]["due_date"], "2026-11-05");
    // Tipos de referencia: Mercado Libre de serie y uno propio.
    let kinds = ipc.ok("add_reference_kind", json!({ "label": "Falabella" }));
    assert!(kinds.as_array().unwrap().iter().any(|k| k["code"] == "ML"));
    let fala = kinds
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["label"] == "Falabella")
        .unwrap()
        .clone();
    assert_eq!(fala["code"], "C:Falabella");
    assert!(
        ipc.call("add_reference_kind", json!({ "label": "falabella" }))
            .is_err(),
        "nombre repetido"
    );
    let v3 = ipc.ok("save_sale", json!({ "input": { "doc_type": "VEN", "customer_uid": null, "issue_date": HOY, "lines": [line],
        "terms": { "payment": "", "references": [{ "kind": "C:Falabella", "folio": "FAL-889", "date": null, "note": null },
            { "kind": "ML", "folio": "2000012345", "date": null, "note": null }] } }, "uid": null }));
    assert_eq!(v3["terms"]["references"][0]["kind"], "C:Falabella");
    let kinds = ipc.ok("archive_reference_kind", json!({ "id": fala["custom_id"] }));
    assert!(
        !kinds
            .as_array()
            .unwrap()
            .iter()
            .any(|k| k["label"] == "Falabella")
    );

    // Crédito: se habilita en la ficha y se respalda con documentos opcionales.
    ipc.ok("update_customer", json!({ "uid": c2["uid"], "input": { "name": "Clínica Sur SpA", "kind": "empresa",
        "credit_enabled": true, "payment_terms_days": 30, "credit_limit_minor": 1000000, "credit_conditions": "Pagaré firmado" } }));
    let cr = ipc.ok("customer_credit", json!({ "uid": c2["uid"] }));
    assert_eq!(cr["enabled"], true);
    assert_eq!(cr["docs"].as_array().unwrap().len(), 7);
    let cr = ipc.ok(
        "save_credit_doc",
        json!({ "uid": c2["uid"], "kind": "carpeta_tributaria",
        "input": { "status": "verificado", "issued_on": HOY, "verified_on": HOY, "note": "OK" } }),
    );
    assert_eq!(cr["docs_ready"], 1);
    let out = tempfile::tempdir().unwrap();
    let ex = ipc.ok(
        "export_customer_folder",
        json!({ "uid": c2["uid"], "path": out.path().to_str().unwrap() }),
    );
    assert_eq!(ex["files"], 0);
    assert!(
        std::path::Path::new(ex["folder"].as_str().unwrap())
            .join("Crédito")
            .is_dir()
    );

    // Reservas: se aparta lo que hay, lo que falta queda por despachar y se despacha después.
    let rp = ipc.ok(
        "add_product",
        json!({ "input": { "name": "Tlog 10E", "kind": "producto", "price_minor": 32900,
        "cost_minor": 23000, "initial_stock_milli": 1000, "stock_policy": "reservar" } }),
    );
    assert_eq!(rp["stock_policy"], "reservar");
    let rl = json!({ "product_uid": rp["uid"], "description": "Tlog 10E", "qty_milli": 3000, "unit_price_minor": 32900, "discount_ppm": 0, "taxable": true });
    let rv = ipc.ok("save_sale", json!({ "input": { "doc_type": "VEN", "customer_uid": c2["uid"], "issue_date": HOY, "lines": [rl] }, "uid": null }));
    let rv = ipc.ok("effect_sale", json!({ "uid": rv["uid"], "input": { "mode": "contado", "method": "Efectivo", "due_date": null } }));
    assert_eq!(rv["dispatch"][0]["reserved_milli"], 1000);
    assert_eq!(rv["dispatch"][0]["missing_milli"], 2000);
    let pend = ipc.ok("pending_dispatches", json!({}));
    let did = pend[0]["id"].clone();
    let pend = ipc.ok(
        "dispatch_items",
        json!({ "id": did, "qtyMilli": 1000, "date": null }),
    );
    assert_eq!(pend[0]["pending_milli"], 2000);
    let wh = ipc.ok("warehouses", json!({}))[0]["uid"].clone();
    let st = ipc.ok("warehouse_stock", json!({ "warehouseUid": wh }));
    assert!(
        st.as_array()
            .unwrap()
            .iter()
            .any(|r| r["product"]["uid"] == rp["uid"] && r["on_hand_milli"] == 0)
    );

    // Promociones y envíos con los nombres de la interfaz.
    let pr = ipc.ok("save_promotion", json!({ "uid": null, "input": { "name": "3x2 Tlog", "kind": "lleva_paga",
        "rule": { "items": [{ "product_uid": rp["uid"], "qty_milli": 0 }], "buy": 3, "pay": 2 } } }));
    assert_eq!(pr[0]["status"], "activa");
    assert_eq!(pr[0]["products"][0]["name"], "Tlog 10E");
    let en = ipc.ok(
        "save_shipment",
        json!({ "uid": null, "input": { "sale_uid": rv["uid"], "carrier": "Starken",
        "tracking": "998877", "first_name": "Ana", "status": "en_camino" } }),
    );
    assert_eq!(en["status"], "en_camino");
    assert_eq!(
        ipc.ok("shipments", json!({ "saleUid": rv["uid"] }))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Color por empresa (y la ventana sin empresa de lanzamiento).
    let b = ipc.ok("update_business", json!({ "patch": { "accent": "verde" } }));
    assert_eq!(b["accent"], "verde");
    assert!(
        ipc.call(
            "update_business",
            json!({ "patch": { "accent": "fucsia" } })
        )
        .is_err()
    );
    assert!(ipc.ok("launch_company", json!({})).is_null());

    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("ventas.csv");
    ipc.ok("save_report_file", json!({ "reportId": "ventas_cliente", "path": dest.to_str().unwrap(), "bytes": [65, 59, 66] }));
    assert_eq!(std::fs::read(&dest).unwrap(), b"A;B");
    let bad = dir.path().join("x.exe");
    assert!(
        ipc.call(
            "save_report_file",
            json!({ "reportId": "ventas_cliente", "path": bad.to_str().unwrap(), "bytes": [1] })
        )
        .is_err()
    );
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

#[test]
fn ciclo_de_compra_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Ferretería Compras", "profile": "negocio" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let p = ipc.ok("add_product", json!({ "input": { "name": "Cemento", "unit": "un", "kind": "producto", "price_minor": 6000, "cost_minor": 4000 } }));
    let prod = p["uid"].as_str().unwrap().to_string();
    let s = ipc.ok(
        "add_supplier",
        json!({ "input": { "name": "Cementos del Sur", "payment_terms_days": 15 } }),
    );
    let sup = s["uid"].as_str().unwrap().to_string();
    ipc.ok("update_supplier", json!({ "uid": sup, "input": { "name": "Cementos del Sur SpA", "payment_terms_days": 30 } }));
    assert_eq!(
        ipc.ok("search_suppliers", json!({ "query": "cementos" }))
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let line = json!({ "product_uid": prod, "description": "Cemento", "qty_milli": 10000, "unit_cost_minor": 4200, "taxable": true });
    let o = ipc.ok("save_purchase_order", json!({ "input": { "supplier_uid": sup, "issue_date": HOY, "expected_date": null, "lines": [line] }, "uid": null }));
    let ouid = o["uid"].as_str().unwrap().to_string();
    ipc.ok("issue_purchase_order", json!({ "uid": ouid }));
    let o = ipc.ok(
        "receive_purchase_order",
        json!({ "uid": ouid, "lines": [{ "line_no": 1, "qty_milli": 10000 }], "date": HOY }),
    );
    assert_eq!(o["status"], "recibida");
    assert_eq!(
        ipc.ok("list_purchase_orders", json!({ "query": null }))
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let c = ipc.ok("register_purchase", json!({ "input": {
        "supplier_uid": sup, "doc_kind": "Factura", "doc_number": "77", "issue_date": HOY, "due_date": null,
        "order_uid": ouid, "receive_stock": false, "lines": [line], "paid_method": null
    } }));
    assert_eq!(c["due_date"], "2026-11-05");
    let cuid = c["uid"].as_str().unwrap().to_string();
    let c = ipc.ok(
        "pay_purchase",
        json!({ "uid": cuid, "amountMinor": 42000, "method": "Transferencia", "date": HOY }),
    );
    assert_eq!(c["payment_state"], "pagada");
    assert_eq!(
        ipc.ok(
            "list_purchases",
            json!({ "filter": { "query": null, "view": "todas" } })
        )
        .as_array()
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        ipc.ok("price_history", json!({ "productUid": prod }))
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        ipc.ok("supplier", json!({ "uid": sup }))["purchases_count"],
        1
    );
    ipc.ok("purchase", json!({ "uid": cuid }));
    let c = ipc.ok("void_purchase", json!({ "uid": cuid, "reason": "Prueba" }));
    assert_eq!(c["status"], "anulada");
    let o2 = ipc.ok("save_purchase_order", json!({ "input": { "supplier_uid": sup, "issue_date": HOY, "expected_date": "2026-10-20", "lines": [line], "notes": "x" }, "uid": null }));
    let o2 = ipc.ok(
        "void_purchase_order",
        json!({ "uid": o2["uid"], "reason": "No va" }),
    );
    assert_eq!(o2["status"], "anulada");
    ipc.ok("purchase_order", json!({ "uid": ouid }));
}

#[test]
fn inventario_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Ferretería Stock", "profile": "empresa" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let p = ipc.ok("add_product", json!({ "input": { "name": "Tornillo", "unit": "un", "kind": "producto", "price_minor": 100, "cost_minor": 40, "initial_stock_milli": 50000 } }));
    let prod = p["uid"].as_str().unwrap().to_string();
    let ws = ipc.ok("create_warehouse", json!({ "name": "Sucursal centro" }));
    let main = ws
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["is_default"] == true)
        .unwrap()["uid"]
        .clone();
    let other = ws
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["is_default"] == false)
        .unwrap()["uid"]
        .clone();
    ipc.ok(
        "rename_warehouse",
        json!({ "uid": other, "name": "Sucursal Centro" }),
    );
    let t = ipc.ok("transfer_stock", json!({ "input": { "from_uid": main, "to_uid": other, "date": HOY, "notes": null, "lines": [{ "product_uid": prod, "qty_milli": 10000 }] } }));
    assert_eq!(t["number"], "TRA-000001");
    let a = ipc.ok("adjust_stock", json!({ "input": { "warehouse_uid": main, "date": HOY, "kind": "conteo", "reason": "Conteo", "lines": [{ "product_uid": prod, "qty_milli": 39000 }] } }));
    assert_eq!(a["moved_lines"], 1);
    let g = ipc.ok("add_stock", json!({ "input": { "warehouse_uid": main, "date": HOY, "supplier_uid": null, "reference": "Factura 77", "notes": null, "lines": [{ "product_uid": prod, "qty_milli": 5000, "unit_cost_minor": 1200 }] } }));
    assert_eq!(g["number"], "ING-000001");
    assert_eq!(
        ipc.ok("stock_documents", json!({}))
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let inv = ipc.ok(
        "product_inventory",
        json!({ "uid": prod, "warehouseUid": null }),
    );
    assert_eq!(inv["product"]["on_hand_milli"], 54000);
    assert_eq!(inv["kardex"].as_array().unwrap().len(), 5);
    assert!(
        inv["kardex"]
            .as_array()
            .unwrap()
            .iter()
            .any(|k| k["document"] == "ING-000001" && k["unit_cost_e4"] == 12_000_000)
    );
    let inv = ipc.ok(
        "product_inventory",
        json!({ "uid": prod, "warehouseUid": other }),
    );
    assert_eq!(inv["kardex"].as_array().unwrap().len(), 1);
    ipc.ok("update_reorder_settings", json!({ "uid": prod, "input": { "min_milli": 5000, "safety_days": 5, "target_coverage_days": 20, "excess_coverage_days": 200, "lead_time_days": 3 } }));
    let o = ipc.ok("inventory_overview", json!({}));
    assert_eq!(o["rows"].as_array().unwrap().len(), 1);
    assert_eq!(
        ipc.ok(
            "update_inventory_settings",
            json!({ "settings": { "allow_negative": false } })
        )["allow_negative"],
        false
    );
    assert_eq!(
        ipc.ok("inventory_settings", json!({}))["allow_negative"],
        false
    );
    ipc.ok("set_default_warehouse", json!({ "uid": other }));
    assert!(
        ipc.call("archive_warehouse", json!({ "uid": main }))
            .is_err(),
        "tiene stock"
    );
    assert_eq!(ipc.ok("warehouses", json!({})).as_array().unwrap().len(), 2);
}

#[test]
fn dinero_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Almacén Caja", "profile": "negocio" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let accs = ipc.ok("create_money_account", json!({ "input": { "kind": "banco", "name": "Cuenta corriente", "bank_name": "Banco Ejemplo", "account_label": "CC ···· 4821", "opening_minor": 500000, "opening_date": HOY } }));
    let banco = accs
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "banco")
        .unwrap()["uid"]
        .clone();
    assert!(
        ipc.call("create_money_account", json!({ "input": { "kind": "banco", "name": "Otra", "bank_name": null, "account_label": "1234567890123", "opening_minor": 0, "opening_date": null } }))
            .is_err(),
        "no se guardan números de cuenta completos"
    );
    let cats = ipc.ok("expense_categories", json!({}));
    let luz = cats
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "Electricidad")
        .unwrap()["id"]
        .clone();
    let g = ipc.ok("register_expense", json!({ "input": { "category_id": luz, "supplier_uid": null, "date": HOY, "description": "Cuenta de luz", "total_minor": 119000, "tax_included": false, "due_date": "2026-10-20", "paid_method": null, "paid_account_uid": null, "recurring_id": null } }));
    assert_eq!(g["payment_state"], "por_pagar");
    let uid = g["uid"].clone();
    let g = ipc.ok("pay_expense", json!({ "uid": uid, "amountMinor": 119000, "method": "Transferencia", "date": HOY, "accountUid": banco }));
    assert_eq!(g["payment_state"], "pagado");
    let ledger = ipc.ok("account_ledger", json!({ "uid": banco }));
    assert_eq!(ledger[0]["amount_minor"], -119000);
    assert_eq!(
        ledger[0]["link"],
        format!("/dinero/gasto/{}", uid.as_str().unwrap())
    );
    let accs = ipc.ok("create_money_account", json!({ "input": { "kind": "caja", "name": "Caja", "bank_name": null, "account_label": null, "opening_minor": 0, "opening_date": null } }));
    let caja = accs
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "caja")
        .unwrap()["uid"]
        .clone();
    let accs = ipc.ok("transfer_money", json!({ "input": { "from_uid": banco, "to_uid": caja, "date": HOY, "amount_minor": 81000, "notes": null } }));
    let bal = |kind: &str| {
        accs.as_array()
            .unwrap()
            .iter()
            .find(|a| a["kind"] == kind)
            .unwrap()["balance_minor"]
            .as_i64()
            .unwrap()
    };
    assert_eq!(bal("banco"), 300000);
    assert_eq!(bal("caja"), 81000);
    let rec = ipc.ok("save_recurring", json!({ "input": { "id": null, "direction": "egreso", "description": "Arriendo", "category_id": null, "amount_minor": 400000, "frequency": "mensual", "day_of_period": 5, "starts_on": HOY, "ends_on": null, "active": true } }));
    assert_eq!(rec.as_array().unwrap().len(), 1);
    let ov = ipc.ok("money_overview", json!({}));
    assert_eq!(ov["cash_minor"], 381000);
    assert_eq!(ov["projection"].as_array().unwrap().len(), 13);
    assert!(
        !ipc.ok("money_calendar", json!({ "days": 60 }))
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        ipc.ok("list_expenses", json!({ "filter": { "query": "luz" } }))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Gastos: cantidad × valor, categorías con grupo y presupuesto, y análisis.
    let comb = ipc
        .ok("expense_categories", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "Combustible")
        .unwrap()["id"]
        .clone();
    let b = ipc.ok("register_expense", json!({ "input": { "category_id": comb, "supplier_uid": null, "date": HOY, "description": "Bencina 93", "total_minor": 0, "quantity_milli": 40000, "unit_minor": 1290, "tax_included": false, "due_date": null, "paid_method": "Efectivo", "paid_account_uid": null, "recurring_id": null } }));
    assert_eq!(b["total_minor"], 51600);
    assert_eq!(b["quantity_milli"], 40000);
    let all = ipc.ok("save_expense_category", json!({ "input": { "id": comb, "name": "Combustible", "fixed": false, "group_name": "Vehículo y transporte", "monthly_budget_minor": 80000, "archived": false } }));
    assert!(
        all.as_array()
            .unwrap()
            .iter()
            .any(|c| c["name"] == "Combustible" && c["monthly_budget_minor"] == 80000)
    );
    let ins = ipc.ok("expense_insights", json!({ "months": 6 }));
    assert!(
        ins["categories"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["name"] == "Combustible" && c["this_month_minor"] == 51600)
    );
    let g = ipc.ok("void_expense", json!({ "uid": uid, "reason": "Duplicado" }));
    assert_eq!(g["payment_state"], "anulado");
    assert_eq!(ipc.ok("dashboard", json!({}))["cash_minor"], 500000 - 51600);
}

#[test]
fn comex_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Importadora", "profile": "empresa" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let sup = ipc.ok(
        "add_supplier",
        json!({ "input": { "name": "Shenzhen Co." } }),
    );
    let p = ipc.ok("add_product", json!({ "input": { "name": "Sensor", "unit": "un", "kind": "producto", "price_minor": 9000, "cost_minor": 0 } }));
    assert_eq!(ipc.ok("incoterms", json!({})).as_array().unwrap().len(), 11);
    let d = ipc.ok("save_import", json!({ "uid": null, "input": {
        "supplier_uid": sup["uid"], "incoterm": "FOB", "transport_mode": "aereo", "origin_country": "China", "origin_port": null,
        "destination_port": null, "currency_code": "USD", "rate_e6": 900000000, "purchase_date": null, "production_eta": null,
        "shipment_date": null, "eta": HOY, "arrival_date": null, "allocation_basis": "valor", "vat_ppm": null, "vat_recoverable": true,
        "notes": null, "items": [{ "product_uid": p["uid"], "description": "Sensor", "qty_milli": 10000, "unit_price_minor": 1000,
        "weight_g": null, "volume_cm3": null, "duty_ppm": null, "hs_code": null }] } }));
    let uid = d["uid"].clone();
    assert_eq!(d["calc"]["landed_clp"], 90000);
    let d = ipc.ok("add_import_cost", json!({ "uid": uid, "input": { "kind": "flete", "description": null, "supplier_uid": null,
        "currency_code": "USD", "amount_minor": 2000, "rate_e6": null, "is_estimate": false, "allocation_basis": null,
        "document_ref": null, "cost_date": null, "payment": "por_pagar", "due_date": null, "paid_method": null, "paid_account_uid": null } }));
    assert_eq!(d["costs"][0]["amount_clp"], 18000);
    let cost_id = d["costs"][0]["id"].clone();
    ipc.ok("pay_import_cost", json!({ "uid": uid, "costId": cost_id, "amountMinor": 18000, "method": "Transferencia", "date": HOY, "accountUid": null }));
    ipc.ok(
        "set_import_stage",
        json!({ "uid": uid, "stage": "en_transito", "note": null }),
    );
    ipc.ok(
        "change_import_eta",
        json!({ "uid": uid, "eta": "2026-10-20", "reason": "Retraso" }),
    );
    let d = ipc.ok(
        "receive_import",
        json!({ "uid": uid, "lines": [], "date": HOY }),
    );
    assert_eq!(d["stage"], "recibida");
    let d = ipc.ok("close_import", json!({ "uid": uid }));
    assert_eq!(d["landed_total_clp"], 108000);
    assert_eq!(
        ipc.ok("list_imports", json!({ "view": "cerradas", "query": "" }))
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        ipc.call("void_import", json!({ "uid": uid, "reason": "x" }))
            .is_err()
    );
    let d2 = ipc.ok("save_import", json!({ "uid": null, "input": {
        "supplier_uid": null, "incoterm": null, "transport_mode": null, "origin_country": null, "origin_port": null,
        "destination_port": null, "currency_code": "CLP", "rate_e6": null, "purchase_date": null, "production_eta": null,
        "shipment_date": null, "eta": null, "arrival_date": null, "allocation_basis": "unidades", "vat_ppm": null, "vat_recoverable": true,
        "notes": null, "items": [{ "product_uid": null, "description": "Muestra", "qty_milli": 1000, "unit_price_minor": 5000,
        "weight_g": null, "volume_cm3": null, "duty_ppm": null, "hs_code": null }] } }));
    let d2 = ipc.ok("add_import_cost", json!({ "uid": d2["uid"], "input": { "kind": "otros", "description": "Courier", "supplier_uid": null,
        "currency_code": "CLP", "amount_minor": 1000, "rate_e6": null, "is_estimate": true, "allocation_basis": null,
        "document_ref": null, "cost_date": null, "payment": null, "due_date": null, "paid_method": null, "paid_account_uid": null } }));
    let d2 = ipc.ok("update_import_cost", json!({ "uid": d2["uid"], "costId": d2["costs"][0]["id"], "input": { "kind": "otros", "description": "Courier", "supplier_uid": null,
        "currency_code": "CLP", "amount_minor": 1500, "rate_e6": null, "is_estimate": true, "allocation_basis": null,
        "document_ref": null, "cost_date": null, "payment": null, "due_date": null, "paid_method": null, "paid_account_uid": null } }));
    assert_eq!(d2["calc"]["landed_clp"], 6500);
    let d2 = ipc.ok(
        "remove_import_cost",
        json!({ "uid": d2["uid"], "costId": d2["costs"][0]["id"], "reason": null }),
    );
    assert_eq!(
        ipc.ok(
            "void_import",
            json!({ "uid": d2["uid"], "reason": "Prueba" })
        )["stage"],
        "anulada"
    );
    assert_eq!(
        ipc.ok("import", json!({ "uid": d2["uid"] }))["costs"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn f29_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Comercial", "profile": "empresa" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let p = ipc.ok("save_tax_profile", json!({ "profile": { "regime": "14d3", "ppm_rate_ppm": 2500, "utm_decimals": null, "due_day": 20, "common_use_ppm": null } }));
    assert_eq!(p["regime"], "14d3");
    let csv = "Tipo Doc;Folio;Rut cliente;Razon Social;Fecha Docto;Monto Exento;Monto Neto;Monto IVA;Monto total\n33;10;1-9;Cliente;03/09/2026;0;100000;19000;119000\n";
    let r = ipc.ok("import_rcv", json!({ "period": "2026-09", "direction": "venta", "fileName": "RCV_VENTA.csv", "text": csv }));
    assert_eq!(r["rows"], 1);
    assert_eq!(r["view"]["result"]["codes"]["502"], 19000);
    let v = ipc.ok(
        "save_f29_inputs",
        json!({ "period": "2026-09", "inputs": { "manual": { "48": 1000 } } }),
    );
    assert_eq!(v["result"]["codes"]["91"], 19000 + 250 + 1000);
    let v = ipc.ok("add_tax_document", json!({ "period": "2026-09", "input": { "direction": "compra", "sii_type": 33, "folio": "5",
        "issue_date": null, "counterpart_rut": null, "counterpart_name": "Proveedor", "net_minor": 10000, "tax_minor": 1900 } }));
    let manual_id = v["docs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["origin"] == "manual")
        .unwrap()["id"]
        .clone();
    ipc.ok(
        "set_tax_document_kind",
        json!({ "id": manual_id, "kind": "activo_fijo" }),
    );
    let v = ipc.ok("f29", json!({ "period": "2026-09" }));
    assert_eq!(v["result"]["codes"]["525"], 1900);
    ipc.ok("delete_tax_document", json!({ "id": manual_id }));
    let v = ipc.ok(
        "mark_f29_declared",
        json!({ "period": "2026-09", "declared77": 0, "declared91": 20250, "folio": null }),
    );
    assert_eq!(v["status"], "declarado");
    let v = ipc.ok(
        "reopen_f29",
        json!({ "period": "2026-09", "reason": "corrección" }),
    );
    assert_eq!(v["status"], "borrador");
    let v = ipc.ok(
        "clear_rcv",
        json!({ "period": "2026-09", "direction": "venta" }),
    );
    assert_eq!(v["sources"][0]["source"], "nucleo");
    assert_eq!(ipc.ok("tax_profile", json!({}))["ppm_rate_ppm"], 2500);
}

#[test]
fn logo_del_negocio_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Con logo", "profile": "negocio" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    // PNG mínimo de 1×1 píxel.
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let b = ipc.ok("set_business_logo", json!({ "logo": png }));
    assert_eq!(b["logo"], png);
    assert_eq!(ipc.ok("business", json!({}))["logo"], png);
    let err = ipc
        .call(
            "set_business_logo",
            json!({ "logo": "data:image/png;base64,PHN2Zz4=" }),
        )
        .unwrap_err();
    assert!(err.to_string().contains("PNG"), "{err}");
    let b = ipc.ok("set_business_logo", json!({ "logo": null }));
    assert!(b["logo"].is_null());
}

#[test]
fn remuneraciones_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Con sueldo", "profile": "negocio" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let w = ipc.ok(
        "save_worker",
        json!({ "id": null, "input": {
        "rut": "12345678-5", "name": "Dueña", "is_owner": true, "position": null,
        "start_date": "2025-01-01", "end_date": null,
        "terms": { "contract": "sin_contrato", "base_salary": 1000000, "afp": "Uno" } } }),
    );
    assert_eq!(w["terms"]["health"], "fonasa");
    let id = w["id"].clone();
    // Indicadores mínimos (valores de la prueba, no normativos).
    let ind = ipc.ok("save_payroll_indicators", json!({ "period": "2026-09", "source": "prueba", "indicators": {
        "params": { "uf_e2": 4000000, "utm": 70000, "cap_pension_uf_e4": 900000, "cap_afc_uf_e4": 1350000,
            "health_ppm": 70000, "tax_brackets": [ { "up_to_utm_e4": 135000, "factor_ppm": 0 }, { "up_to_utm_e4": null, "factor_ppm": 40000, "rebate_utm_e4": 5400 } ] },
        "afp": [ { "name": "Uno", "rate_ppm": 100000 } ] } }));
    assert_eq!(ind["saved"], true);
    let v = ipc.ok("payslip", json!({ "workerId": id, "period": "2026-09" }));
    assert_eq!(v["result"]["complete"], true);
    assert_eq!(v["result"]["tax"], 0);
    let v = ipc.ok(
        "save_payslip",
        json!({ "workerId": id, "period": "2026-09", "month": { "advance": 100000 } }),
    );
    assert_eq!(v["status"], "borrador");
    let v = ipc.ok(
        "emit_payslip",
        json!({ "workerId": id, "period": "2026-09", "payDate": "2026-09-30" }),
    );
    assert_eq!(v["status"], "emitida");
    let p = ipc.ok("payroll", json!({ "period": "2026-09" }));
    assert_eq!(p["rows"][0]["status"], "emitida");
    let v = ipc.ok("void_payslip", json!({ "id": v["id"], "reason": "prueba" }));
    assert_eq!(v["status"], "anulada");
    let v = ipc.ok("payslip_by_id", json!({ "id": v["id"] }));
    assert_eq!(v["status"], "anulada");
    let v = ipc.ok(
        "discard_payslip",
        json!({ "workerId": id, "period": "2026-09" }),
    );
    assert_eq!(v["status"], "nueva");
    assert_eq!(ipc.ok("workers", json!({})).as_array().unwrap().len(), 1);
    assert_eq!(
        ipc.ok("payroll_indicators", json!({ "period": "2026-10" }))["from_period"],
        "2026-09"
    );
}

#[test]
fn f22_por_ipc() {
    let ipc = Ipc::new();
    let created = ipc.ok(
        "create_company",
        json!({ "name": "Renta", "profile": "negocio" }),
    );
    ipc.ok("open_company", json!({ "uid": created["company"]["uid"] }));
    let v = ipc.ok("f22", json!({ "year": 2025 }));
    assert_eq!(v["tax_year"], 2026);
    let v = ipc.ok("save_f22_inputs", json!({ "year": 2025, "inputs": {
        "params": { "idpc_rate_ppm": 125000 }, "extra": [ { "code": 1400, "amount": 1000000 } ] } }));
    assert_eq!(v["result"]["codes"]["20"], 125000);
    assert!(
        ipc.call(
            "save_f22_inputs",
            json!({ "year": 2025, "inputs": { "extra": [ { "code": 20, "amount": 1 } ] } })
        )
        .is_err()
    );
}
