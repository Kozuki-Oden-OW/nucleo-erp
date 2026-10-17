//! Fase 10 · Contabilidad automática: asientos desde los documentos, libros que cuadran, asientos
//! manuales con reversa, cierre y reapertura de meses.

use nucleo_app::accounting_ops::{LedgerAccountInput, ManualEntryInput, ManualLineInput};
use nucleo_app::finance_ops::ExpenseInput;
use nucleo_app::inventory_ops::{AdjustmentInput, StockLineInput};
use nucleo_app::report_ops::ReportParams;
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

fn sql_date(expr: &str) -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            &format!("SELECT date('now', 'localtime', {expr})"),
            [],
            |r| r.get(0),
        )
        .unwrap()
}

fn sell(s: &mut CompanySession, product: &str, units: i64, price: i64, date: &str, credit: bool) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: None,
                issue_date: date.into(),
                lines: vec![LineInput {
                    product_uid: Some(product.into()),
                    description: "x".into(),
                    qty_milli: units * 1000,
                    unit_price_minor: price,
                    discount_ppm: 0,
                    taxable: true,
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
            mode: if credit { "credito" } else { "contado" }.into(),
            method: "Efectivo".into(),
            due_date: credit.then(|| date.to_string()),
            account_uid: None,
        },
    )
    .unwrap();
}

fn report(s: &CompanySession, id: &str, from: &str, to: &str) -> nucleo_app::report_ops::Report {
    s.report(&ReportParams {
        id: id.into(),
        from: Some(from.into()),
        to: Some(to.into()),
        group: None,
    })
    .unwrap()
}

