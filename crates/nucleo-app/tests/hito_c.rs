//! Hito C (Fase 8): "sé cuánto me deben, cuánto debo y cuánto tendré".

use nucleo_app::finance_ops::{
    AccountInput, ExpenseFilter, ExpenseInput, MoneyTransferInput, RecurringInput,
};
use nucleo_app::purchase_ops::{BuyLineInput, NewSupplier, PurchaseInput};
use nucleo_app::sales_ops::{EffectInput, LineInput, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Ferretería Los Andes", BusinessProfile::Negocio)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn day(n: i64) -> String {
    let d = time::OffsetDateTime::now_utc().date() + time::Duration::days(n);
    d.format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap()
}

fn account(kind: &str, name: &str, opening: i64) -> AccountInput {
    AccountInput {
        kind: kind.into(),
        name: name.into(),
        bank_name: None,
        account_label: None,
        opening_minor: opening,
        opening_date: None,
    }
}

fn sale(
    s: &mut CompanySession,
    customer: Option<String>,
    amount: i64,
    mode: &str,
    method: &str,
    due: Option<String>,
) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: customer,
                issue_date: day(0),
                lines: vec![LineInput {
                    product_uid: None,
                    description: "Servicio".into(),
                    qty_milli: 1000,
                    unit_price_minor: amount,
                    discount_ppm: 0,
                    taxable: false,
                }],
                notes: None,
            },
            None,
        )
        .unwrap();
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: mode.into(),
            method: method.into(),
            due_date: due,
            account_uid: None,
        },
    )
    .unwrap();
}

