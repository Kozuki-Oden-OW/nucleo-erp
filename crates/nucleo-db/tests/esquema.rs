//! Pruebas del modelo de datos de la Fase 2: la base misma hace cumplir las reglas.

use nucleo_db::{DataKey, Db, maintenance, migrations};
use rusqlite::{Connection, params};

const T: &str = "2026-10-05T12:00:00Z";

fn db() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Db::open(
        &dir.path().join("empresa.db"),
        &DataKey::from_bytes([7; 32]),
    )
    .unwrap();
    migrations::migrate(db.conn_mut()).unwrap();
    (dir, db)
}

fn seed_basics(c: &Connection) -> (i64, i64, i64) {
    // Las monedas base (CLP, USD, EUR, CNY) vienen en la migración 0011.
    c.execute("INSERT INTO warehouses (uid, code, name, is_default, created_at) VALUES ('w1','B1','Bodega principal',1,?1)", [T]).unwrap();
    let wh = c.last_insert_rowid();
    c.execute("INSERT INTO products (uid, sku, name, price_minor, created_at) VALUES ('p1','CAF-X','Cafetera X',49990,?1)", [T]).unwrap();
    let prod = c.last_insert_rowid();
    c.execute(
        "INSERT INTO customers (uid, name, created_at) VALUES ('c1','Juan Pérez',?1)",
        [T],
    )
    .unwrap();
    let cust = c.last_insert_rowid();
    (wh, prod, cust)
}

fn movement(
    c: &Connection,
    prod: i64,
    wh: i64,
    kind: &str,
    qty: i64,
    cost_e4: i64,
    avg_e4: i64,
) -> rusqlite::Result<usize> {
    c.execute(
        "INSERT INTO stock_movements (product_id, warehouse_id, movement_date, kind, qty_milli, unit_cost_e4, avg_cost_after_e4, source_type, source_id, created_at)
         VALUES (?1, ?2, '2026-10-05', ?3, ?4, ?5, ?6, 'AJU', 1, ?7)",
        params![prod, wh, kind, qty, cost_e4, avg_e4, T],
    )
}

fn err_msg<T: std::fmt::Debug>(r: rusqlite::Result<T>) -> String {
    format!("{:?}", r.expect_err("se esperaba un error"))
}

