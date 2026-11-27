//! WooCommerce: los pedidos pagados de la tienda pasan a NÚCLEO como cliente, venta que descuenta stock
//! y envío anotado, sin duplicar; lo que no calza queda por revisar; una cancelación posterior solo
//! se avisa. En el otro sentido se envían stock y precios por SKU, con vista previa. La tienda se
//! simula con respuestas de ejemplo.

use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::sales_ops::{NewProduct, SaleFilter};
use nucleo_app::woo_ops::{self, WooConfig, WooConnectInput, WooError, WooHttp};
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

fn product(s: &mut CompanySession, sku: &str, stock: i64, price: i64) -> String {
    s.add_product(&NewProduct {
        sku: Some(sku.into()),
        name: format!("Producto {sku}"),
        unit: None,
        kind: "producto".into(),
        price_minor: price,
        cost_minor: Some(price / 2),
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

fn sales(s: &CompanySession) -> usize {
    s.list_sales(&SaleFilter {
        query: None,
        view: Some("todas".into()),
    })
    .unwrap()
    .len()
}

/// Tienda de mentira: pedidos, productos, variaciones y lo que se le envía.
#[derive(Default)]
struct Fake {
    plugin: bool,
    calc_taxes: bool,
    orders: RefCell<Vec<Value>>,
    products: RefCell<Vec<Value>>,
    variations: RefCell<Vec<Value>>,
    sent: RefCell<Vec<(String, String, Value)>>,
    gets: RefCell<Vec<String>>,
}

impl WooHttp for Fake {
    fn get(&self, url: &str, cfg: &WooConfig) -> Result<Value, WooError> {
        assert!(url.starts_with("https://tienda.cl/wp-json/"), "{url}");
        assert!(
            !url.contains(&cfg.consumer_key) && !url.contains(&cfg.consumer_secret),
            "llaves en la dirección: {url}"
        );
        self.gets.borrow_mut().push(url.to_string());
        if cfg.consumer_secret != "cs_buena" {
            return Err(WooError::Status(401, "woocommerce_rest_cannot_view".into()));
        }
        let path = url.trim_start_matches("https://tienda.cl/wp-json/");
        if path == "nucleo-erp/v1/status" {
            return if self.plugin {
                Ok(
                    json!({"plugin": "nucleo-erp", "version": "0.1.0", "store": "Tienda de prueba",
                    "currency": "CLP", "calc_taxes": self.calc_taxes, "prices_include_tax": false}),
                )
            } else {
                Err(WooError::Status(404, "rest_no_route".into()))
            };
        }
        if path.starts_with("?_fields=name") {
            return Ok(json!({"name": "Tienda sin plugin"}));
        }
        if path == "wc/v3/settings/general/woocommerce_currency" {
            return Ok(json!({"id": "woocommerce_currency", "value": "CLP"}));
        }
        if path == "wc/v3/settings/general/woocommerce_calc_taxes" {
            return Ok(json!({"value": if self.calc_taxes { "yes" } else { "no" }}));
        }
        if path == "wc/v3/settings/tax/woocommerce_prices_include_tax" {
            return Ok(json!({"value": "no"}));
        }
        if path.starts_with("wc/v3/orders?") {
            let page2 = path.contains("&page=2");
            return Ok(if page2 {
                json!([])
            } else {
                Value::Array(self.orders.borrow().clone())
            });
        }
        if path.starts_with("wc/v3/products?") {
            return Ok(Value::Array(self.products.borrow().clone()));
        }
        if path.starts_with("wc/v3/products/30/variations?") {
            return Ok(Value::Array(self.variations.borrow().clone()));
        }
        Err(WooError::Status(404, format!("sin ruta {path}")))
    }
    fn send(
        &self,
        method: &str,
        url: &str,
        _cfg: &WooConfig,
        body: &Value,
    ) -> Result<Value, WooError> {
        self.sent.borrow_mut().push((
            method.to_string(),
            url.trim_start_matches("https://tienda.cl/wp-json/wc/v3/")
                .to_string(),
            body.clone(),
        ));
        Ok(json!({}))
    }
}

fn connect(s: &mut CompanySession, fake: &Fake) {
    let cfg = s
        .woo_connect_plan(&WooConnectInput {
            url: "https://tienda.cl/".into(),
            consumer_key: "ck_llave1234".into(),
            consumer_secret: "cs_buena".into(),
            ..Default::default()
        })
        .unwrap();
    let info = woo_ops::check(fake, &cfg).unwrap();
    s.woo_connected(&cfg, &info).unwrap();
}

fn order(id: i64, status: &str, sku: &str, qty: i64, line_total: i64, shipping: i64) -> Value {
    json!({
        "id": id, "number": id.to_string(), "status": status,
        "date_created": "2026-11-20T10:15:00", "currency": "CLP",
        "total": (line_total + shipping).to_string(), "total_tax": "0",
        "shipping_total": shipping.to_string(), "shipping_tax": "0",
        "payment_method_title": "Webpay Plus", "transaction_id": format!("TX{id}"),
        "customer_note": "Tocar el timbre",
        "billing": {"first_name": "Ana", "last_name": "Soto", "company": "",
            "address_1": "Av. Los Leones 123", "address_2": "Depto 45", "city": "Providencia",
            "state": "CL-RM", "email": "ana@correo.cl", "phone": "+56911111111"},
        "shipping": {"first_name": "Ana", "last_name": "Soto", "address_1": "Av. Los Leones 123",
            "address_2": "Depto 45", "city": "Providencia", "state": "CL-RM"},
        "line_items": [{"id": 1, "name": "Registrador RC-5", "product_id": 10, "variation_id": 0,
            "quantity": qty, "subtotal": line_total.to_string(), "total": line_total.to_string(),
            "sku": sku}],
        "shipping_lines": [{"method_title": "Blue Express a domicilio"}],
        "meta_data": []
    })
}

fn sync(s: &mut CompanySession, fake: &Fake) -> woo_ops::WooSyncReport {
    let plan = s.woo_sync_plan(Some("2026-11-01")).unwrap();
    let orders = woo_ops::fetch(fake, &plan).unwrap();
    s.woo_apply(&orders).unwrap()
}

#[test]
fn conexion_con_y_sin_plugin() {
    let (_d, _app, mut s) = session();
    assert!(!s.woo_status().unwrap().configured);
    // Sin conectar no se sincroniza.
    assert!(s.woo_sync_plan(None).is_err());
    // Llaves mal escritas o dirección sin https: no se prueba nada.
    let mal = |url: &str, k: &str, sec: &str| WooConnectInput {
        url: url.into(),
        consumer_key: k.into(),
        consumer_secret: sec.into(),
        ..Default::default()
    };
    assert!(
        s.woo_connect_plan(&mal("http://tienda.cl", "ck_a", "cs_b"))
            .is_err()
    );
    assert!(
        s.woo_connect_plan(&mal("https://tienda.cl", "llave", "cs_b"))
            .is_err()
    );
    assert!(
        s.woo_connect_plan(&mal("https://tienda.cl", "ck_a", ""))
            .is_err()
    );

    // La tienda rechaza las llaves: no se guarda nada.
    let fake = Fake::default();
    let cfg = s
        .woo_connect_plan(&mal("https://tienda.cl", "ck_llave1234", "cs_mala"))
        .unwrap();
    let e = woo_ops::check(&fake, &cfg).unwrap_err();
    assert!(e.to_string().contains("no aceptó las llaves"), "{e}");
    assert!(!s.woo_status().unwrap().configured);

    // Sin el plugin: valida con una consulta y lee los ajustes.
    connect(&mut s, &fake);
    let st = s.woo_status().unwrap();
    assert!(st.connected && st.plugin_version.is_none());
    assert_eq!(st.store_name.as_deref(), Some("Tienda sin plugin"));
    assert_eq!(st.currency.as_deref(), Some("CLP"));
    assert_eq!(st.key_hint.as_deref(), Some("…1234"));
    // La interfaz nunca recibe las llaves.
    let shown = serde_json::to_string(&st).unwrap();
    assert!(!shown.contains("cs_buena") && !shown.contains("ck_llave1234"));

    // Con el plugin, por el código de conexión (las llaves vienen dentro).
    let fake = Fake {
        plugin: true,
        ..Default::default()
    };
    let raw = r#"{"u":"https://tienda.cl","k":"ck_llave1234","s":"cs_buena"}"#;
    let code = format!(
        "{}{}",
        woo_ops::CODE_PREFIX,
        data_encoding::BASE64URL_NOPAD.encode(raw.as_bytes())
    );
    let cfg = s
        .woo_connect_plan(&WooConnectInput {
            code,
            ..Default::default()
        })
        .unwrap();
    let info = woo_ops::check(&fake, &cfg).unwrap();
    let st = s.woo_connected(&cfg, &info).unwrap();
    assert_eq!(st.plugin_version.as_deref(), Some("0.1.0"));
    assert_eq!(st.store_name.as_deref(), Some("Tienda de prueba"));

    // Desconectar borra las llaves.
    let st = s.woo_disconnect().unwrap();
    assert!(!st.configured && !st.connected && st.key_hint.is_none());
}

#[test]
fn pedido_pasa_a_cliente_venta_y_envio_sin_duplicar() {
    let (_d, _app, mut s) = session();
    product(&mut s, "RC-5", 10, 10_000);
    let fake = Fake::default();
    connect(&mut s, &fake);
    // Pedido pagado: 3 × $11.900 con IVA + envío $3.920.
    fake.orders
        .borrow_mut()
        .push(order(1253, "processing", "RC-5", 3, 35_700, 3_920));
    // Otro esperando la transferencia: no se registra.
    fake.orders
        .borrow_mut()
        .push(order(1254, "on-hold", "RC-5", 1, 11_900, 0));

    let r = sync(&mut s, &fake);
    assert_eq!(
        (r.imported, r.to_review, r.waiting_payment, r.shipments),
        (1, 0, 1, 1),
        "{:?}",
        r.messages
    );
    assert_eq!(stock(&s, "RC-5"), 7, "descuenta stock");
    assert_eq!(sales(&s), 1);

    let o = &s.woo_orders(None).unwrap()[0];
    assert_eq!(
        (o.number.as_str(), o.status.as_str()),
        ("1253", "importada")
    );
    assert_eq!((o.total_minor, o.shipping_minor), (39_620, 3_920));
    assert_eq!(o.buyer.as_deref(), Some("Ana Soto"));
    let sale = s.sale(o.sale_uid.as_deref().unwrap()).unwrap();
    // Montos con IVA de la tienda → neto; el total calza salvo un peso de redondeo.
    assert!(
        (sale.summary.total_minor - 39_620).abs() <= 2,
        "{}",
        sale.summary.total_minor
    );
    assert_eq!(sale.summary.payment_state, "pagada");
    let terms = sale.terms.as_ref().unwrap();
    assert_eq!(
        (
            terms.references[0].kind.as_str(),
            terms.references[0].folio.as_str()
        ),
        ("WEB", "1253")
    );
    assert_eq!(terms.payment, "tarjeta");
    assert!(sale.notes.as_deref().unwrap_or("").contains("pedido #1253"));

    // Cliente con su correo.
    let c = &s.search_customers("Ana Soto", 5).unwrap()[0];
    assert_eq!(c.email.as_deref(), Some("ana@correo.cl"));

    // Envío sin despachar, con los datos para la orden de transporte.
    let envios = s.shipments(o.sale_uid.as_deref()).unwrap();
    assert_eq!(envios.len(), 1);
    let e = &envios[0];
    assert_eq!(e.status, "no_despachado");
    assert_eq!(e.carrier.as_deref(), Some("Bluexpress"));
    assert_eq!(e.commune.as_deref(), Some("Providencia"));
    assert_eq!(e.address.as_deref(), Some("Av. Los Leones 123, Depto 45"));
    assert_eq!(e.phone.as_deref(), Some("+56911111111"));
    assert_eq!(e.declared_value_minor, Some(39_620));
    assert_eq!(e.content.as_deref(), Some("3 × Registrador RC-5"));
    assert_eq!(o.shipment_number.as_deref(), Some(e.number.as_str()));

    // El número de la venta se anota en el pedido de la tienda.
    assert_eq!(r.to_write_back.len(), 1);
    let failed = woo_ops::write_back(&fake, &s.woo_config().unwrap(), &r.to_write_back);
    assert!(failed.is_empty());
    let sent = fake.sent.borrow();
    assert_eq!(
        (sent[0].0.as_str(), sent[0].1.as_str()),
        ("PUT", "orders/1253")
    );
    assert_eq!(sent[0].2["meta_data"][0]["key"], woo_ops::META_SALE);
    assert_eq!(
        sent[0].2["meta_data"][0]["value"],
        json!(sale.summary.number.clone())
    );
    drop(sent);

    // Otra vez: no duplica venta, stock ni envío.
    let r = sync(&mut s, &fake);
    assert_eq!((r.imported, r.unchanged, r.shipments), (0, 1, 0));
    assert_eq!((stock(&s, "RC-5"), sales(&s)), (7, 1));
    assert_eq!(s.shipments(None).unwrap().len(), 1);

    // Llega el pago del segundo: ahora sí entra.
    fake.orders.borrow_mut()[1]["status"] = json!("processing");
    let r = sync(&mut s, &fake);
    assert_eq!((r.imported, r.unchanged), (1, 1), "{:?}", r.messages);
    assert_eq!(stock(&s, "RC-5"), 6);

    // Reembolsado después: solo aviso, la venta sigue hasta que la persona la anule.
    fake.orders.borrow_mut()[0]["status"] = json!("refunded");
    let r = sync(&mut s, &fake);
    assert_eq!(r.cancelled, 1);
    let o = s
        .woo_orders(None)
        .unwrap()
        .into_iter()
        .find(|o| o.number == "1253")
        .unwrap();
    assert_eq!(o.status, "cancelada");
    assert!(o.issue.unwrap().contains("anula la venta"));
    assert_eq!((stock(&s, "RC-5"), sales(&s)), (6, 2));
}

#[test]
fn lo_que_no_calza_queda_por_revisar() {
    let (_d, _app, mut s) = session();
    let fake = Fake::default();
    connect(&mut s, &fake);
    fake.orders
        .borrow_mut()
        .push(order(2001, "processing", "NUEVO-1", 2, 23_800, 0));

    // El producto no existe en NÚCLEO: borrador, sin stock ni envío.
    let r = sync(&mut s, &fake);
    assert_eq!((r.imported, r.to_review, r.shipments), (0, 1, 0));
    assert!(r.messages[0].contains("SKU NUEVO-1"), "{:?}", r.messages);
    assert!(r.to_write_back.is_empty());
    let o = &s.woo_orders(None).unwrap()[0];
    assert_eq!(o.status, "por_revisar");
    assert_eq!(o.sale_state.as_deref(), Some("borrador"));

    // Se crea el producto con ese código y se sincroniza de nuevo: la misma venta se confirma.
    product(&mut s, "NUEVO-1", 5, 10_000);
    let r = sync(&mut s, &fake);
    assert_eq!(
        (r.completed, r.to_review, r.shipments),
        (1, 0, 1),
        "{:?}",
        r.messages
    );
    assert_eq!((stock(&s, "NUEVO-1"), sales(&s)), (3, 1));
    assert_eq!(s.woo_orders(None).unwrap()[0].status, "importada");
}

#[test]
fn factura_retiro_en_tienda_y_cupon() {
    let (_d, _app, mut s) = session();
    product(&mut s, "RC-5", 10, 10_000);
    let fake = Fake::default();
    connect(&mut s, &fake);
    // Tienda que calcula impuestos: los montos de línea vienen netos. Cupón de 10 %.
    let mut o = order(3001, "completed", "RC-5", 2, 18_000, 0);
    o["line_items"][0]["subtotal"] = json!("20000");
    o["total_tax"] = json!("3420");
    o["total"] = json!("21420");
    o["billing"]["company"] = json!("Clínica Sur SpA");
    o["shipping_lines"] = json!([{"method_title": "Retiro en tienda"}]);
    o["meta_data"] = json!([
        {"key": "_nucleo_documento", "value": "factura"},
        {"key": "_nucleo_rut", "value": "76.000.000-0"},
        {"key": "_nucleo_giro", "value": "Servicios médicos"}
    ]);
    fake.orders.borrow_mut().push(o);

    let r = sync(&mut s, &fake);
    assert_eq!(
        (r.imported, r.to_invoice, r.shipments),
        (1, 1, 0),
        "{:?}",
        r.messages
    );
    let row = &s.woo_orders(None).unwrap()[0];
    assert!(row.needs_invoice && row.shipment_uid.is_none());
    assert_eq!(row.buyer.as_deref(), Some("Clínica Sur SpA"));
    let sale = s.sale(row.sale_uid.as_deref().unwrap()).unwrap();
    assert_eq!(sale.summary.total_minor, 21_420);
    let rec = sale.terms.as_ref().unwrap().receiver.as_ref().unwrap();
    assert_eq!(rec.name.as_deref(), Some("Clínica Sur SpA"));
    assert_eq!(rec.activity.as_deref(), Some("Servicios médicos"));
    assert!(sale.summary.number.starts_with("FV"));
    // El cliente queda por RUT, como empresa.
    let c = &s.search_customers("Clínica", 5).unwrap()[0];
    assert_eq!(c.rut.as_deref(), Some("76000000-0"));
}

#[test]
fn stock_y_precios_hacia_la_tienda() {
    let (_d, _app, mut s) = session();
    product(&mut s, "RC-5", 10, 10_000);
    product(&mut s, "RC-51", 4, 20_000);
    product(&mut s, "TALLA-S", 3, 5_000);
    product(&mut s, "SOLO-NUCLEO", 1, 1_000);
    let fake = Fake::default();
    connect(&mut s, &fake);
    *fake.products.borrow_mut() = vec![
        // Stock distinto y precio distinto.
        json!({"id": 10, "type": "simple", "sku": "RC-5", "manage_stock": true, "stock_quantity": 2, "regular_price": "9990"}),
        // Ya igual en stock y precio: no cambia.
        json!({"id": 11, "type": "simple", "sku": "rc-51", "manage_stock": true, "stock_quantity": 4, "regular_price": "23800"}),
        // Sin SKU y con un SKU que NÚCLEO no tiene.
        json!({"id": 12, "type": "simple", "sku": "", "manage_stock": false, "stock_quantity": null, "regular_price": "1000"}),
        json!({"id": 13, "type": "simple", "sku": "OTRO", "manage_stock": false, "stock_quantity": null, "regular_price": "1000"}),
        json!({"id": 30, "type": "variable", "sku": "", "manage_stock": false, "stock_quantity": null, "regular_price": ""}),
    ];
    *fake.variations.borrow_mut() = vec![
        json!({"id": 31, "sku": "TALLA-S", "manage_stock": false, "stock_quantity": null, "regular_price": "5950"}),
    ];

    // Vista previa: nada se envía.
    let plan = s.woo_push_plan(true, true).unwrap();
    let r = woo_ops::push(&fake, &plan, false).unwrap();
    assert!(!r.applied && fake.sent.borrow().is_empty());
    assert_eq!((r.matched, r.not_in_store, r.not_in_nucleo), (3, 1, 2));
    assert_eq!(
        r.prices_with_tax,
        Some(true),
        "tienda sin impuestos: precios con IVA"
    );
    assert_eq!(r.changes.len(), 2, "{:?}", r.changes);
    let rc5 = r.changes.iter().find(|c| c.sku == "RC-5").unwrap();
    assert_eq!((rc5.stock_from, rc5.stock_to), (Some(2), Some(10)));
    assert_eq!((rc5.price_from, rc5.price_to), (Some(9_990), Some(11_900)));
    let talla = r.changes.iter().find(|c| c.sku == "TALLA-S").unwrap();
    assert_eq!(
        (talla.stock_from, talla.stock_to, talla.price_to),
        (None, Some(3), None)
    );

    // Solo stock: no consulta ni cambia precios.
    let plan = s.woo_push_plan(true, false).unwrap();
    let r = woo_ops::push(&fake, &plan, true).unwrap();
    assert!(r.applied);
    s.woo_push_done(&r).unwrap();
    let sent = fake.sent.borrow();
    assert_eq!(sent.len(), 2);
    let simple = sent.iter().find(|x| x.1 == "products/batch").unwrap();
    assert_eq!(
        simple.2,
        json!({"update": [{"id": 10, "manage_stock": true, "stock_quantity": 10}]})
    );
    let var = sent
        .iter()
        .find(|x| x.1 == "products/30/variations/batch")
        .unwrap();
    assert_eq!(
        var.2,
        json!({"update": [{"id": 31, "manage_stock": true, "stock_quantity": 3}]})
    );
    drop(sent);
    assert!(s.audit_log("WooCommerce", None).unwrap().iter().any(|a| {
        a.after_json
            .as_deref()
            .unwrap_or("")
            .contains("stock de 2 producto")
            || a.reason
                .as_deref()
                .unwrap_or("")
                .contains("stock de 2 producto")
    }));

    // Lo reservado por despachar no se ofrece en la tienda; sin elegir nada, error.
    assert!(s.woo_push_plan(false, false).is_err());

    // Tienda que calcula impuestos con precios sin IVA: se envía el neto.
    let fake2 = Fake {
        calc_taxes: true,
        ..Default::default()
    };
    *fake2.products.borrow_mut() = vec![
        json!({"id": 10, "type": "simple", "sku": "RC-5", "manage_stock": true, "stock_quantity": 10, "regular_price": "9990"}),
    ];
    let plan = s.woo_push_plan(false, true).unwrap();
    let r = woo_ops::push(&fake2, &plan, false).unwrap();
    assert_eq!(r.prices_with_tax, Some(false));
    assert_eq!(r.changes[0].price_to, Some(10_000));
    assert_eq!(r.changes[0].stock_to, None);
}

#[test]
fn tienda_sin_sku_se_reconoce_por_equivalencias_y_un_combo_descuenta_sus_partes() {
    use nucleo_app::woo_ops::{WooComponent, WooEquivalenceInput};
    let (_d, _app, mut s) = session();
    let fake = Fake::default();
    connect(&mut s, &fake);
    let equipo = product(&mut s, "P-00004", 50, 23_445);
    let soporte = product(&mut s, "P-00027", 50, 2_437);
    // La tienda no usa SKU: un producto simple, un combo y uno variable.
    *fake.products.borrow_mut() = vec![
        json!({"id": 137, "type": "simple", "status": "publish", "sku": "", "name": "Producto P-00004 + Soporte", "price": "27900"}),
        json!({"id": 30, "type": "variable", "status": "publish", "sku": "", "name": "Arriendo", "price": "149400"}),
        json!({"id": 99, "type": "simple", "status": "trash", "sku": "", "name": "Borrado", "price": "1"}),
    ];
    *fake.variations.borrow_mut() = vec![
        json!({"id": 31, "sku": "", "price": "149400", "attributes": [{"name": "Plan", "option": "6 meses"}]}),
    ];
    let store = woo_ops::fetch_catalog(&fake, &s.woo_catalog_plan().unwrap()).unwrap();
    assert_eq!(store.len(), 2, "sin el producto en la papelera");
    let cat = s.woo_catalog(&store).unwrap();
    assert!(cat.iter().all(|c| c.matched_by.is_empty()));
    assert_eq!(cat[0].name, "Arriendo — 6 meses");
    assert_eq!(
        (cat[0].product_id.as_str(), cat[0].variation_id.as_str()),
        ("30", "31")
    );
    // Por nombre sugiere el producto de NÚCLEO más parecido.
    let combo = cat.iter().find(|c| c.product_id == "137").unwrap();
    assert_eq!(combo.suggestion.as_ref().unwrap().sku, "P-00004");

    // Sin equivalencia, el pedido queda por revisar.
    let mut pedido = order(3001, "processing", "", 2, 55_800, 0);
    pedido["line_items"][0]["product_id"] = json!(137);
    pedido["line_items"][0]["name"] = json!("Producto P-00004 + Soporte");
    fake.orders.borrow_mut().push(pedido);
    let r = sync(&mut s, &fake);
    assert_eq!((r.imported, r.to_review), (0, 1));
    assert!(
        r.messages[0].contains("sin SKU ni equivalencia"),
        "{:?}",
        r.messages
    );

    // Se guarda el combo (1 equipo + 1 soporte por unidad) y la misma venta se confirma.
    let combo = WooEquivalenceInput {
        product_id: "137".into(),
        variation_id: String::new(),
        name: "Producto P-00004 + Soporte".into(),
        items: vec![
            WooComponent {
                product_uid: equipo.clone(),
                qty_milli: 1000,
            },
            WooComponent {
                product_uid: soporte.clone(),
                qty_milli: 1000,
            },
        ],
    };
    s.woo_save_equivalence(&combo).unwrap();
    let cat = s.woo_catalog(&store).unwrap();
    let c = cat.iter().find(|c| c.product_id == "137").unwrap();
    assert_eq!(
        (c.matched_by.as_str(), c.components.len()),
        ("equivalencia", 2)
    );
    let r = sync(&mut s, &fake);
    assert_eq!((r.completed, r.to_review), (1, 0), "{:?}", r.messages);
    assert_eq!(
        (stock(&s, "P-00004"), stock(&s, "P-00027"), sales(&s)),
        (48, 48, 1)
    );
    // Las dos líneas suman lo que cobró la tienda (los montos venían con el impuesto incluido).
    let venta = s
        .list_sales(&SaleFilter {
            query: None,
            view: Some("todas".into()),
        })
        .unwrap()
        .remove(0);
    assert!(
        (venta.total_minor - 55_800).abs() <= 1,
        "total {} (un peso de redondeo como máximo)",
        venta.total_minor
    );

    // Lo que no vale: repetidos, cantidades en cero y productos que no existen.
    let mut malo = combo.clone();
    malo.items.push(WooComponent {
        product_uid: equipo.clone(),
        qty_milli: 1000,
    });
    assert!(s.woo_save_equivalence(&malo).is_err());
    malo.items = vec![WooComponent {
        product_uid: equipo,
        qty_milli: 0,
    }];
    assert!(s.woo_save_equivalence(&malo).is_err());
    malo.items = vec![WooComponent {
        product_uid: "no-existe".into(),
        qty_milli: 1000,
    }];
    assert!(s.woo_save_equivalence(&malo).is_err());
    // Sin productos, la equivalencia se quita.
    s.woo_save_equivalence(&WooEquivalenceInput {
        product_id: "137".into(),
        ..Default::default()
    })
    .unwrap();
    assert!(
        s.woo_catalog(&store)
            .unwrap()
            .iter()
            .all(|c| c.matched_by.is_empty())
    );
}
