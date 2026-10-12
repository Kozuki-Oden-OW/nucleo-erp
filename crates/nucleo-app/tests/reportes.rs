//! Fase 12: Análisis y reportes con cifras conocidas, más categorías y costo avanzado.

use nucleo_app::finance_ops::ExpenseInput;
use nucleo_app::nucleo_db::reports::Cell;
use nucleo_app::report_ops::{Report, ReportParams};
use nucleo_app::sales_ops::{EffectInput, LineInput, NewProduct, ProductPatch, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer};
use nucleo_domain::costing::CostSheet;

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger Demo", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn day(n: i64) -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            "SELECT date('now', 'localtime', ?1)",
            [format!("{n:+} days")],
            |r| r.get(0),
        )
        .unwrap()
}

fn report(s: &CompanySession, id: &str) -> Report {
    s.report(&ReportParams {
        id: id.into(),
        from: Some(day(-30)),
        to: Some(day(0)),
        group: None,
    })
    .unwrap()
}

fn col(r: &Report, key: &str) -> usize {
    r.columns.iter().position(|c| c.key == key).unwrap()
}

#[test]
fn reportes_con_cifras_conocidas() {
    let (_d, _app, mut s) = session();

    // Categorías iniciales y una propia.
    let cats = s.product_categories().unwrap();
    assert_eq!(cats.len(), 6);
    let cats = s.save_category(None, "Sensores").unwrap();
    let sens = cats
        .iter()
        .find(|c| c.name == "Sensores")
        .unwrap()
        .uid
        .clone();
    assert!(
        s.save_category(None, "sensores").is_err(),
        "nombre repetido"
    );

    // Producto exento: 10 unidades a $6.000 de costo, se vende a $10.000.
    let p = s
        .add_product(&NewProduct {
            sku: Some("TLOG-10E".into()),
            name: "Tlog 10E".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 10_000,
            cost_minor: Some(6_000),
            taxable: Some(false),
            initial_stock_milli: Some(10_000),
            category_uid: Some(sens.clone()),
            cost_sheet: None,
            stock_policy: None,
        })
        .unwrap();
    assert_eq!(p.category.as_deref(), Some("Sensores"));
    assert!(p.has_movements);

    // Con movimientos, el costo no se cambia desde la ficha; la hoja queda como referencia.
    let patch = ProductPatch {
        name: p.name.clone(),
        sku: p.sku.clone(),
        unit: "un".into(),
        price_minor: 10_000,
        taxable: false,
        min_milli: 0,
        category_uid: Some(sens.clone()),
        cost_minor: Some(7_000),
        cost_sheet: None,
        stock_policy: None,
    };
    assert!(s.update_product(&p.uid, &patch).is_err());
    let p2 = s
        .update_product(
            &p.uid,
            &ProductPatch {
                cost_minor: None,
                cost_sheet: Some(CostSheet {
                    purchase_minor: 60_000,
                    units_milli: 10_000,
                    ..Default::default()
                }),
                ..patch
            },
        )
        .unwrap();
    assert_eq!(p2.cost_e4, 60_000_000, "el costo promedio no cambia");
    assert!(p2.cost_sheet.is_some());

    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur".into(),
            ..Default::default()
        })
        .unwrap();
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(c.uid.clone()),
                issue_date: day(0),
                lines: vec![LineInput {
                    product_uid: Some(p.uid.clone()),
                    description: p.name.clone(),
                    qty_milli: 3_000,
                    unit_price_minor: 10_000,
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
            mode: "credito".into(),
            method: String::new(),
            due_date: Some(day(10)),
            account_uid: None,
        },
    )
    .unwrap();

    let cat = s.expense_categories().unwrap();
    let luz = cat.iter().find(|c| c.name == "Electricidad").unwrap().id;
    s.register_expense(&ExpenseInput {
        category_id: luz,
        supplier_uid: None,
        date: day(0),
        description: "Luz".into(),
        total_minor: 5_000,
        tax_included: false,
        due_date: Some(day(5)),
        paid_method: None,
        paid_account_uid: None,
        notes: None,
        recurring_id: None,
    })
    .unwrap();

    // Ventas por producto: 3 unidades, $30.000 netos, costo $18.000: ganancia sobre costo 66,7 %.
    let r = report(&s, "ventas_producto");
    assert_eq!(r.rows.len(), 1);
    let row = &r.rows[0];
    assert_eq!(row[col(&r, "cantidad")], Cell::Int(3_000));
    assert_eq!(row[col(&r, "neto")], Cell::Int(30_000));
    assert_eq!(row[col(&r, "costo")], Cell::Int(18_000));
    assert_eq!(row[col(&r, "margen_pct")], Cell::Int(666_667));
    assert_eq!(row[col(&r, "categoria")], Cell::Text("Sensores".into()));

    let r = report(&s, "ventas_categoria");
    assert_eq!(r.rows[0][0], Cell::Text("Sensores".into()));

    // Utilidad: 30.000 − 18.000 − 5.000 = 7.000.
    let r = report(&s, "utilidad");
    let t = r.totals.as_ref().unwrap();
    assert_eq!(t[col(&r, "ventas")], Cell::Int(30_000));
    assert_eq!(t[col(&r, "gastos")], Cell::Int(5_000));
    assert_eq!(t[col(&r, "utilidad")], Cell::Int(7_000));

    // Inventario: quedan 7 a $6.000 = $42.000; rotación 18.000 / 42.000 = 0,43.
    let r = report(&s, "inventario");
    let row = &r.rows[0];
    assert_eq!(row[col(&r, "stock")], Cell::Int(7_000));
    assert_eq!(row[col(&r, "valor")], Cell::Int(42_000));
    assert_eq!(row[col(&r, "rotacion")], Cell::Int(43));
    assert_eq!(row[col(&r, "dias")], Cell::Int(72), "7 × 31 días ÷ 3");
    assert!(
        r.links[0]
            .as_deref()
            .unwrap()
            .starts_with("/inventario/producto/")
    );

    // Por cobrar y por pagar al día.
    let r = report(&s, "por_cobrar");
    assert_eq!(
        r.totals.as_ref().unwrap()[col(&r, "saldo")],
        Cell::Int(30_000)
    );
    assert_eq!(r.rows[0][col(&r, "tramo")], Cell::Text("Al día".into()));
    let r = report(&s, "por_pagar");
    assert_eq!(r.rows[0][col(&r, "origen")], Cell::Text("Gasto".into()));

    // Eliminar la categoría deja el producto sin categoría.
    s.delete_category(&sens).unwrap();
    let r = report(&s, "ventas_categoria");
    assert_eq!(r.rows[0][0], Cell::Text("Sin categoría".into()));
}