#[test]
fn esquema_completo_e_integro() {
    let (_d, db) = db();
    let c = db.conn();
    assert_eq!(
        migrations::current_version(c).unwrap(),
        migrations::latest_version()
    );
    assert!(maintenance::check(c).unwrap().is_empty());
    let tables: i64 = c
        .query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'", [], |r| r.get(0))
        .unwrap();
    assert!(
        tables >= 70,
        "se esperaban al menos 70 tablas, hay {tables}"
    );
    let doc_types: i64 = c
        .query_row("SELECT count(*) FROM document_types", [], |r| r.get(0))
        .unwrap();
    let sequences: i64 = c
        .query_row("SELECT count(*) FROM numbering_sequences", [], |r| r.get(0))
        .unwrap();
    assert_eq!(doc_types, sequences);
    let fv: (String, i64) = c
        .query_row(
            "SELECT print_title, internal_legend FROM document_types WHERE code = 'FV'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(fv, ("FACTURA INTERNA".to_string(), 1)); // D-09
}

#[test]
fn stock_es_un_libro_de_movimientos() {
    let (_d, db) = db();
    let c = db.conn();
    let (wh, prod, _) = seed_basics(c);
    movement(c, prod, wh, "inicial", 10_000, 1000_0000, 1000_0000).unwrap();
    movement(c, prod, wh, "entrada", 30_000, 1400_0000, 1300_0000).unwrap();
    movement(c, prod, wh, "salida", -5_000, 1300_0000, 1300_0000).unwrap();
    let (on_hand, avg): (i64, i64) = c
        .query_row("SELECT on_hand_milli, avg_cost_e4 FROM stock_balances WHERE product_id=?1 AND warehouse_id=?2", [prod, wh], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!(on_hand, 35_000);
    assert_eq!(avg, 1300_0000);
    let last_cost: i64 = c
        .query_row(
            "SELECT last_cost_e4 FROM products WHERE id=?1",
            [prod],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(last_cost, 1400_0000);
    // Una salida con cantidad positiva es inválida, y el libro no se edita ni se borra.
    assert!(movement(c, prod, wh, "salida", 1_000, 0, 0).is_err());
    assert!(
        err_msg(c.execute("UPDATE stock_movements SET qty_milli = 1", []))
            .contains("solo inserción")
    );
    assert!(err_msg(c.execute("DELETE FROM stock_movements", [])).contains("solo inserción"));
}

#[test]
fn venta_efectuada_es_inmutable_y_estados_controlados() {
    let (_d, db) = db();
    let c = db.conn();
    let (wh, prod, cust) = seed_basics(c);
    c.execute(
        "INSERT INTO sales (uid, doc_type, number, customer_id, warehouse_id, issue_date, total_minor, created_at)
         VALUES ('s1','VEN','VEN-000089',?1,?2,'2026-10-05',59488,?3)",
        params![cust, wh, T],
    )
    .unwrap();
    let sale = c.last_insert_rowid();
    c.execute(
        "INSERT INTO sale_items (sale_id, line_no, product_id, description, qty_milli, list_price_minor, unit_price_minor, net_minor)
         VALUES (?1, 1, ?2, 'Cafetera X', 1000, 49990, 49990, 49990)",
        [sale, prod],
    )
    .unwrap();
    // borrador → efectuada
    c.execute("UPDATE sales SET commercial_state='efectuada', documentation_state='pendiente' WHERE id=?1", [sale]).unwrap();
    assert!(
        err_msg(c.execute("UPDATE sales SET total_minor = 1 WHERE id=?1", [sale]))
            .contains("venta efectuada")
    );
    assert!(c
        .execute(
            "INSERT INTO sale_items (sale_id, line_no, description, qty_milli, list_price_minor, unit_price_minor, net_minor) VALUES (?1,2,'x',1000,1,1,1)",
            [sale]
        )
        .is_err());
    assert!(
        c.execute("DELETE FROM sale_items WHERE sale_id=?1", [sale])
            .is_err()
    );
    assert!(
        err_msg(c.execute(
            "UPDATE sales SET commercial_state='borrador' WHERE id=?1",
            [sale]
        ))
        .contains("transición")
    );
    // Anular exige motivo.
    assert!(
        c.execute(
            "UPDATE sales SET commercial_state='anulada' WHERE id=?1",
            [sale]
        )
        .is_err()
    );
    // Documentar (eje independiente) sí se permite sobre una venta efectuada.
    c.execute(
        "UPDATE sales SET documentation_state='documentada' WHERE id=?1",
        [sale],
    )
    .unwrap();
    c.execute(
        "INSERT INTO external_doc_refs (sale_id, doc_kind, external_number, issue_date, marked_at) VALUES (?1,'Factura','563','2026-10-05',?2)",
        params![sale, T],
    )
    .unwrap();
}

#[test]
fn pagos_parciales_actualizan_saldos() {
    let (_d, db) = db();
    let c = db.conn();
    let (wh, _prod, cust) = seed_basics(c);
    c.execute("INSERT INTO sales (uid, number, customer_id, warehouse_id, issue_date, total_minor, created_at) VALUES ('s1','VEN-000001',?1,?2,'2026-10-05',100000,?3)", params![cust, wh, T]).unwrap();
    let sale = c.last_insert_rowid();
    c.execute("INSERT INTO receivables (sale_id, customer_id, due_date, amount_minor) VALUES (?1,?2,'2026-11-04',100000)", [sale, cust]).unwrap();
    let rec = c.last_insert_rowid();
    c.execute(
        "INSERT INTO money_accounts (uid, kind, name, created_at) VALUES ('m1','caja','Caja',?1)",
        [T],
    )
    .unwrap();
    let acc = c.last_insert_rowid();
    for (i, amount) in [(1, 40_000), (2, 60_000)] {
        c.execute(
            "INSERT INTO payments (uid, doc_type, number, direction, party_type, party_id, money_account_id, payment_date, method, amount_minor, created_at)
             VALUES (?1,'ABN',?2,'entrada','cliente',?3,?4,'2026-10-10','transferencia',?5,?6)",
            params![format!("p{i}"), format!("ABN-00000{i}"), cust, acc, amount, T],
        )
        .unwrap();
        let pay = c.last_insert_rowid();
        c.execute("INSERT INTO payment_allocations (payment_id, receivable_id, amount_minor, created_at) VALUES (?1,?2,?3,?4)", params![pay, rec, amount, T]).unwrap();
    }
    let (paid, status): (i64, String) = c
        .query_row(
            "SELECT paid_minor, status FROM receivables WHERE id=?1",
            [rec],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((paid, status.as_str()), (100_000, "pagada"));
    assert!(
        c.execute("UPDATE payment_allocations SET amount_minor = 1", [])
            .is_err()
    );
    // Un pago de salida no puede ser un comprobante de cobro.
    assert!(c
        .execute(
            "INSERT INTO payments (uid, doc_type, number, direction, money_account_id, payment_date, method, amount_minor, created_at)
             VALUES ('px','PAG','PAG-000009','salida',?1,'2026-10-10','efectivo',1,?2)",
            params![acc, T]
        )
        .is_err());
}

#[test]
fn asientos_cuadrados_y_periodos_cerrados() {
    let (_d, db) = db();
    let c = db.conn();
    c.execute_batch(
        "INSERT INTO accounting_accounts (code, name, simple_name, nature) VALUES
           ('1.1.03','Deudores por venta','Dinero que te deben','activo'),
           ('4.1.01','Ventas','Ventas','ingreso'),
           ('2.1.05','Impuesto por pagar','IVA estimado','pasivo');",
    )
    .unwrap();
    c.execute("INSERT INTO journal_entries (uid, entry_date, description, origin, created_at) VALUES ('j1','2026-10-05','Venta VEN-000089','automatico',?1)", [T]).unwrap();
    let je = c.last_insert_rowid();
    let line = |acc: &str, d: i64, h: i64| {
        c.execute(
            "INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_minor, credit_minor) VALUES (?1,(SELECT id FROM accounting_accounts WHERE code=?2),?3,?4)",
            params![je, acc, d, h],
        )
    };
    line("1.1.03", 110, 0).unwrap();
    line("4.1.01", 0, 100).unwrap();
    assert!(
        err_msg(c.execute(
            "UPDATE journal_entries SET status='contabilizado' WHERE id=?1",
            [je]
        ))
        .contains("no cuadra")
    );
    line("2.1.05", 0, 10).unwrap();
    assert!(line("2.1.05", 5, 5).is_err()); // debe y haber a la vez
    c.execute(
        "UPDATE journal_entries SET status='contabilizado' WHERE id=?1",
        [je],
    )
    .unwrap();
    assert!(err_msg(line("2.1.05", 0, 1)).contains("reversa"));
    // Período cerrado bloquea contabilizar.
    c.execute(
        "INSERT INTO fiscal_periods (year, month, status) VALUES (2026, 9, 'cerrado')",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO journal_entries (uid, entry_date, description, origin, created_at) VALUES ('j2','2026-09-30','Ajuste','manual',?1)", [T]).unwrap();
    let je2 = c.last_insert_rowid();
    c.execute("INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_minor) VALUES (?1,1,10)", [je2]).unwrap();
    c.execute("INSERT INTO journal_entry_lines (journal_entry_id, account_id, credit_minor) VALUES (?1,2,10)", [je2]).unwrap();
    assert!(
        err_msg(c.execute(
            "UPDATE journal_entries SET status='contabilizado' WHERE id=?1",
            [je2]
        ))
        .contains("cerrado")
    );
}

#[test]
fn golden_stock_real_en_sql() {
    // 02_INTELIGENCIA_COMERCIAL.md §18: Cafetera X, 23 disponibles, 5 reservadas, 500 en importación EN TRÁNSITO.
    let (_d, db) = db();
    let c = db.conn();
    let (wh, prod, cust) = seed_basics(c);
    movement(c, prod, wh, "inicial", 23_000, 0, 0).unwrap();
    c.execute("INSERT INTO sales_orders (uid, number, customer_id, issue_date, created_at) VALUES ('o1','NV-000001',?1,'2026-10-05',?2)", params![cust, T]).unwrap();
    let so = c.last_insert_rowid();
    c.execute("INSERT INTO stock_reservations (product_id, warehouse_id, qty_milli, source_type, source_id, created_at) VALUES (?1,?2,5000,'NV',?3,?4)", params![prod, wh, so, T]).unwrap();
    c.execute("INSERT INTO imports (uid, number, stage, eta, created_at) VALUES ('i1','IMP-000001','en_transito','2026-12-15',?1)", [T]).unwrap();
    let imp = c.last_insert_rowid();
    c.execute("INSERT INTO import_items (import_id, product_id, description, qty_milli, unit_price_minor) VALUES (?1,?2,'Cafetera X',500000,500)", [imp, prod]).unwrap();
    // Un escenario de simulación NO cuenta como stock.
    c.execute("INSERT INTO imports (uid, number, is_scenario, stage, created_at) VALUES ('i2','IMP-000002',1,'ordenada',?1)", [T]).unwrap();
    c.execute("INSERT INTO import_items (import_id, product_id, description, qty_milli, unit_price_minor) VALUES (last_insert_rowid(),?1,'x',999000,1)", [prod]).unwrap();

    let row: (i64, i64, i64, i64, i64) = c
        .query_row(
            "SELECT on_hand_milli, reserved_milli, in_import_milli, in_transit_milli, in_purchase_milli FROM v_stock_position WHERE product_id=?1",
            [prod],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(row, (23_000, 5_000, 500_000, 500_000, 0));
    let (on_hand, reserved, in_import, _, _) = row;
    assert_eq!(on_hand - reserved, 18_000); // disponible real
    assert_eq!(on_hand - reserved + in_import, 518_000); // stock futuro

    // La importación avanza: queda historial de etapas y de ETA.
    c.execute(
        "UPDATE imports SET stage='arribada', eta='2026-12-20' WHERE id=?1",
        [imp],
    )
    .unwrap();
    let stages: i64 = c
        .query_row(
            "SELECT count(*) FROM import_stage_history WHERE import_id=?1",
            [imp],
            |r| r.get(0),
        )
        .unwrap();
    let etas: i64 = c
        .query_row(
            "SELECT count(*) FROM eta_changes WHERE import_id=?1",
            [imp],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!((stages, etas), (1, 1));
}

#[test]
fn restricciones_de_formato() {
    let (_d, db) = db();
    let c = db.conn();
    let (wh, _prod, cust) = seed_basics(c);
    // Fecha inválida.
    assert!(c
        .execute("INSERT INTO sales (uid, number, customer_id, warehouse_id, issue_date, created_at) VALUES ('x','VEN-1',?1,?2,'05-10-2026',?3)", params![cust, wh, T])
        .is_err());
    // Descuento sobre 100 %.
    c.execute("INSERT INTO quotes (uid, number, customer_id, issue_date, created_at) VALUES ('q','COT-000001',?1,'2026-10-05',?2)", params![cust, T]).unwrap();
    assert!(c
        .execute(
            "INSERT INTO quote_items (quote_id, line_no, description, qty_milli, unit_price_minor, discount_ppm, net_minor) VALUES (last_insert_rowid(),1,'x',1000,10,1000001,0)",
            []
        )
        .is_err());
    // Un servicio no lleva stock.
    assert!(c.execute("INSERT INTO products (uid, kind, name, track_stock, created_at) VALUES ('sv','servicio','Instalación',1,?1)", [T]).is_err());
    // Normativa sin fuente.
    c.execute("INSERT INTO rule_sets (code, publisher, package_json, imported_at) VALUES ('X','p','{}',?1)", [T]).unwrap();
    assert!(c
        .execute("INSERT INTO rule_values (rule_set_id, code, data_json, valid_from, source) VALUES (last_insert_rowid(),'A','{}','2026-01-01','  ')", [])
        .is_err());
}
