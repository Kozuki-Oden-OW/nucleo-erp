//! Mercado Libre: los pedidos pagados pasan a ventas que descuentan stock, sin duplicar; lo que no
//! calza queda por revisar; los que piden factura quedan como factura con receptor; una cancelación
//! posterior solo se avisa. Mercado Libre se simula con respuestas de ejemplo.

use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::ml_ops::{self, HttpError, MlHttp, Tokens};
use nucleo_app::sales_ops::{NewProduct, SaleFilter};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use serde_json::{Value, json};
use std::cell::RefCell;

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    // Tasa de EJEMPLO anotada por el usuario (no es un valor normativo del código).
    s.update_business(&BusinessPatch {
        tax_rate_user_ppm: Some(190_000),
        ..Default::default()
    })
    .unwrap();
    (data, app, s)
}

fn product(s: &mut CompanySession, sku: &str, stock: i64) -> String {
    s.add_product(&NewProduct {
        sku: Some(sku.into()),
        name: format!("Producto {sku}"),
        unit: None,
        kind: "producto".into(),
        price_minor: 23_445,
        cost_minor: Some(17_100),
        taxable: Some(true),
        initial_stock_milli: Some(stock * 1000),
        category_uid: None,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap()
    .uid
}

fn stock(s: &CompanySession, sku: &str) -> i64 {
    s.search_products(sku, 5)
        .unwrap()
        .into_iter()
        .find(|p| p.sku == sku)
        .unwrap()
        .on_hand_milli
        / 1000
}

/// Mercado Libre de mentira: pedidos, facturación y costos por URL.
#[derive(Default)]
struct Fake {
    orders: RefCell<Vec<Value>>,
    billing: RefCell<Vec<(String, Value)>>,
    refreshed: RefCell<u32>,
}

impl MlHttp for Fake {
    fn get(&self, url: &str, token: &str) -> Result<Value, HttpError> {
        assert!(!token.is_empty());
        if url.contains("/orders/search") {
            let o = self.orders.borrow().clone();
            return Ok(json!({ "results": o, "paging": { "total": o.len() } }));
        }
        if let Some(rest) = url.split("/orders/").nth(1)
            && let Some(id) = rest.strip_suffix("/billing_info")
        {
            return self
                .billing
                .borrow()
                .iter()
                .find(|(k, _)| k == id)
                .map(|(_, v)| v.clone())
                .ok_or(HttpError::Status(404, "not found".into()));
        }
        if url.contains("/shipments/") {
            return Ok(json!({ "senders": [{ "cost": 3_000 }] }));
        }
        if url.ends_with("/users/me") {
            return Ok(json!({ "id": 123456, "nickname": "DATALOGGER" }));
        }
        Err(HttpError::Status(404, url.into()))
    }
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<Value, HttpError> {
        assert!(url.ends_with("/oauth/token"));
        assert!(
            form.iter()
                .any(|(k, v)| *k == "client_secret" && *v == "secreto")
        );
        *self.refreshed.borrow_mut() += 1;
        Ok(json!({ "access_token": "APP-nuevo", "refresh_token": "TG-nuevo", "expires_in": 21600 }))
    }
}

fn order(
    id: u64,
    pack: Option<u64>,
    status: &str,
    item: &str,
    sku: &str,
    qty: i64,
    price: f64,
) -> Value {
    json!({
        "id": id, "pack_id": pack, "status": status, "date_created": "2026-11-20T10:00:00.000-03:00",
        "total_amount": price * qty as f64,
        "buyer": { "id": 9, "nickname": "COMPRADOR1", "first_name": "Ana", "last_name": "Pérez" },
        "order_items": [{ "item": { "id": item, "title": format!("Publicación {item}"), "seller_sku": sku },
                          "quantity": qty, "unit_price": price, "sale_fee": 3_000.0 }],
        "payments": [{ "id": id + 1, "status": "approved", "shipping_cost": 0 }],
        "shipping": { "id": id + 2 }
    })
}

fn connect(s: &mut CompanySession, fake: &Fake) {
    s.ml_save_app("1234567890", "secreto", None).unwrap();
    let url = s.ml_auth_url(Some(49152)).unwrap();
    assert!(url.starts_with(
        "https://auth.mercadolibre.cl/authorization?response_type=code&client_id=1234567890"
    ));
    assert!(url.contains("code_challenge_method=S256") && url.contains("state=49152."));
    let state = url
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_string();
    assert!(s.ml_check_state(Some("otro")).is_err());
    let cfg = s.ml_check_state(Some(&state)).unwrap();
    let t = ml_ops::exchange_code(fake, &cfg, "TG-codigo").unwrap();
    let (id, nick) = ml_ops::me(fake, &t.access_token).unwrap();
    let st = s.ml_connected(&t, &id, nick.as_deref()).unwrap();
    assert!(st.connected && st.nickname.as_deref() == Some("DATALOGGER"));
    // La interfaz nunca recibe la clave ni los tokens.
    let shown = serde_json::to_string(&st).unwrap();
    assert!(!shown.contains("secreto") && !shown.contains("APP-nuevo"));
}

fn sync(s: &mut CompanySession, fake: &Fake) -> ml_ops::MlSyncReport {
    let mut plan = s.ml_sync_plan(Some("2026-11-01")).unwrap();
    let orders = ml_ops::fetch(fake, &mut plan).unwrap();
    s.ml_apply(&plan, &orders).unwrap()
}

#[test]
fn pedidos_pasan_a_ventas_sin_duplicar() {
    let (_d, _app, mut s) = session();
    product(&mut s, "P-00004", 10);
    let fake = Fake::default();
    connect(&mut s, &fake);
    fake.orders.borrow_mut().push(order(
        2_000_001, None, "paid", "MLC1", "P-00004", 2, 27_900.0,
    ));

    let r = sync(&mut s, &fake);
    assert_eq!((r.imported, r.to_review), (1, 0), "{:?}", r.messages);
    assert_eq!(stock(&s, "P-00004"), 8, "descuenta stock");
    let sales = s
        .list_sales(&SaleFilter {
            query: None,
            view: Some("todas".into()),
        })
        .unwrap();
    let sale = s.sale(&sales[0].uid).unwrap();
    // Precio con IVA → neto por unidad (23.445); el total puede diferir en un peso por redondeo.
    assert!(
        (sale.summary.total_minor - 55_800).abs() <= 2,
        "{}",
        sale.summary.total_minor
    );
    assert_eq!(sale.summary.payment_state, "pagada");
    assert_eq!(sale.terms.as_ref().unwrap().references[0].kind, "ML");
    assert_eq!(sale.terms.as_ref().unwrap().references[0].folio, "2000001");

    let o = &s.ml_orders(None).unwrap()[0];
    assert_eq!(
        (
            o.total_minor,
            o.sale_fee_minor,
            o.shipping_cost_minor,
            o.net_minor
        ),
        (55_800, 6_000, 3_000, 46_800)
    );

    // Otra vez: no duplica.
    let r = sync(&mut s, &fake);
    assert_eq!((r.imported, r.unchanged), (0, 1));
    assert_eq!(stock(&s, "P-00004"), 8);
    assert_eq!(
        s.list_sales(&SaleFilter {
            query: None,
            view: Some("todas".into())
        })
        .unwrap()
        .len(),
        1
    );

    // Cancelado después: solo aviso.
    fake.orders.borrow_mut()[0]["status"] = json!("cancelled");
    let r = sync(&mut s, &fake);
    assert_eq!(r.cancelled, 1);
    assert_eq!(s.ml_orders(None).unwrap()[0].status, "cancelada");
    assert!(
        s.ml_orders(None).unwrap()[0]
            .issue
            .as_deref()
            .unwrap()
            .contains("anula la venta")
    );
    assert_eq!(stock(&s, "P-00004"), 8, "NÚCLEO no anula solo");
}

#[test]
fn publicacion_sin_producto_queda_por_revisar_y_se_completa_al_enlazar() {
    let (_d, _app, mut s) = session();
    let uid = product(&mut s, "RC-17N", 50);
    let fake = Fake::default();
    connect(&mut s, &fake);
    fake.orders.borrow_mut().push(order(
        3_000_001,
        Some(9_000),
        "paid",
        "MLC9",
        "SIN-SKU",
        3,
        9_900.0,
    ));
    fake.orders.borrow_mut().push(order(
        3_000_002,
        Some(9_000),
        "paid",
        "MLC9",
        "SIN-SKU",
        1,
        9_900.0,
    ));

    let r = sync(&mut s, &fake);
    assert_eq!(r.to_review, 1, "un carrito = una venta");
    let o = s.ml_orders(None).unwrap();
    assert!(
        o.iter()
            .all(|x| x.status == "por_revisar" && x.issue.as_deref().unwrap().contains("MLC9"))
    );
    assert_eq!(stock(&s, "RC-17N"), 50);

    s.ml_link_item("mlc9", None, &uid, Some("Publicación MLC9"))
        .unwrap();
    let r = sync(&mut s, &fake);
    assert_eq!(r.completed, 1, "{:?}", r.messages);
    assert_eq!(stock(&s, "RC-17N"), 46);
    assert_eq!(
        s.list_sales(&SaleFilter {
            query: None,
            view: Some("todas".into())
        })
        .unwrap()
        .len(),
        1
    );
}

#[test]
fn comprador_con_factura_y_token_renovado() {
    let (_d, _app, mut s) = session();
    product(&mut s, "GSP6", 5);
    let fake = Fake::default();
    connect(&mut s, &fake);
    // Token vencido: se renueva solo y se guarda el nuevo.
    s.ml_connected(
        &Tokens {
            access_token: "viejo".into(),
            refresh_token: Some("TG-viejo".into()),
            expires_at: 0,
        },
        "123456",
        Some("DATALOGGER"),
    )
    .unwrap();
    let before = *fake.refreshed.borrow();
    fake.orders
        .borrow_mut()
        .push(order(4_000_001, None, "paid", "MLC5", "GSP6", 1, 49_900.0));
    fake.billing.borrow_mut().push((
        "4000001".into(),
        json!({ "billing_info": { "doc_type": "RUT", "doc_number": "76123456-0", "additional_info": [
            { "type": "BUSINESS_NAME", "value": "Panadería La Espiga SpA" },
            { "type": "STREET_NAME", "value": "Merced" }, { "type": "STREET_NUMBER", "value": "838" } ] } }),
    ));
    // Un pedido cancelado que nunca se importó no se registra.
    fake.orders.borrow_mut().push(order(
        4_000_002,
        None,
        "cancelled",
        "MLC5",
        "GSP6",
        1,
        49_900.0,
    ));

    let r = sync(&mut s, &fake);
    assert_eq!(*fake.refreshed.borrow(), before + 1);
    assert_eq!((r.imported, r.to_invoice), (1, 1), "{:?}", r.messages);
    let sales = s
        .list_sales(&SaleFilter {
            query: None,
            view: Some("todas".into()),
        })
        .unwrap();
    assert_eq!(sales.len(), 1);
    let sale = s.sale(&sales[0].uid).unwrap();
    assert_eq!(sale.summary.doc_type, "FV");
    let rec = sale.terms.unwrap().receiver.unwrap();
    assert_eq!(rec.name.as_deref(), Some("Panadería La Espiga SpA"));
    assert_eq!(rec.address.as_deref(), Some("Merced 838"));
    assert!(s.ml_orders(None).unwrap()[0].needs_invoice);
    assert_eq!(s.ml_orders(None).unwrap().len(), 1);
    // El token nuevo quedó guardado: la próxima vez no renueva.
    let _ = sync(&mut s, &fake);
    assert_eq!(*fake.refreshed.borrow(), before + 1);
}
