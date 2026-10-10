//! Borrador del F22 Pro Pyme general (Fase 10, hito C): recuadro 17 desde lo cobrado y lo pagado,
//! PPM de los F29 declarados, ajustes manuales y registros.

use nucleo_app::f22_ops::F22Inputs;
use nucleo_app::f29_ops::{F29Inputs, TaxProfile};
use nucleo_app::finance_ops::ExpenseInput;
use nucleo_app::sales_ops::{EffectInput, LineInput, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use nucleo_domain::f22::{F22Line, F22Params, Registers};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Comercial Ejemplo", BusinessProfile::Negocio)
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

#[test]
fn f22_desde_cobros_y_pagos() {
    let (_d, _app, mut s) = session();
    let year: i32 = today()[..4].parse().unwrap();
    // Venta exenta de impuesto (el negocio no calcula IVA) cobrada al contado: 1.000.000.
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: None,
                issue_date: today(),
                lines: vec![LineInput {
                    product_uid: None,
                    description: "Servicio".into(),
                    qty_milli: 1000,
                    unit_price_minor: 1_000_000,
                    discount_ppm: 0,
                    taxable: false,
                }],
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
            method: "Transferencia".into(),
            due_date: None,
            account_uid: None,
        },
    )
    .unwrap();
    // Arriendo pagado: 300.000.
    let cats = s.expense_categories().unwrap();
    let arriendo = cats.iter().find(|c| c.name == "Arriendo").unwrap().id;
    s.register_expense(&ExpenseInput {
        category_id: arriendo,
        supplier_uid: None,
        date: today(),
        description: "Arriendo local".into(),
        total_minor: 300_000,
        tax_included: false,
        due_date: None,
        paid_method: Some("Transferencia".into()),
        paid_account_uid: None,
        notes: None,
        recurring_id: None,
    })
    .unwrap();

    let f = s.f22(year).unwrap();
    let d = |c: u32| f.derived.iter().find(|l| l.code == c).map(|l| l.used);
    assert_eq!(d(1400), Some(1_000_000));
    assert_eq!(d(1415), Some(300_000));
    assert!(!f.result.complete, "sin tasa no está completo");

    // PPM de un F29 declarado de enero.
    s.save_tax_profile(&TaxProfile {
        ppm_rate_ppm: Some(10_000),
        ..TaxProfile::default()
    })
    .unwrap();
    let jan = format!("{year}-01");
    s.save_f29_inputs(
        &jan,
        &F29Inputs {
            ppm_base_override: Some(2_000_000),
            ..Default::default()
        },
    )
    .unwrap();
    s.mark_f29_declared(&jan, 0, 20_000, None).unwrap();

    let mut inputs = F22Inputs {
        params: F22Params {
            idpc_rate_ppm: 125_000,
            ..Default::default()
        },
        art21: 50_000,
        ..Default::default()
    };
    inputs.ppm_factors.insert("01".into(), 1_010_000);
    inputs.overrides.insert("1415".into(), 360_000);
    inputs.extra.push(F22Line {
        code: 1426,
        amount: 100_000,
        label: Some("Pérdida 2025".into()),
    });
    inputs.registers = Registers {
        cpts_initial: 2_000_000,
        capital_historic: 1_000_000,
        ..Default::default()
    };
    let f = s.save_f22_inputs(year, &inputs).unwrap();
    let c = |k: u32| f.result.codes.get(&k).copied().unwrap_or(0);
    assert_eq!(f.ppm[0].amount, Some(20_000));
    assert_eq!(c(36), 20_200);
    assert_eq!(c(1588), 200, "reajuste de PPM como otro ingreso");
    assert_eq!(c(1410), 1_000_200);
    assert_eq!(c(1430), 360_000 + 100_000 + 50_000);
    assert_eq!(c(1440), 1_000_200 - 510_000 + 50_000);
    assert_eq!(c(20), (540_200 * 125 + 500) / 1000);
    assert_eq!(c(305), c(20) - 20_200);
    assert_eq!(c(1545), 2_000_000 + 540_200 - 50_000);
    assert!(f.result.complete, "{:?}", f.result.notes);
    // Código que no es del recuadro 17.
    let mut bad = inputs.clone();
    bad.overrides.insert("20".into(), 1);
    assert!(s.save_f22_inputs(year, &bad).is_err());
}
