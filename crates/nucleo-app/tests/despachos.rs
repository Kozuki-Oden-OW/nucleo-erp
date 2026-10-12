//! Regla de stock por producto (general, no vender sin stock, vender igual, reservas) y productos
//! por despachar: apartar lo que hay, dejar pendiente lo que falta y descontar al despachar.

use nucleo_app::inventory_ops::{AdjustmentInput, InventorySettings, StockLineInput};
use nucleo_app::sales_ops::{EffectInput, LineInput, NewProduct, ProductPatch, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger Demo", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn today() -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
        .unwrap()
}

fn product(s: &mut CompanySession, sku: &str, stock: i64, policy: &str) -> String {
    s.add_product(&NewProduct {
        sku: Some(sku.into()),
        name: format!("Producto {sku}"),
        unit: None,
        kind: "producto".into(),
        price_minor: 10_000,
        cost_minor: Some(6_000),
        taxable: Some(true),
        initial_stock_milli: Some(stock * 1000),
        category_uid: None,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: Some(policy.into()),
    })
    .unwrap()
    .uid
}

fn sell(
    s: &mut CompanySession,
    customer: Option<&str>,
    product: &str,
    units: i64,
) -> Result<String, nucleo_app::AppError> {
    let v = s.save_sale(
        &SaleInput {
            doc_type: "VEN".into(),
            customer_uid: customer.map(Into::into),
            issue_date: today(),
            lines: vec![LineInput {
                product_uid: Some(product.into()),
                description: "x".into(),
                qty_milli: units * 1000,
                unit_price_minor: 10_000,
                discount_ppm: 0,
                taxable: true,
            }],
            notes: None,
            terms: None,
        },
        None,
    )?;
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: "contado".into(),
            method: "Efectivo".into(),
            due_date: None,
            account_uid: None,
        },
    )?;
    Ok(v.summary.uid)
}

fn stock(s: &CompanySession, uid: &str) -> i64 {
    s.search_products("", 200)
        .unwrap()
        .into_iter()
        .find(|p| p.uid == uid)
        .unwrap()
        .on_hand_milli
}

#[test]
fn reglas_de_stock_por_producto() {
    let (_d, _app, mut s) = session();
    // El negocio permite vender sin stock, pero este producto no.
    let b = product(&mut s, "BLQ", 1, "bloquear");
    assert!(sell(&mut s, None, &b, 2).is_err());
    sell(&mut s, None, &b, 1).unwrap();
    // El negocio no permite vender sin stock, pero este producto sí.
    s.update_inventory_settings(&InventorySettings {
        allow_negative: false,
    })
    .unwrap();
    let v = product(&mut s, "VEN", 0, "vender");
    sell(&mut s, None, &v, 3).unwrap();
    assert_eq!(stock(&s, &v), -3_000);
    // La regla general sigue al negocio.
    let g = product(&mut s, "GEN", 0, "general");
    assert!(sell(&mut s, None, &g, 1).is_err());
    assert!(
        s.add_product(&NewProduct {
            sku: Some("X".into()),
            name: "X".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 1,
            cost_minor: None,
            taxable: None,
            initial_stock_milli: None,
            category_uid: None,
            extra_category_uids: None,
            cost_sheet: None,
            stock_policy: Some("regalar".into()),
        })
        .is_err()
    );
}

#[test]
fn reservas_y_despachos() {
    let (_d, _app, mut s) = session();
    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur".into(),
            ..Default::default()
        })
        .unwrap();
    let a = product(&mut s, "TLOG", 4, "reservar");

    // Venta 1: 10 unidades con 4 en bodega → no descuenta stock, aparta 4 y faltan 6.
    let v1 = sell(&mut s, Some(&c.uid), &a, 10).unwrap();
    assert_eq!(stock(&s, &a), 4_000, "el stock se descuenta al despachar");
    // Venta 2: 2 unidades → todo pendiente (lo que hay ya está apartado para la venta 1).
    let v2 = sell(&mut s, None, &a, 2).unwrap();
    let p = s.pending_dispatches().unwrap();
    assert_eq!(p.len(), 2);
    assert_eq!((p[0].reserved_milli, p[0].missing_milli), (4_000, 6_000));
    assert_eq!((p[1].reserved_milli, p[1].missing_milli), (0, 2_000));
    assert_eq!(p[0].customer.as_deref(), Some("Clínica Sur"));
    let d = s.sale(&v1).unwrap();
    assert_eq!(d.dispatch.len(), 1);
    assert!(d.timeline.iter().any(|t| t.text.contains("por despachar")));

    // Si el producto pasa a «no vender sin stock», lo apartado no está disponible.
    let prod = s
        .search_products("", 200)
        .unwrap()
        .into_iter()
        .find(|x| x.uid == a)
        .unwrap();
    let patch = ProductPatch {
        name: prod.name.clone(),
        sku: prod.sku.clone(),
        unit: "un".into(),
        price_minor: prod.price_minor,
        taxable: true,
        min_milli: 0,
        category_uid: None,
        extra_category_uids: None,
        cost_minor: None,
        cost_sheet: None,
        stock_policy: Some("bloquear".into()),
    };
    s.update_product(&a, &patch).unwrap();
    assert!(sell(&mut s, None, &a, 1).is_err());
    s.update_product(
        &a,
        &ProductPatch {
            stock_policy: Some("reservar".into()),
            ..patch
        },
    )
    .unwrap();

    // Despachar: no más de lo pendiente ni de lo que hay.
    let id1 = p[0].id;
    assert!(s.dispatch_items(id1, 11_000, None).is_err());
    assert!(s.dispatch_items(id1, 5_000, None).is_err(), "solo hay 4");
    s.dispatch_items(id1, 4_000, None).unwrap();
    assert_eq!(stock(&s, &a), 0);

    // Llegan 20 (conteo a 20 a $6.000) y se despacha el resto.
    let wh = s
        .warehouses()
        .unwrap()
        .into_iter()
        .find(|w| w.is_default)
        .unwrap()
        .uid;
    s.adjust_stock(&AdjustmentInput {
        warehouse_uid: wh.clone(),
        date: today(),
        kind: "conteo".into(),
        reason: "Llegó la importación".into(),
        lines: vec![StockLineInput {
            product_uid: a.clone(),
            qty_milli: 20_000,
        }],
    })
    .unwrap();
    let p = s.dispatch_items(id1, 6_000, None).unwrap();
    assert_eq!(p.len(), 1, "la venta 1 quedó despachada");
    assert_eq!((p[0].reserved_milli, p[0].missing_milli), (2_000, 0));
    assert_eq!(stock(&s, &a), 14_000);
    let d = s.sale(&v1).unwrap();
    assert!(d.dispatch.is_empty());
    assert_eq!(d.lines[0].unit_cost_e4, Some(60_000_000));
    assert_eq!(d.cost_minor, 60_000);

    // Anular la venta 2 (sin despachar) solo libera la reserva; anular la 1 devuelve las 10.
    s.void_sale(&v2, "Cliente desistió").unwrap();
    assert!(s.pending_dispatches().unwrap().is_empty());
    assert_eq!(stock(&s, &a), 14_000);
    s.void_sale(&v1, "Devolución").unwrap();
    assert_eq!(stock(&s, &a), 24_000);

    // Stock por bodega para realizar inventario.
    let rows = s.warehouse_stock(&wh).unwrap();
    assert_eq!(
        rows.iter()
            .find(|r| r.product.uid == a)
            .unwrap()
            .on_hand_milli,
        24_000
    );
    assert_eq!(rows[0].product.stock_policy, "reservar");
}
