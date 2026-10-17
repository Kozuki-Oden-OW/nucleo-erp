//! Conciliación bancaria con cartola: importar sin duplicar, conciliar solo lo evidente, sugerir
//! cobros, pagos y gastos (con categoría según la descripción), traspasos, ignorar y deshacer.

use nucleo_app::bank_ops::{ImportStatementInput, ReconcileAction, StatementLineInput};
use nucleo_app::company::NewCustomer;
use nucleo_app::finance_ops::{AccountInput, ExpenseInput};
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

fn day(n: i64) -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            "SELECT date('now', 'localtime', ?1)",
            [format!("{n} days")],
            |r| r.get(0),
        )
        .unwrap()
}

fn sale(
    s: &mut CompanySession,
    customer: Option<&str>,
    product: &str,
    price: i64,
    date: &str,
    mode: &str,
    account: Option<&str>,
) -> (String, i64) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: customer.map(Into::into),
                issue_date: date.into(),
                lines: vec![LineInput {
                    product_uid: Some(product.into()),
                    description: "x".into(),
                    qty_milli: 1000,
                    unit_price_minor: price,
                    discount_ppm: 0,
                    taxable: false,
                }],
                notes: None,
                terms: None,
            },
            None,
        )
        .unwrap();
    let d = s
        .effect_sale(
            &v.summary.uid,
            &EffectInput {
                mode: mode.into(),
                method: "Transferencia".into(),
                due_date: (mode == "credito").then(|| date.to_string()),
                account_uid: account.map(Into::into),
            },
        )
        .unwrap();
    (v.summary.uid, d.totals.total_minor)
}

fn line(date: &str, desc: &str, amount: i64, balance: Option<i64>) -> StatementLineInput {
    StatementLineInput {
        date: date.into(),
        description: desc.into(),
        reference: None,
        amount_minor: amount,
        balance_minor: balance,
    }
}

fn act(kind: &str) -> ReconcileAction {
    ReconcileAction {
        kind: kind.into(),
        target_uid: None,
        category_id: None,
        description: None,
        tax_included: None,
        supplier_uid: None,
        note: None,
    }
}

