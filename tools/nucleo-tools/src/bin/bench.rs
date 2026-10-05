//! Mide las consultas críticas contra los presupuestos del MVP (Blueprint §18, criterio 9).
//!
//! Uso: cargo run --release -p nucleo-tools --bin bench -- <ruta.db>
//! Sale con código 1 si alguna consulta excede su presupuesto (p95).

use nucleo_db::{DataKey, Db, customers};
use std::time::{Duration, Instant};

const SEED_KEY: [u8; 32] = [42; 32];
const RUNS: usize = 25;

struct Case {
    name: &'static str,
    budget_ms: u128,
    run: Box<dyn Fn(&rusqlite::Connection) -> usize>,
}

fn count(conn: &rusqlite::Connection, sql: &str) -> usize {
    let mut stmt = conn.prepare_cached(sql).unwrap();
    let mut rows = stmt.query([]).unwrap();
    let mut n = 0;
    while rows.next().unwrap().is_some() {
        n += 1;
    }
    n
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "nucleo-bench.db".into());
    let open_start = Instant::now();
    let db = Db::open(path.as_ref(), &DataKey::from_bytes(SEED_KEY)).expect("abrir base");
    let conn = db.conn();
    println!("apertura de la base cifrada: {:.0?}", open_start.elapsed());

    // Fechas fijas coherentes con el generador (hoy = 2026-10-05).
    let cases: Vec<Case> = vec![
        Case {
            name: "Búsqueda global de clientes ('perez')",
            budget_ms: 300,
            run: Box::new(|c| customers::search(c, "perez", 50).unwrap().len()),
        },
        Case {
            name: "Búsqueda de clientes por RUT parcial ('7600')",
            budget_ms: 300,
            run: Box::new(|c| customers::search(c, "7600", 50).unwrap().len()),
        },
        Case {
            name: "Búsqueda de productos ('taladro mak')",
            budget_ms: 300,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT p.id FROM products p JOIN products_fts f ON f.rowid = p.id WHERE products_fts MATCH '\"taladro\"* \"mak\"*' ORDER BY bm25(products_fts) LIMIT 50",
                )
            }),
        },
        Case {
            name: "Lista de clientes, página 1.000 (cursor)",
            budget_ms: 500,
            run: Box::new(|c| customers::list(c, 50, Some(50_000)).unwrap().len()),
        },
        Case {
            name: "Lista de productos con stock (página)",
            budget_ms: 500,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT p.id, p.sku, p.name, p.price_minor, ifnull(sum(b.on_hand_milli),0) FROM products p LEFT JOIN stock_balances b ON b.product_id = p.id WHERE p.id > 60000 GROUP BY p.id ORDER BY p.id LIMIT 50",
                )
            }),
        },
        Case {
            name: "Kárdex de un producto",
            budget_ms: 500,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT * FROM stock_movements WHERE product_id = 4242 AND warehouse_id = 1 ORDER BY movement_date, id",
                )
            }),
        },
        Case {
            name: "Stock real de una página de productos (v_stock_position)",
            budget_ms: 500,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT * FROM v_stock_position WHERE product_id BETWEEN 1000 AND 1049",
                )
            }),
        },
        Case {
            name: "Dashboard del dueño (hoy + mes + atención)",
            budget_ms: 1000,
            run: Box::new(|c| {
                let qs = [
                    "SELECT sum(total_minor), count(*) FROM sales WHERE issue_date = '2026-10-05' AND commercial_state IN ('efectuada','cerrada')",
                    "SELECT sum(revenue_minor), sum(revenue_minor - cost_minor), sum(sales_count) FROM fact_sales_day WHERE sale_date = '2026-10-05'",
                    "SELECT sum(revenue_minor), sum(cost_minor), sum(sales_count) FROM fact_sales_day WHERE sale_date BETWEEN '2026-10-01' AND '2026-10-31'",
                    "SELECT sum(amount_minor - paid_minor), count(DISTINCT customer_id) FROM receivables WHERE status = 'abierta'",
                    "SELECT count(*) FROM receivables WHERE status = 'abierta' AND due_date < '2026-10-05'",
                    "SELECT sum(amount_minor - paid_minor) FROM payables WHERE status = 'abierta'",
                    "SELECT count(*) FROM sales WHERE documentation_state = 'pendiente'",
                    "SELECT count(*) FROM (SELECT p.id FROM products p JOIN stock_balances b ON b.product_id = p.id GROUP BY p.id HAVING sum(b.on_hand_milli) <= max(p.min_stock_milli))",
                    "SELECT product_id, sum(revenue_minor - cost_minor) u FROM fact_sales_daily INDEXED BY idx_fact_sales_date WHERE sale_date >= '2026-09-05' GROUP BY product_id ORDER BY u DESC LIMIT 10",
                    "SELECT substr(sale_date,1,7) m, sum(revenue_minor), sum(cost_minor) FROM fact_sales_day WHERE sale_date >= '2025-10-01' GROUP BY m",
                    "SELECT substr(expense_date,1,7) m, sum(total_minor) FROM expenses WHERE status = 'registrado' AND expense_date >= '2025-10-01' GROUP BY m",
                ];
                qs.iter().map(|q| count(c, q)).sum()
            }),
        },
        Case {
            name: "Evolución 12 meses de un producto",
            budget_ms: 500,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT substr(sale_date,1,7) m, sum(units_milli), sum(revenue_minor), sum(cost_minor) FROM fact_sales_daily WHERE product_id = 4242 AND sale_date >= '2025-10-01' GROUP BY m",
                )
            }),
        },
        Case {
            name: "Ficha inteligente de un cliente",
            budget_ms: 300,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT sum(sales_count), sum(revenue_minor), sum(revenue_minor - cost_minor), min(first_sale_date), max(last_sale_date) FROM fact_customer_monthly WHERE customer_id = 777",
                )
            }),
        },
        Case {
            name: "Inventario detenido > 90 días (valorizado)",
            budget_ms: 1000,
            run: Box::new(|c| {
                count(c, "SELECT p.id, sum(b.on_hand_milli) * p.avg_cost_e4 / 10000000 AS valor FROM products p JOIN stock_balances b ON b.product_id = p.id
                 WHERE b.on_hand_milli > 0 AND NOT EXISTS (SELECT 1 FROM fact_sales_daily f WHERE f.product_id = p.id AND f.branch_id = 0 AND f.sale_date >= '2026-07-07')
                 GROUP BY p.id")
            }),
        },
        Case {
            name: "Ventas pendientes de documentación (lista)",
            budget_ms: 300,
            run: Box::new(|c| {
                count(
                    c,
                    "SELECT id, number, customer_id, total_minor FROM sales WHERE documentation_state = 'pendiente' ORDER BY issue_date DESC LIMIT 50",
                )
            }),
        },
    ];

    let mut failed = 0;
    println!(
        "{:<62} {:>9} {:>8} {:>8} {:>8} {:>7}",
        "Consulta", "1ª vez", "p50", "p95", "meta", "filas"
    );
    for case in &cases {
        let mut times: Vec<Duration> = Vec::with_capacity(RUNS);
        let cold_start = Instant::now();
        let mut rows = (case.run)(conn);
        let cold = cold_start.elapsed();
        for _ in 0..RUNS {
            let t = Instant::now();
            rows = (case.run)(conn);
            times.push(t.elapsed());
        }
        times.sort();
        let p50 = times[RUNS / 2];
        let p95 = times[(RUNS * 95) / 100];
        let ok = p95.as_millis() <= case.budget_ms;
        if !ok {
            failed += 1;
        }
        println!(
            "{:<62} {:>7.1}ms {:>6.1}ms {:>6.1}ms {:>6}ms {:>7} {}",
            case.name,
            cold.as_secs_f64() * 1000.0,
            p50.as_secs_f64() * 1000.0,
            p95.as_secs_f64() * 1000.0,
            case.budget_ms,
            rows,
            if ok { "✓" } else { "✗ EXCEDE" }
        );
    }
    if failed > 0 {
        println!("{failed} consultas exceden su presupuesto");
        std::process::exit(1);
    }
    println!("Todas las consultas dentro del presupuesto.");
}