#[test]
fn cuanto_me_deben_cuanto_debo_y_cuanto_tendre() {
    let (_d, _app, mut s) = session();
    s.create_money_account(&account("caja", "Caja", 100_000))
        .unwrap();
    let accs = s
        .create_money_account(&account("banco", "Banco Estado", 500_000))
        .unwrap();
    let caja = accs.iter().find(|a| a.kind == "caja").unwrap().uid.clone();
    let banco = accs.iter().find(|a| a.kind == "banco").unwrap().uid.clone();
    assert!(
        s.create_money_account(&AccountInput {
            account_label: Some("4512 3456 7890 1234".into()),
            ..account("banco", "Tarjeta", 0)
        })
        .is_err(),
        "no se guardan números completos"
    );

    // Cobros: el efectivo entra a la caja y la transferencia al banco.
    sale(&mut s, None, 20_000, "contado", "Efectivo", None);
    sale(&mut s, None, 30_000, "contado", "Transferencia", None);
    let c = s
        .add_customer(&NewCustomer {
            name: "Constructora Sur".into(),
            ..Default::default()
        })
        .unwrap();
    sale(
        &mut s,
        Some(c.uid.clone()),
        80_000,
        "credito",
        "",
        Some(day(10)),
    );

    // Deuda con un proveedor a 20 días.
    let prov = s
        .add_supplier(&NewSupplier {
            name: "Distribuidora".into(),
            payment_terms_days: Some(20),
            ..Default::default()
        })
        .unwrap();
    s.register_purchase(&PurchaseInput {
        supplier_uid: prov.uid.clone(),
        doc_kind: Some("Factura".into()),
        doc_number: Some("10".into()),
        issue_date: day(0),
        due_date: None,
        order_uid: None,
        receive_stock: false,
        lines: vec![BuyLineInput {
            product_uid: None,
            description: "Insumos".into(),
            qty_milli: 1000,
            unit_cost_minor: 60_000,
            taxable: false,
        }],
        notes: None,
        paid_method: None,
        paid_account_uid: None,
    })
    .unwrap();

    // Gastos: uno pagado por transferencia (sale del banco) y otro por pagar en 5 días.
    let cats = s.expense_categories().unwrap();
    let luz = cats.iter().find(|c| c.name == "Electricidad").unwrap().id;
    let g = s
        .register_expense(&ExpenseInput {
            category_id: luz,
            supplier_uid: None,
            date: day(0),
            description: "Boleta de luz".into(),
            total_minor: 35_000,
            tax_included: false,
            due_date: None,
            paid_method: Some("Transferencia".into()),
            paid_account_uid: None,
            notes: None,
            recurring_id: None,
        })
        .unwrap();
    assert_eq!(g.summary.payment_state, "pagado");
    let internet = cats
        .iter()
        .find(|c| c.name == "Internet y telefonía")
        .unwrap()
        .id;
    let g2 = s
        .register_expense(&ExpenseInput {
            category_id: internet,
            supplier_uid: None,
            date: day(0),
            description: "Plan de internet".into(),
            total_minor: 25_000,
            tax_included: false,
            due_date: Some(day(5)),
            paid_method: None,
            paid_account_uid: None,
            notes: None,
            recurring_id: None,
        })
        .unwrap();
    assert_eq!(g2.summary.payment_state, "por_pagar");

    // Traspaso de la caja al banco.
    s.transfer_money(&MoneyTransferInput {
        from_uid: caja.clone(),
        to_uid: banco.clone(),
        date: day(0),
        amount_minor: 50_000,
        notes: Some("Depósito".into()),
    })
    .unwrap();
    let accs = s.money_accounts().unwrap();
    let bal = |u: &str| accs.iter().find(|a| a.uid == u).unwrap().balance_minor;
    assert_eq!(bal(&caja), 100_000 + 20_000 - 50_000);
    assert_eq!(bal(&banco), 500_000 + 30_000 - 35_000 + 50_000);
    assert_eq!(s.account_ledger(&banco).unwrap().len(), 3);

    // Recurrente mensual: arriendo de 200.000 dentro de los próximos 30 días.
    s.save_recurring(&RecurringInput {
        id: None,
        direction: "egreso".into(),
        description: "Arriendo local".into(),
        category_id: cats.iter().find(|c| c.name == "Arriendo").map(|c| c.id),
        amount_minor: 200_000,
        frequency: "mensual".into(),
        day_of_period: None,
        starts_on: day(15),
        ends_on: None,
        active: true,
    })
    .unwrap();

    let o = s.money_overview().unwrap();
    assert_eq!(o.cash_minor, 70_000 + 545_000);
    assert_eq!(o.receivable_minor, 80_000);
    assert_eq!(o.payable_minor, 60_000 + 25_000);
    assert_eq!(o.next30_in_minor, 80_000);
    assert_eq!(o.next30_out_minor, 60_000 + 25_000 + 200_000);
    assert_eq!(o.in30_minor, 615_000 + 80_000 - 285_000);
    assert_eq!(o.projection.len(), 13);
    assert_eq!(o.projection[0].closing_minor, o.projection[1].opening_minor);
    assert!(o.shortfall_week.is_none());
    let cal = s.money_calendar(30).unwrap();
    assert!(
        cal.iter()
            .any(|c| c.kind == "egreso_recurrente" && c.label == "Arriendo local")
    );

    // El resumen del dueño.
    let d = s.dashboard().unwrap();
    assert_eq!(d.today_sales_minor, 130_000);
    assert_eq!(d.today_sales_count, 3);
    assert_eq!(d.month_expenses_minor, 60_000);
    assert_eq!(d.cash_minor, 615_000);
    assert_eq!(d.receivable_minor, 80_000);
    assert_eq!(d.series.len(), 12);
    assert!(d.upcoming_payments.len() >= 3);

    // Anular el gasto pagado devuelve el dinero a la cuenta.
    s.void_expense(&g.summary.uid, "Boleta duplicada").unwrap();
    assert_eq!(s.money_overview().unwrap().cash_minor, 650_000);
    assert_eq!(s.list_expenses(&ExpenseFilter::default()).unwrap().len(), 1);
    let g2 = s
        .pay_expense(&g2.summary.uid, 25_000, "Efectivo", &day(0), None)
        .unwrap();
    assert_eq!(g2.summary.payment_state, "pagado");
    assert!(s.verify_audit().unwrap().ok);
}
