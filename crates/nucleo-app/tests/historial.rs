//! Importar ventas históricas: facturas y guías ya emitidas quedan como historial sin mover stock,
//! dinero ni contabilidad, y se pueden importar de nuevo sin duplicar.

use nucleo_app::history_ops::{HistoricalCustomer, HistoricalLine, HistoricalSale};
use nucleo_app::sales_ops::{NewProduct, SaleFilter};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn invoice(
    folio: &str,
    date: &str,
    rut: &str,
    lines: Vec<(Option<&str>, &str, i64, i64, i64)>,
) -> HistoricalSale {
    let net: i64 = lines.iter().map(|l| l.4).sum();
    let tax = (net as f64 * 0.19).round() as i64; // tasa de EJEMPLO para la prueba
    HistoricalSale {
        doc_kind: "Factura electrónica".into(),
        number: folio.into(),
        issue_date: date.into(),
        customer: Some(HistoricalCustomer {
            name: "Clínica de Prueba SpA".into(),
            rut: Some(rut.into()),
            business_activity: Some("Actividades de hospitales".into()),
            address: Some("Av. Siempre Viva 123".into()),
            commune: Some("Providencia".into()),
            city: Some("Santiago".into()),
            email: None,
        }),
        lines: lines
            .into_iter()
            .map(|(sku, d, q, p, n)| HistoricalLine {
                product_sku: sku.map(String::from),
                description: d.into(),
                qty_milli: q * 1000,
                unit_price_minor: p,
                net_minor: n,
                taxable: true,
            })
            .collect(),
        net_minor: net,
        exempt_minor: 0,
        tax_minor: tax,
        total_minor: net + tax,
        payment_terms: Some("Crédito".into()),
        references: Some("Orden Compra N° 123".into()),
        void_reason: None,
        documented: true,
        notes: None,
        due_date: None,
        terms: None,
    }
}

