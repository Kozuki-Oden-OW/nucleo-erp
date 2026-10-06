//! Fase 7 · Inventario: bodegas, transferencias, ajustes y conteos, kárdex, stock negativo y
//! análisis (velocidad, cobertura, sugerencia de compra).

use nucleo_app::inventory_ops::{
    AdjustmentInput, InventorySettings, ReorderInput, StockLineInput, TransferInput,
};
use nucleo_app::sales_ops::{EffectInput, LineInput, NewProduct, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Ferretería Los Andes", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn days_ago(n: i64) -> String {
    let d = time::OffsetDateTime::now_utc().date() - time::Duration::days(n);
    let fmt = time::macros::format_description!("[year]-[month]-[day]");
    d.format(&fmt).unwrap()
}

fn line(uid: &str, units: i64) -> StockLineInput {
    StockLineInput {
        product_uid: uid.into(),
        qty_milli: units * 1000,
    }
}

fn sell(
    s: &mut CompanySession,
    product: &str,
    units: i64,
    date: &str,
) -> Result<(), nucleo_app::AppError> {
    let v = s.save_sale(
        &SaleInput {
            doc_type: "VEN".into(),
            customer_uid: None,
            issue_date: date.into(),
            lines: vec![LineInput {
                product_uid: Some(product.into()),
                description: "x".into(),
                qty_milli: units * 1000,
                unit_price_minor: 2_000,
                discount_ppm: 0,
                taxable: true,
            }],
            notes: None,
        },
        None,
    )?;
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: "contado".into(),
            method: "Efectivo".into(),
            due_date: None,
        },
    )?;
    Ok(())
}

#[test]
fn bodegas_transferencias_y_ajustes() {
    let (_d, _app, mut s) = session();
    let p = s
        .add_product(&NewProduct {
            sku: Some("LIJ-80".into()),
            name: "Lija 80".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 900,
            cost_minor: Some(400),
            taxable: Some(true),
            initial_stock_milli: Some(10_000),
        })
        .unwrap();
    let ws = s.create_warehouse("Sala de ventas").unwrap();
    assert_eq!(ws.len(), 2);
    let main = ws.iter().find(|w| w.is_default).unwrap().uid.clone();
    let sala = ws.iter().find(|w| !w.is_default).unwrap().uid.clone();

    let t = TransferInput {
        from_uid: main.clone(),
        to_uid: sala.clone(),
        date: days_ago(0),
        notes: None,
        lines: vec![line(&p.uid, 4)],
    };
    let done = s.transfer_stock(&t).unwrap();
    assert_eq!(done.number, "TRA-000001");
    assert!(
        s.transfer_stock(&TransferInput {
            lines: vec![line(&p.uid, 7)],
            ..t.clone()
        })
        .is_err(),
        "no más de lo disponible"
    );
    let inv = s.product_inventory(&p.uid, None).unwrap();
    let qty: Vec<i64> = inv.by_warehouse.iter().map(|b| b.on_hand_milli).collect();
    assert_eq!(qty, vec![6_000, 4_000]);
    assert_eq!(inv.product.on_hand_milli, 10_000);
    assert_eq!(
        inv.by_warehouse[1].avg_cost_e4, 4_000_000,
        "la transferencia lleva el costo de origen"
    );

    // Conteo: había 6 en la principal, se contaron 5.
    let c = s
        .adjust_stock(&AdjustmentInput {
            warehouse_uid: main.clone(),
            date: days_ago(0),
            kind: "conteo".into(),
            reason: "Conteo mensual".into(),
            lines: vec![line(&p.uid, 5)],
        })
        .unwrap();
    assert_eq!(c.number, "AJU-000001");
    assert!(
        s.adjust_stock(&AdjustmentInput {
            warehouse_uid: main.clone(),
            date: days_ago(0),
            kind: "conteo".into(),
            reason: "Otra vez".into(),
            lines: vec![line(&p.uid, 5)]
        })
        .is_err(),
        "sin diferencias no hay ajuste"
    );
    assert!(
        s.adjust_stock(&AdjustmentInput {
            warehouse_uid: sala.clone(),
            date: days_ago(0),
            kind: "ajuste".into(),
            reason: " ".into(),
            lines: vec![line(&p.uid, 2)]
        })
        .is_err(),
        "motivo obligatorio"
    );
    s.adjust_stock(&AdjustmentInput {
        warehouse_uid: sala.clone(),
        date: days_ago(0),
        kind: "ajuste".into(),
        reason: "Encontradas en vitrina".into(),
        lines: vec![line(&p.uid, 2)],
    })
    .unwrap();
    let inv = s.product_inventory(&p.uid, None).unwrap();
    assert_eq!(inv.product.on_hand_milli, 11_000);
    let docs: Vec<String> = inv.kardex.iter().map(|k| k.document.clone()).collect();
    assert_eq!(
        docs,
        [
            "AJU-000002",
            "AJU-000001",
            "TRA-000001",
            "TRA-000001",
            "Stock inicial"
        ]
    );
    assert_eq!(inv.kardex[0].balance_milli, 11_000);
    assert_eq!(s.stock_documents().unwrap().len(), 3);

    // Bodegas: no se archiva con stock ni la principal.
    assert!(s.archive_warehouse(&sala).is_err());
    assert!(s.archive_warehouse(&main).is_err());
    s.set_default_warehouse(&sala).unwrap();
    assert!(
        s.warehouses()
            .unwrap()
            .iter()
            .find(|w| w.uid == sala)
            .unwrap()
            .is_default
    );
    assert!(s.verify_audit().unwrap().ok);
}

