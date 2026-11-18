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