#[test]
fn cartola_importa_sugiere_y_concilia() {
    let (_d, _app, mut s) = session();
    let accs = s
        .create_money_account(&AccountInput {
            kind: "banco".into(),
            name: "Cuenta corriente".into(),
            bank_name: Some("BancoEstado".into()),
            account_label: None,
            opening_minor: 1_000_000,
            opening_date: Some(day(-30)),
        })
        .unwrap();
    let bank = accs
        .iter()
        .find(|a| a.name == "Cuenta corriente")
        .unwrap()
        .uid
        .clone();
    let accs = s
        .create_money_account(&AccountInput {
            kind: "caja".into(),
            name: "Caja del local".into(),
            bank_name: None,
            account_label: None,
            opening_minor: 800_000,
            opening_date: Some(day(-30)),
        })
        .unwrap();
    let caja = accs
        .iter()
        .find(|a| a.name == "Caja del local")
        .unwrap()
        .uid
        .clone();
    let p = s
        .add_product(&NewProduct {
            sku: None,
            name: "Taladro".into(),
            unit: None,
            kind: "servicio".into(),
            price_minor: 1,
            cost_minor: None,
            taxable: Some(false),
            initial_stock_milli: None,
            category_uid: None,
            extra_category_uids: None,
            cost_sheet: None,
            stock_policy: None,
        })
        .unwrap()
        .uid;
    let clinica = s
        .add_customer(&NewCustomer {
            name: "Clínica Los Lagos SpA".into(),
            ..Default::default()
        })
        .unwrap()
        .uid;
    let (_, credito) = sale(
        &mut s,
        Some(&clinica),
        &p,
        119_000,
        &day(-10),
        "credito",
        None,
    );
    let (_, contado) = sale(&mut s, None, &p, 45_000, &day(-6), "contado", Some(&bank));
    let cats = s.expense_categories().unwrap();
    let arriendo = cats.iter().find(|c| c.name == "Arriendo").unwrap().id;
    let combustible = cats.iter().find(|c| c.name == "Combustible").unwrap().id;
    s.register_expense(&ExpenseInput {
        category_id: arriendo,
        supplier_uid: None,
        date: day(-5),
        description: "Arriendo octubre".into(),
        total_minor: 50_000,
        tax_included: false,
        due_date: Some(day(0)),
        paid_method: None,
        paid_account_uid: None,
        notes: None,
        recurring_id: None,
        quantity_milli: None,
        unit_minor: None,
    })
    .unwrap();

    let final_balance = 1_000_000 + credito + contado - 35_990 - 50_000 + 300_000 - 200_000;
    let lines = vec![
        line(&day(-4), "TRANSF DE CLINICA LOS LAGOS", credito, None),
        line(&day(-4), "TRANSFERENCIA RECIBIDA", contado, None),
        line(&day(-3), "COMPRA COPEC LOS LAGOS", -35_990, None),
        line(&day(-3), "PAGO ARRIENDO", -50_000, None),
        line(&day(-2), "DEPOSITO EFECTIVO", 300_000, None),
        line(&day(0), "GIRO DUEÑO", -200_000, Some(final_balance)),
    ];
    let input = ImportStatementInput {
        account_uid: bank.clone(),
        file_name: Some("cartola.csv".into()),
        lines: lines.clone(),
    };
    let r = s.import_bank_statement(&input).unwrap();
    assert_eq!(
        (r.added, r.duplicates, r.auto_matched),
        (6, 0, 1),
        "solo el cobro ya registrado se concilia solo"
    );
    let again = s.import_bank_statement(&input).unwrap();
    assert_eq!(
        (again.added, again.duplicates),
        (0, 6),
        "la misma cartola no se duplica"
    );

    let v = s.bank_reconciliation(&bank).unwrap();
    let find = |v: &nucleo_app::bank_ops::ReconciliationView, d: &str| {
        v.lines.iter().find(|l| l.description == d).unwrap().clone()
    };
    assert_eq!(find(&v, "TRANSFERENCIA RECIBIDA").status, "conciliado");
    // Abono de un cliente con venta por cobrar: sugerencia de cobro, con su nombre.
    let l = find(&v, "TRANSF DE CLINICA LOS LAGOS");
    let sug = &l.suggestions[0];
    assert_eq!(sug.action, "cobrar");
    assert!(sug.score >= 85);
    let v = s
        .reconcile_bank_line(
            &l.uid,
            &ReconcileAction {
                target_uid: sug.target_uid.clone(),
                ..act("cobrar")
            },
        )
        .unwrap();
    // Cargo COPEC: gasto con categoría sugerida.
    let l = find(&v, "COMPRA COPEC LOS LAGOS");
    let g = l.suggestions.iter().find(|x| x.action == "gasto").unwrap();
    assert_eq!(g.category_id, Some(combustible));
    let v = s
        .reconcile_bank_line(
            &l.uid,
            &ReconcileAction {
                category_id: g.category_id,
                ..act("gasto")
            },
        )
        .unwrap();
    // Cargo que calza con un gasto por pagar.
    let l = find(&v, "PAGO ARRIENDO");
    let pg = l
        .suggestions
        .iter()
        .find(|x| x.action == "pagar_gasto")
        .unwrap();
    let v = s
        .reconcile_bank_line(
            &l.uid,
            &ReconcileAction {
                target_uid: pg.target_uid.clone(),
                ..act("pagar_gasto")
            },
        )
        .unwrap();
    // Depósito de efectivo: traspaso desde la caja (sugerido primero entre los traspasos).
    let l = find(&v, "DEPOSITO EFECTIVO");
    let t = l
        .suggestions
        .iter()
        .find(|x| x.action == "traspaso")
        .unwrap();
    assert_eq!(t.target_uid.as_deref(), Some(caja.as_str()));
    let v = s
        .reconcile_bank_line(
            &l.uid,
            &ReconcileAction {
                target_uid: t.target_uid.clone(),
                ..act("traspaso")
            },
        )
        .unwrap();
    // Giro del dueño: se ignora con nota (la nota es obligatoria).
    let l = find(&v, "GIRO DUEÑO");
    assert!(s.reconcile_bank_line(&l.uid, &act("ignorar")).is_err());
    let v = s
        .reconcile_bank_line(
            &l.uid,
            &ReconcileAction {
                note: Some("Retiro del dueño".into()),
                ..act("ignorar")
            },
        )
        .unwrap();

    assert_eq!((v.pending, v.reconciled, v.ignored), (0, 5, 1));
    assert_eq!(v.statement_balance_minor, Some(final_balance));
    assert_eq!(
        v.nucleo_balance_minor,
        Some(final_balance + 200_000),
        "el giro ignorado explica la diferencia"
    );
    assert!(v.unmatched.is_empty());
    let caja_row = s
        .money_accounts()
        .unwrap()
        .into_iter()
        .find(|a| a.uid == caja)
        .unwrap();
    assert_eq!(caja_row.balance_minor, 500_000);

    // Deshacer y volver a vincular el cobro que quedó registrado.
    let l = find(&v, "TRANSF DE CLINICA LOS LAGOS");
    let v = s.reconcile_bank_line(&l.uid, &act("deshacer")).unwrap();
    let l = find(&v, "TRANSF DE CLINICA LOS LAGOS");
    assert_eq!(l.status, "pendiente");
    assert_eq!(
        v.unmatched.len(),
        1,
        "el cobro registrado queda sin movimiento del banco"
    );
    assert_eq!(l.suggestions[0].action, "vincular");
    let v = s.auto_reconcile_bank(&bank).unwrap();
    assert_eq!(v.pending, 0);
    assert!(s.verify_audit().unwrap().ok);
}