#[test]
fn asientos_libros_cierre_y_reapertura() {
    let (_d, _app, mut s) = session();
    let today = sql_date("'+0 days'");
    let prev_start = sql_date("'start of month', '-1 month'");
    let prev_mid = sql_date("'start of month', '-1 month', '+14 days'");
    let prev = prev_start[..7].to_string();
    let year_start = sql_date("'start of month', '-13 months'");

    let p = s
        .add_product(&NewProduct {
            sku: Some("MAR-1".into()),
            name: "Martillo".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 2_000,
            cost_minor: Some(1_000),
            taxable: Some(true),
            initial_stock_milli: Some(10_000),
            category_uid: None,
            extra_category_uids: None,
            cost_sheet: None,
            stock_policy: None,
        })
        .unwrap();
    sell(&mut s, &p.uid, 2, 2_000, &prev_mid, false);
    sell(&mut s, &p.uid, 1, 2_000, &today, false);
    let cats = s.expense_categories().unwrap();
    let arriendo = cats.iter().find(|c| c.name == "Arriendo").unwrap().id;
    s.register_expense(&ExpenseInput {
        category_id: arriendo,
        supplier_uid: None,
        date: prev_mid.clone(),
        description: "Arriendo local".into(),
        total_minor: 300_000,
        tax_included: false,
        due_date: None,
        paid_method: Some("Transferencia".into()),
        paid_account_uid: None,
        notes: None,
        recurring_id: None,
        quantity_milli: None,
        unit_minor: None,
    })
    .unwrap();
    let main = s
        .warehouses()
        .unwrap()
        .into_iter()
        .find(|w| w.is_default)
        .unwrap()
        .uid;
    s.adjust_stock(&AdjustmentInput {
        warehouse_uid: main,
        date: today.clone(),
        kind: "ajuste".into(),
        reason: "Martillo roto".into(),
        lines: vec![StockLineInput {
            product_uid: p.uid.clone(),
            qty_milli: -1_000,
        }],
    })
    .unwrap();

    // Cada asiento cuadra y hay asientos de venta, cobro, gasto, pago, ajuste y apertura.
    let j = s.journal(&year_start, &today).unwrap();
    assert!(j.iter().all(|e| {
        e.lines.iter().map(|l| l.debit_minor).sum::<i64>()
            == e.lines.iter().map(|l| l.credit_minor).sum::<i64>()
    }));
    for st in ["VEN", "PAG", "GAS", "EGR", "AJU"] {
        assert!(
            j.iter().any(|e| e.source_type.as_deref() == Some(st)),
            "falta asiento {st}: {:?}",
            j.iter().map(|e| e.source_type.clone()).collect::<Vec<_>>()
        );
    }
    assert!(j.iter().any(|e| e.origin == "apertura"));
    let adj = j
        .iter()
        .find(|e| e.source_type.as_deref() == Some("AJU"))
        .unwrap();
    assert!(
        adj.lines
            .iter()
            .any(|l| l.account_code == "5.1.02" && l.debit_minor == 1_000)
    );
    let gas = j
        .iter()
        .find(|e| e.source_type.as_deref() == Some("GAS"))
        .unwrap();
    assert!(
        gas.lines
            .iter()
            .any(|l| l.account_code == "5.2.04" && l.debit_minor > 0),
        "arriendo va a local y oficina"
    );

    // Los libros cuadran.
    let bc = report(&s, "balance_comprobacion", &year_start, &today);
    assert_eq!(bc.kpis[0].value, 0, "débitos = créditos");
    let bg = report(&s, "balance_general", &year_start, &today);
    assert_eq!(
        bg.kpis.last().unwrap().value,
        0,
        "activo = pasivo + patrimonio + resultado"
    );
    let er = report(&s, "estado_resultados", &year_start, &today);
    let ventas = er.kpis[0].value;
    assert!(ventas >= 6_000, "ventas netas: {ventas}");
    let mayor = report(&s, "libro_mayor", &today, &today);
    assert!(!mayor.rows.is_empty());
    let diario = report(&s, "libro_diario", &year_start, &today);
    assert_eq!(diario.kpis[2].value, 0);

    // Asientos manuales: cuadrados, con cuentas de detalle; se reversan sin borrar.
    let bad = ManualEntryInput {
        date: today.clone(),
        description: "Aporte de capital".into(),
        lines: vec![
            ManualLineInput {
                account_code: "1.1.02".into(),
                debit_minor: 500_000,
                credit_minor: 0,
                memo: None,
            },
            ManualLineInput {
                account_code: "3.1.01".into(),
                debit_minor: 0,
                credit_minor: 400_000,
                memo: None,
            },
        ],
    };
    assert!(s.add_manual_entry(&bad).is_err(), "no cuadra");
    let mut good = bad.clone();
    good.lines[1].credit_minor = 500_000;
    let e = s.add_manual_entry(&good).unwrap();
    assert_eq!(e.reference, "AS-000001");
    assert!(
        s.add_manual_entry(&ManualEntryInput {
            lines: vec![
                ManualLineInput {
                    account_code: "1.1".into(),
                    debit_minor: 1,
                    credit_minor: 0,
                    memo: None
                },
                ManualLineInput {
                    account_code: "3.1.01".into(),
                    debit_minor: 0,
                    credit_minor: 1,
                    memo: None
                },
            ],
            ..good.clone()
        })
        .is_err(),
        "cuenta de agrupación"
    );
    let r = s
        .reverse_manual_entry(&e.key, "Digitado dos veces")
        .unwrap();
    assert_eq!(r.lines[0].credit_minor, 500_000);
    assert!(s.reverse_manual_entry(&e.key, "otra vez").is_err());

    // Subcuenta nueva bajo una cuenta de agrupación.
    let accs = s
        .save_ledger_account(&LedgerAccountInput {
            code: None,
            parent_code: Some("1.1".into()),
            name: "Fondo por rendir".into(),
            simple_name: None,
        })
        .unwrap();
    assert!(
        accs.iter()
            .any(|a| a.code == "1.1.08" && a.name == "Fondo por rendir")
    );

    // Subcuenta bajo una cuenta de detalle: la madre agrupa y los movimientos van a la nueva
    // (no se permite si la madre ya tiene asientos guardados, como 1.1.02 con el asiento manual).
    assert!(
        s.save_ledger_account(&LedgerAccountInput {
            code: None,
            parent_code: Some("1.1.02".into()),
            name: "Banco".into(),
            simple_name: None
        })
        .is_err()
    );
    s.save_ledger_account(&LedgerAccountInput {
        code: None,
        parent_code: Some("1.1.01".into()),
        name: "Caja del local".into(),
        simple_name: None,
    })
    .unwrap();
    assert_eq!(s.accounting_map().unwrap().concepts["caja"], "1.1.01.01");
    let j = s.journal(&year_start, &today).unwrap();
    assert!(
        j.iter()
            .flat_map(|e| &e.lines)
            .all(|l| l.account_code != "1.1.01")
    );
    assert_eq!(
        report(&s, "balance_general", &year_start, &today)
            .kpis
            .last()
            .unwrap()
            .value,
        0
    );

    // Cierre del mes anterior: queda guardado, igual a lo calculado; bloquea asientos manuales.
    let periods = s.close_period(&prev).unwrap();
    let pr = periods.iter().find(|x| x.period == prev).unwrap();
    assert_eq!(pr.status, "cerrado");
    assert!(!pr.changed);
    assert!(pr.entries >= 3);
    assert!(
        s.close_period(&today[..7]).is_err(),
        "el mes en curso no se cierra"
    );
    let (ps, pe) = (prev_start.clone(), sql_date("'start of month', '-1 day'"));
    let stored = s.journal(&ps, &pe).unwrap();
    assert!(
        stored
            .iter()
            .filter(|e| e.origin != "manual")
            .all(|e| e.status == "contabilizado")
    );
    assert!(
        s.add_manual_entry(&ManualEntryInput {
            date: prev_mid.clone(),
            ..good.clone()
        })
        .is_err()
    );

    // Un documento nuevo con fecha del mes cerrado: el cierre avisa la diferencia.
    sell(&mut s, &p.uid, 1, 2_000, &prev_mid, false);
    let pr = s
        .accounting_periods()
        .unwrap()
        .into_iter()
        .find(|x| x.period == prev)
        .unwrap();
    assert!(pr.changed);
    // Reabrir: vuelve a calcularse e incluye la venta nueva.
    assert!(s.reopen_period(&prev, " ").is_err());
    let pr = s
        .reopen_period(&prev, "Venta atrasada")
        .unwrap()
        .into_iter()
        .find(|x| x.period == prev)
        .unwrap();
    assert_eq!(pr.status, "abierto");
    assert_eq!(
        s.journal(&ps, &pe)
            .unwrap()
            .iter()
            .filter(|e| e.source_type.as_deref() == Some("VEN"))
            .count(),
        2
    );
    assert!(s.verify_audit().unwrap().ok);
}