#[test]
fn stock_negativo_y_analisis() {
    let (_d, _app, mut s) = session();
    let p = s
        .add_product(&NewProduct {
            sku: None,
            name: "Silicona".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 2_000,
            cost_minor: Some(1_000),
            taxable: Some(true),
            initial_stock_milli: Some(100_000),
        })
        .unwrap();
    // 20 días de venta de 2 unidades en los últimos 60 días → 40 u en 20+ días con stock.
    for i in 0..20 {
        sell(&mut s, &p.uid, 2, &days_ago(60 - i * 3)).unwrap();
    }
    let o = s.inventory_overview().unwrap();
    let a = o.rows.iter().find(|r| r.uid == p.uid).unwrap();
    assert_eq!(a.sold_milli, 40_000);
    assert!(a.days_with_stock >= 20);
    assert!(a.velocity_milli.unwrap() > 0);
    assert!(a.coverage_days.is_some());
    assert_eq!(a.on_hand_milli, 60_000);
    assert_eq!(o.total_value_minor, 60_000);

    // Parámetros de reposición y mínimo.
    let inv = s
        .update_reorder_settings(
            &p.uid,
            &ReorderInput {
                min_milli: 80_000,
                safety_days: 7,
                target_coverage_days: 30,
                excess_coverage_days: 365,
                lead_time_days: Some(10),
            },
        )
        .unwrap();
    assert_eq!(inv.product.min_milli, 80_000);
    assert_eq!(inv.analysis.unwrap().status, "bajo_minimo");

    // Sin permitir negativo, la venta que excede el stock se rechaza.
    s.update_inventory_settings(&InventorySettings {
        allow_negative: false,
    })
    .unwrap();
    assert!(sell(&mut s, &p.uid, 61, &days_ago(0)).is_err());
    sell(&mut s, &p.uid, 60, &days_ago(0)).unwrap();
    s.update_inventory_settings(&InventorySettings {
        allow_negative: true,
    })
    .unwrap();
    sell(&mut s, &p.uid, 1, &days_ago(0)).unwrap();
    let a = s.product_inventory(&p.uid, None).unwrap().analysis.unwrap();
    assert_eq!(a.on_hand_milli, -1_000);
    assert_eq!(a.status, "sin_stock");
}