#[test]
fn historial_sin_stock_ni_dinero_y_sin_duplicar() {
    let (_d, _app, mut s) = session();
    s.add_product(&NewProduct {
        sku: Some("RC5".into()),
        name: "RC-5+".into(),
        unit: None,
        kind: "producto".into(),
        price_minor: 25_000,
        cost_minor: Some(15_000),
        taxable: Some(true),
        initial_stock_milli: Some(10_000),
        category_uid: None,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap();
    let before = s.dashboard().unwrap();

    let valid = invoice(
        "82",
        "2025-06-06",
        "76.108.556-5",
        vec![
            (Some("RC5"), "RC-5+ con sonda", 4, 25_000, 95_000),
            (None, "Verificación", 1, 15_000, 15_000),
        ],
    );
    let mut voided = invoice(
        "89",
        "2025-07-24",
        "76.108.556-5",
        vec![(None, "Mapeo térmico", 1, 100_000, 100_000)],
    );
    voided.void_reason = Some("Anulada por nota de crédito Nº 4".into());
    let mut guide = invoice(
        "22",
        "2026-09-01",
        "61.606.903-9",
        vec![(None, "RC-5+ sin sonda", 2, 20_000, 40_000)],
    );
    guide.doc_kind = "Guía de despacho".into();
    guide.documented = false;
    let mut bad = invoice(
        "90",
        "2025-07-25",
        "76.108.556-5",
        vec![(None, "X", 1, 1_000, 1_000)],
    );
    bad.total_minor += 500;

    let r = s
        .import_historical_sales(&[valid.clone(), voided.clone(), guide.clone(), bad])
        .unwrap();
    assert_eq!((r.imported, r.skipped, r.errors), (3, 0, 1));
    assert_eq!(r.customers_created, 2, "un cliente por RUT");
    assert!(
        r.results[3]
            .message
            .as_deref()
            .unwrap()
            .contains("no cuadran")
    );

    // No movió stock ni dinero.
    assert_eq!(
        s.search_products("RC5", 5).unwrap()[0].on_hand_milli,
        10_000
    );
    let after = s.dashboard().unwrap();
    assert_eq!(after.cash_minor, before.cash_minor);
    assert_eq!(after.receivable_minor, 0);

    let all = s
        .list_sales(&SaleFilter {
            query: None,
            view: Some("todas".into()),
        })
        .unwrap();
    let fe = all.iter().find(|x| x.number == "FE-82").unwrap();
    assert!(fe.historical);
    assert_eq!(fe.commercial_state, "cerrada");
    assert_eq!(fe.documentation_state, "documentada");
    assert_eq!(fe.total_minor, valid.total_minor);
    let det = s.sale(&fe.uid).unwrap();
    assert_eq!(det.lines.len(), 2);
    assert!(
        det.cost_minor > 0,
        "costo desde el producto enlazado para el margen"
    );
    let voids = s
        .list_sales(&SaleFilter {
            query: None,
            view: Some("anuladas".into()),
        })
        .unwrap();
    assert_eq!(
        voids
            .iter()
            .find(|x| x.number == "FE-89")
            .unwrap()
            .commercial_state,
        "anulada"
    );
    let gd = all.iter().find(|x| x.number == "GD-22").unwrap();
    assert_eq!(gd.documentation_state, "pendiente");
    assert_eq!(
        s.list_sales(&SaleFilter {
            query: None,
            view: Some("por_cobrar".into())
        })
        .unwrap()
        .len(),
        0
    );

    // Sin asientos contables.
    assert!(
        s.journal("2025-01-01", "2026-12-31")
            .unwrap()
            .iter()
            .all(|j| !j.reference.starts_with("FE-") && !j.reference.starts_with("GD-"))
    );

    // Importar de nuevo no duplica.
    let again = s.import_historical_sales(&[valid, voided, guide]).unwrap();
    assert_eq!((again.imported, again.skipped), (0, 3));
    assert_eq!(s.search_customers("", 50).unwrap().len(), 2);
}

#[test]
fn factura_a_credito_queda_por_cobrar_y_se_puede_cobrar() {
    let (_d, _app, mut s) = session();
    s.add_product(&NewProduct {
        sku: Some("RC17".into()),
        name: "RC-17N".into(),
        unit: None,
        kind: "producto".into(),
        price_minor: 9_900,
        cost_minor: Some(5_000),
        taxable: Some(true),
        initial_stock_milli: Some(50_000),
        category_uid: None,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap();

    // Nueva: trae vencimiento y la orden de compra estructurada.
    let mut credit = invoice(
        "521",
        "2026-11-18",
        "76.716.680-K",
        vec![(Some("RC17"), "RC-17N", 200, 4_790, 958_000)],
    );
    credit.due_date = Some("2026-12-18".into());
    credit.terms = Some(nucleo_app::sale_terms::SaleTerms {
        references: vec![nucleo_app::sale_terms::SaleReference {
            kind: "801".into(),
            folio: "22.112".into(),
            date: Some("2026-11-18".into()),
            note: None,
        }],
        ..Default::default()
    });
    // Ya importada como pagada: al reimportar con vencimiento queda por cobrar.
    let paid_first = invoice(
        "522",
        "2026-11-18",
        "77.471.270-4",
        vec![(None, "RCW-360 4G", 5, 204_580, 1_022_900)],
    );
    let r = s
        .import_historical_sales(&[credit.clone(), paid_first.clone()])
        .unwrap();
    assert_eq!((r.imported, r.errors), (2, 0));

    let mut again = paid_first.clone();
    again.due_date = Some("2026-12-18".into());
    let r2 = s
        .import_historical_sales(&[again.clone(), credit.clone()])
        .unwrap();
    assert_eq!(
        (r2.updated, r2.skipped, r2.errors),
        (1, 1, 0),
        "{:?}",
        r2.results
    );
    // Una tercera vez ya no cambia nada.
    let r3 = s.import_historical_sales(&[again]).unwrap();
    assert_eq!((r3.updated, r3.skipped), (0, 1));

    let open = s
        .list_sales(&SaleFilter {
            query: None,
            view: Some("por_cobrar".into()),
        })
        .unwrap();
    assert_eq!(open.len(), 2);
    let fe521 = open.iter().find(|x| x.number == "FE-521").unwrap();
    assert_eq!(fe521.commercial_state, "efectuada");
    assert_eq!(fe521.documentation_state, "documentada");
    let det = s.sale(&fe521.uid).unwrap();
    let terms = det.terms.clone().unwrap();
    assert_eq!(terms.payment, "credito");
    assert_eq!(terms.due_date.as_deref(), Some("2026-12-18"));
    assert_eq!(terms.references[0].folio, "22.112");
    // No movió stock.
    assert_eq!(
        s.search_products("RC17", 5).unwrap()[0].on_hand_milli,
        50_000
    );

    // Cobro total: queda cerrada (pagada y documentada).
    let paid = s
        .register_payment(
            &fe521.uid,
            fe521.total_minor,
            "transferencia",
            "2026-12-18",
            None,
        )
        .unwrap();
    assert_eq!(paid.summary.commercial_state, "cerrada");

    // Anular una venta histórica no devuelve stock que nunca salió.
    let fe522 = open.iter().find(|x| x.number == "FE-522").unwrap();
    s.void_sale(&fe522.uid, "prueba").unwrap();
    assert_eq!(
        s.search_products("RC17", 5).unwrap()[0].on_hand_milli,
        50_000
    );
}
