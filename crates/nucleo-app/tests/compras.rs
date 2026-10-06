//! Fase 6 · Compras: proveedor → orden de compra → recepción (stock y costo promedio) →
//! documento de compra → pagos, compra directa con ingreso a bodega y anulación.

use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::purchase_ops::{
    BuyLineInput, NewSupplier, PoInput, PurchaseFilter, PurchaseInput, ReceiveLine,
};
use nucleo_app::sales_ops::NewProduct;
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Ferretería Los Andes", BusinessProfile::Negocio)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn buy(product: Option<&str>, desc: &str, units: i64, cost: i64) -> BuyLineInput {
    BuyLineInput {
        product_uid: product.map(String::from),
        description: desc.into(),
        qty_milli: units * 1000,
        unit_cost_minor: cost,
        taxable: true,
    }
}

const HOY: &str = "2026-10-06";

#[test]
fn ciclo_de_compra_completo() {
    let (_d, _app, mut s) = session();
    // Tasa de EJEMPLO anotada por el usuario (no normativa).
    s.update_business(&BusinessPatch {
        tax_rate_user_ppm: Some(100_000),
        ..Default::default()
    })
    .unwrap();
    let martillo = s
        .add_product(&NewProduct {
            sku: None,
            name: "Martillo".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 10_000,
            cost_minor: Some(6_000),
            taxable: Some(true),
            initial_stock_milli: Some(10_000),
        })
        .unwrap();
    let prov = s
        .add_supplier(&NewSupplier {
            name: "Distribuidora Sur".into(),
            rut: Some("76.543.210-3".into()),
            payment_terms_days: Some(30),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(s.search_suppliers("distrib", 10).unwrap().len(), 1);

    // Orden: 20 martillos a 7.000 + flete (sin producto).
    let input = PoInput {
        supplier_uid: prov.uid.clone(),
        issue_date: HOY.into(),
        expected_date: Some("2026-10-10".into()),
        lines: vec![
            buy(Some(&martillo.uid), "Martillo", 20, 7_000),
            buy(None, "Flete", 1, 5_000),
        ],
        notes: None,
    };
    let o = s.save_purchase_order(&input, None).unwrap();
    assert_eq!(o.summary.number, "OC-000001");
    assert_eq!(o.totals.net_minor, 145_000);
    assert_eq!(o.totals.tax_minor, 14_500);
    assert!(
        s.receive_purchase_order(&o.summary.uid, &[], HOY).is_err(),
        "borrador no se recibe"
    );
    let o = s.issue_purchase_order(&o.summary.uid).unwrap();
    assert_eq!(o.summary.status, "emitida");
    assert!(
        s.save_purchase_order(&input, Some(&o.summary.uid)).is_err(),
        "emitida no se edita"
    );

    // Recepción parcial: 5 de 20 → costo promedio (10×6.000 + 5×7.000) / 15.
    let o = s
        .receive_purchase_order(
            &o.summary.uid,
            &[ReceiveLine {
                line_no: 1,
                qty_milli: 5_000,
            }],
            HOY,
        )
        .unwrap();
    assert_eq!(o.summary.status, "parcial");
    let p = &s.search_products("martillo", 5).unwrap()[0];
    assert_eq!(p.on_hand_milli, 15_000);
    assert_eq!(p.cost_e4, 63_333_333);
    assert!(
        s.receive_purchase_order(
            &o.summary.uid,
            &[ReceiveLine {
                line_no: 1,
                qty_milli: 16_000
            }],
            HOY
        )
        .is_err(),
        "no más de lo pendiente"
    );
    assert!(
        s.void_purchase_order(&o.summary.uid, "ya no").is_err(),
        "con recepción no se anula"
    );
    let o = s
        .receive_purchase_order(&o.summary.uid, &[], "2026-10-08")
        .unwrap();
    assert_eq!(o.summary.status, "recibida");
    assert_eq!(o.receipts.len(), 2);
    assert_eq!(
        s.search_products("martillo", 5).unwrap()[0].on_hand_milli,
        30_000
    );

    // Documento del proveedor asociado a la orden: vence según el plazo del proveedor.
    let doc = PurchaseInput {
        supplier_uid: prov.uid.clone(),
        doc_kind: Some("Factura".into()),
        doc_number: Some("8841".into()),
        issue_date: HOY.into(),
        due_date: None,
        order_uid: Some(o.summary.uid.clone()),
        receive_stock: false,
        lines: input.lines.clone(),
        notes: None,
        paid_method: None,
        paid_account_uid: None,
    };
    assert!(
        s.register_purchase(&PurchaseInput {
            receive_stock: true,
            ..doc.clone()
        })
        .is_err(),
        "la orden ya ingresó el stock"
    );
    let c = s.register_purchase(&doc).unwrap();
    assert_eq!(c.summary.number, "COM-000001");
    assert_eq!(c.summary.due_date.as_deref(), Some("2026-11-05"));
    assert_eq!(c.summary.total_minor, 159_500);
    assert_eq!(c.order_number.as_deref(), Some("OC-000001"));
    assert!(s.register_purchase(&doc).is_err(), "documento duplicado");
    assert_eq!(s.purchase_order(&o.summary.uid).unwrap().purchases.len(), 1);
    assert_eq!(
        s.list_purchases(&PurchaseFilter {
            view: Some("por_pagar".into()),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );

    let c = s
        .pay_purchase(&c.summary.uid, 59_500, "Transferencia", HOY, None)
        .unwrap();
    assert_eq!(c.summary.payment_state, "abonada");
    let c = s
        .pay_purchase(&c.summary.uid, 100_000, "Transferencia", HOY, None)
        .unwrap();
    assert_eq!(c.summary.payment_state, "pagada");
    assert_eq!(c.payments.len(), 2);
    let d = s.supplier_detail(&prov.uid).unwrap();
    assert_eq!(d.purchased_minor, 159_500);
    assert_eq!(d.payable_minor, 0);
    assert_eq!(s.price_history(&martillo.uid).unwrap().len(), 2);
    assert!(s.verify_audit().unwrap().ok);
}

#[test]
fn compra_directa_con_ingreso_y_anulacion() {
    let (_d, _app, mut s) = session();
    let clavo = s
        .add_product(&NewProduct {
            sku: None,
            name: "Clavo 2\"".into(),
            unit: Some("kg".into()),
            kind: "producto".into(),
            price_minor: 3_000,
            cost_minor: Some(1_000),
            taxable: Some(true),
            initial_stock_milli: Some(2_000),
        })
        .unwrap();
    let prov = s
        .add_supplier(&NewSupplier {
            name: "Ferretería Mayorista".into(),
            ..Default::default()
        })
        .unwrap();
    let doc = PurchaseInput {
        supplier_uid: prov.uid.clone(),
        doc_kind: Some("Boleta".into()),
        doc_number: Some("120".into()),
        issue_date: HOY.into(),
        due_date: None,
        order_uid: None,
        receive_stock: true,
        lines: vec![buy(Some(&clavo.uid), "Clavo 2\"", 8, 1_500)],
        notes: None,
        paid_method: Some("Efectivo".into()),
        paid_account_uid: None,
    };
    let c = s.register_purchase(&doc).unwrap();
    assert!(c.received_stock);
    assert_eq!(c.summary.payment_state, "pagada");
    let p = &s.search_products("clavo", 5).unwrap()[0];
    assert_eq!(p.on_hand_milli, 10_000);
    assert_eq!(p.cost_e4, 14_000_000); // (2×1.000 + 8×1.500) / 10

    let c = s
        .void_purchase(&c.summary.uid, "Monto mal digitado")
        .unwrap();
    assert_eq!(c.summary.status, "anulada");
    assert!(c.payments.is_empty());
    let p = &s.search_products("clavo", 5).unwrap()[0];
    assert_eq!(p.on_hand_milli, 2_000);
    assert_eq!(p.cost_e4, 10_000_000, "vuelve el costo anterior");
    // El mismo documento corregido se puede volver a registrar.
    s.register_purchase(&PurchaseInput {
        lines: vec![buy(Some(&clavo.uid), "Clavo 2\"", 8, 1_400)],
        ..doc
    })
    .unwrap();
    assert!(s.verify_audit().unwrap().ok);
}
