//! Fase 12 B y C: «Requiere tu atención» (alertas con reglas), análisis de productos y de clientes.

use nucleo_app::company::NewCustomer;
use nucleo_app::insight_ops::AlertSettings;
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
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            "SELECT date('now', 'localtime', ?1)",
            [format!("-{n} days")],
            |r| r.get(0),
        )
        .unwrap()
}

fn product(s: &mut CompanySession, name: &str, price: i64, cost: i64, stock: i64) -> String {
    s.add_product(&NewProduct {
        sku: None,
        name: name.into(),
        unit: None,
        kind: "producto".into(),
        price_minor: price,
        cost_minor: Some(cost),
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

fn customer(s: &mut CompanySession, name: &str) -> String {
    s.add_customer(&NewCustomer {
        name: name.into(),
        ..Default::default()
    })
    .unwrap()
    .uid
}

fn sell(s: &mut CompanySession, customer: Option<&str>, lines: &[(&str, i64, i64)], date: &str) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: customer.map(Into::into),
                issue_date: date.into(),
                lines: lines
                    .iter()
                    .map(|(p, units, price)| LineInput {
                        product_uid: Some((*p).into()),
                        description: "x".into(),
                        qty_milli: units * 1000,
                        unit_price_minor: *price,
                        discount_ppm: 0,
                        taxable: true,
                    })
                    .collect(),
                notes: None,
                terms: None,
            },
            None,
        )
        .unwrap();
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: "contado".into(),
            method: "Efectivo".into(),
            due_date: None,
            account_uid: None,
        },
    )
    .unwrap();
}

#[test]
fn alertas_y_analisis_de_productos_y_clientes() {
    let (_d, _app, mut s) = session();
    let taladro = product(&mut s, "Taladro", 15_000, 10_000, 100);
    let lija = product(&mut s, "Lija", 1_000, 950, 100);
    let broca = product(&mut s, "Broca", 2_000, 1_000, 2);
    let frecuente = customer(&mut s, "Constructora Frecuente");
    let activo = customer(&mut s, "Taller Activo");
    let nuevo = customer(&mut s, "Vecino Nuevo");

    // Frecuente: cada 30 días, la última hace 80 → en riesgo.
    for d in [200, 170, 140, 110, 80] {
        sell(
            &mut s,
            Some(&frecuente),
            &[(&taladro, 1, 15_000)],
            &days_ago(d),
        );
    }
    for d in [60, 30] {
        sell(
            &mut s,
            Some(&activo),
            &[(&taladro, 2, 15_000)],
            &days_ago(d),
        );
    }
    sell(
        &mut s,
        Some(&activo),
        &[(&lija, 10, 1_000), (&broca, 2, 2_000)],
        &days_ago(0),
    );
    sell(&mut s, Some(&nuevo), &[(&taladro, 1, 15_000)], &days_ago(0));

    let kinds: Vec<String> = s.alerts().unwrap().into_iter().map(|a| a.kind).collect();
    for k in ["sin_stock", "margen_bajo", "clientes_riesgo"] {
        assert!(
            kinds.contains(&k.to_string()),
            "falta la alerta {k}: {kinds:?}"
        );
    }
    assert!(
        !kinds.contains(&"detenidos".to_string()),
        "productos recién creados no están detenidos"
    );
    let a = s.alerts().unwrap();
    let sin = a.iter().find(|x| x.kind == "sin_stock").unwrap();
    assert_eq!(sin.count, 1);
    assert_eq!(sin.lines[0].label, "Broca");
    assert_eq!(sin.severity, "alta");

    // Reglas: apagar una alerta y validar rangos.
    let cfg = s
        .update_alert_settings(&AlertSettings {
            disabled: vec!["margen_bajo".into(), "no_existe".into()],
            ..AlertSettings::default()
        })
        .unwrap();
    assert_eq!(cfg.disabled, ["margen_bajo"]);
    assert!(!s.alerts().unwrap().iter().any(|x| x.kind == "margen_bajo"));
    assert!(
        s.update_alert_settings(&AlertSettings {
            idle_days: 3,
            ..AlertSettings::default()
        })
        .is_err()
    );

    // Inicio: hoy compraron 2 clientes; margen y alertas incluidas.
    let d = s.dashboard().unwrap();
    assert_eq!(d.today_customers, 2);
    assert_eq!(
        d.today_profit_minor,
        (10_000 + 4_000 + 15_000) - (9_500 + 2_000 + 10_000)
    );
    assert!(d.month_margin_ppm.is_some());
    assert!(d.alerts.iter().any(|x| x.kind == "sin_stock"));
    assert_eq!(d.series.len(), 12);

    // Productos (365 días): el taladro es A y deja más; la lija tiene margen bajo.
    let p = s.product_insights(365).unwrap();
    let t = p.rows.iter().find(|r| r.uid == taladro).unwrap();
    assert_eq!(t.abc, "A");
    assert_eq!(t.qty_milli, 10_000);
    assert_eq!(t.margin_minor, 50_000);
    let l = p.rows.iter().find(|r| r.uid == lija).unwrap();
    assert!(l.low_margin);
    assert_eq!(l.margin_ppm, Some(50_000));
    assert!(!t.explanation.is_empty());
    let trend = s.product_trend(&taladro).unwrap();
    assert_eq!(trend.len(), 12);
    assert_eq!(
        trend.iter().map(|x| x.qty_milli).sum::<i64>(),
        10_000,
        "todas caen en los 12 meses"
    );

    // Clientes: estados y clasificación.
    let c = s.customer_insights().unwrap();
    let st = |uid: &str| c.rows.iter().find(|r| r.uid == uid).unwrap().state.clone();
    assert_eq!(st(&frecuente), "en_riesgo");
    assert_eq!(st(&activo), "activo");
    assert_eq!(st(&nuevo), "nuevo");
    let f = c.rows.iter().find(|r| r.uid == frecuente).unwrap();
    assert_eq!(f.purchases, 5);
    assert_eq!(f.avg_interval_days, Some(30));
    assert_eq!(f.days_since, Some(80));
    assert!(c.top_share_ppm > 0);
}
