//! Genera una base cifrada con el volumen de referencia del MVP (Blueprint §18, criterio 9):
//! 100.000 clientes · 100.000 productos · ~1.000.000 de movimientos de stock.
//!
//! Uso: cargo run --release -p nucleo-tools --bin seed -- <ruta.db> [escala]
//!      escala 1.0 = volumen completo; 0.01 = 1 % (para pruebas rápidas).

use nucleo_db::{DataKey, Db, migrations};
use nucleo_domain::Rut;
use nucleo_tools::{Rng, date_back};
use rusqlite::{Transaction, params};
use std::time::Instant;

pub const SEED_KEY: [u8; 32] = [42; 32];
const T: &str = "2026-10-05T12:00:00Z";

const FIRST: &[&str] = &[
    "Juan",
    "María",
    "José",
    "Ana",
    "Luis",
    "Carmen",
    "Pedro",
    "Francisca",
    "Diego",
    "Valentina",
    "Jorge",
    "Camila",
    "Andrés",
    "Javiera",
    "Felipe",
    "Constanza",
    "Matías",
    "Catalina",
    "Cristóbal",
    "Fernanda",
    "Ignacio",
    "Isidora",
];
const LAST: &[&str] = &[
    "González",
    "Muñoz",
    "Rojas",
    "Díaz",
    "Pérez",
    "Soto",
    "Contreras",
    "Silva",
    "Martínez",
    "Sepúlveda",
    "Morales",
    "Rodríguez",
    "López",
    "Fuentes",
    "Hernández",
    "Torres",
    "Araya",
    "Flores",
    "Espinoza",
    "Valenzuela",
    "Castillo",
];
const COMPANY: &[&str] = &[
    "Comercial",
    "Distribuidora",
    "Ferretería",
    "Constructora",
    "Inversiones",
    "Servicios",
    "Agrícola",
    "Transportes",
];
const PLACE: &[&str] = &[
    "Los Andes",
    "del Sur",
    "Austral",
    "Pacífico",
    "Llanquihue",
    "Frutillar",
    "Osorno",
    "Biobío",
    "Atacama",
    "Maule",
];
const PRODUCT: &[&str] = &[
    "Taladro",
    "Esmeril",
    "Cafetera",
    "Hervidor",
    "Termómetro",
    "Sensor",
    "Datalogger",
    "Martillo",
    "Sierra",
    "Lijadora",
    "Destornillador",
    "Llave",
    "Alicate",
    "Tornillo",
    "Pintura",
    "Brocha",
    "Cable",
    "Enchufe",
    "Ampolleta",
    "Manguera",
];
const BRAND: &[&str] = &[
    "Makita",
    "Bosch",
    "Stanley",
    "Truper",
    "Elitech",
    "Philips",
    "Oster",
    "DeWalt",
    "Black+Decker",
    "Bauker",
];
const ADJ: &[&str] = &[
    "Pro",
    "Compacto",
    "Industrial",
    "Eléctrico",
    "Inalámbrico",
    "Digital",
    "Reforzado",
    "Mini",
    "Max",
    "Plus",
];

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "nucleo-bench.db".into());
    let scale: f64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let n_customers = (100_000.0 * scale) as i64;
    let n_products = (100_000.0 * scale) as i64;
    let n_sales = (300_000.0 * scale) as i64; // ~900.000 líneas → ~900.000 salidas + 100.000 iniciales
    let _ = std::fs::remove_file(&path);
    let started = Instant::now();
    let mut db = Db::open(path.as_ref(), &DataKey::from_bytes(SEED_KEY)).expect("abrir base");
    migrations::migrate(db.conn_mut()).expect("migrar");
    let mut rng = Rng::new(20261005);

    let tx = db.conn_mut().transaction().unwrap();
    base(&tx);
    customers(&tx, &mut rng, n_customers);
    products(&tx, &mut rng, n_products);
    tx.commit().unwrap();
    println!(
        "maestros: {n_customers} clientes, {n_products} productos ({:.1?})",
        started.elapsed()
    );

    let tx = db.conn_mut().transaction().unwrap();
    let movements = sales(&tx, &mut rng, n_sales, n_customers, n_products);
    tx.commit().unwrap();
    db.conn()
        .execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    let total_mov: i64 = db
        .conn()
        .query_row("SELECT count(*) FROM stock_movements", [], |r| r.get(0))
        .unwrap();
    println!(
        "ventas: {n_sales} ({movements} salidas) · movimientos totales: {total_mov} · tiempo total {:.1?}",
        started.elapsed()
    );
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("tamaño de la base: {:.1} MB", size as f64 / 1_048_576.0);
}

fn base(tx: &Transaction) {
    tx.execute_batch(&format!(
        "INSERT INTO currencies (code, name, decimals, symbol) VALUES ('CLP','Peso chileno',0,'$'), ('USD','Dólar estadounidense',2,'US$');
         INSERT INTO branches (uid, name, is_default, created_at) VALUES ('b1','Casa matriz',1,'{T}');
         INSERT INTO warehouses (uid, branch_id, code, name, is_default, created_at) VALUES ('w1',1,'B1','Bodega principal',1,'{T}'), ('w2',1,'B2','Bodega secundaria',0,'{T}');
         INSERT INTO money_accounts (uid, kind, name, created_at) VALUES ('m1','caja','Caja','{T}'), ('m2','banco','Cuenta corriente','{T}');"
    ))
    .unwrap();
    for i in 0..50 {
        tx.execute(
            "INSERT INTO categories (name) VALUES (?1)",
            [format!("Categoría {i:02}")],
        )
        .unwrap();
    }
    for b in BRAND {
        tx.execute("INSERT INTO brands (name) VALUES (?1)", [b])
            .unwrap();
    }
}

fn customers(tx: &Transaction, rng: &mut Rng, n: i64) {
    let mut stmt = tx
        .prepare("INSERT INTO customers (uid, kind, rut, name, email, phone, commune, payment_terms_days, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
        .unwrap();
    for i in 0..n {
        let company = rng.chance(35);
        let name = if company {
            format!(
                "{} {} {}",
                rng.pick(COMPANY),
                rng.pick(PLACE),
                if rng.chance(50) { "SpA" } else { "Limitada" }
            )
        } else {
            format!("{} {} {}", rng.pick(FIRST), rng.pick(LAST), rng.pick(LAST))
        };
        let body = if company {
            76_000_000 + i as u32
        } else {
            8_000_000 + i as u32 * 97 % 15_000_000 + i as u32
        };
        let rut = if rng.chance(70) {
            Some(format!("{body}-{}", Rut::check_digit(body)))
        } else {
            None
        };
        let email = rng.chance(60).then(|| format!("cliente{i}@correo.cl"));
        let phone = rng
            .chance(50)
            .then(|| format!("+569{:08}", rng.range(10_000_000, 99_999_999)));
        let terms = if company {
            *rng.pick(&[0, 15, 30, 30, 60])
        } else {
            0
        };
        let r = stmt.execute(params![
            format!("c{i}"),
            if company { "empresa" } else { "persona" },
            rut,
            name,
            email,
            phone,
            rng.pick(PLACE),
            terms,
            T
        ]);
        if r.is_err() {
            // RUT repetido por colisión del generador: se inserta sin RUT.
            stmt.execute(params![
                format!("c{i}"),
                "persona",
                Option::<String>::None,
                name,
                email,
                phone,
                "Osorno",
                0,
                T
            ])
            .unwrap();
        }
    }
}

fn products(tx: &Transaction, rng: &mut Rng, n: i64) {
    let mut p = tx
        .prepare(
            "INSERT INTO products (uid, sku, barcode, name, category_id, brand_id, price_minor, min_stock_milli, weight_g, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        )
        .unwrap();
    let mut m = tx
        .prepare(
            "INSERT INTO stock_movements (product_id, warehouse_id, movement_date, kind, qty_milli, unit_cost_e4, avg_cost_after_e4, source_type, source_id, created_at)
             VALUES (?1, 1, ?2, 'inicial', ?3, ?4, ?4, 'AJU', 0, ?5)",
        )
        .unwrap();
    for i in 0..n {
        let brand = rng.range(0, BRAND.len() as i64);
        let name = format!(
            "{} {} {} {}",
            rng.pick(PRODUCT),
            BRAND[brand as usize],
            rng.pick(ADJ),
            rng.range(100, 9999)
        );
        let cost = rng.range(500, 250_000);
        let price = cost * rng.range(120, 220) / 100;
        p.execute(params![
            format!("p{i}"),
            format!("SKU-{i:06}"),
            format!("78{:011}", i),
            name,
            rng.range(1, 51),
            brand + 1,
            price,
            rng.range(1, 20) * 1000,
            rng.range(100, 20_000),
            T
        ])
        .unwrap();
        let id = tx.last_insert_rowid();
        m.execute(params![
            id,
            date_back(400),
            rng.range(20, 400) * 1000,
            cost * 10_000,
            T
        ])
        .unwrap();
    }
}

fn sales(tx: &Transaction, rng: &mut Rng, n: i64, n_customers: i64, n_products: i64) -> i64 {
    let mut sale = tx
        .prepare(
            "INSERT INTO sales (uid, doc_type, number, customer_id, warehouse_id, issue_date, issued_at, due_date, commercial_state,
                                payment_state, paid_minor, documentation_state, net_minor, tax_minor, total_minor, cost_minor, created_at)
             VALUES (?1,'VEN',?2,?3,1,?4,?5,?6,'borrador',?7,?8,?9,?10,0,?10,?11,?12)",
        )
        .unwrap();
    let mut item = tx
        .prepare(
            "INSERT INTO sale_items (sale_id, line_no, product_id, description, qty_milli, list_price_minor, unit_price_minor, discount_minor, net_minor, unit_cost_e4, cost_minor)
             VALUES (?1,?2,?3,'línea',?4,?5,?5,?6,?7,?8,?9)",
        )
        .unwrap();
    let mut mov = tx
        .prepare(
            "INSERT INTO stock_movements (product_id, warehouse_id, movement_date, kind, qty_milli, unit_cost_e4, avg_cost_after_e4, source_type, source_id, source_line_id, created_at)
             VALUES (?1, 1, ?2, 'salida', ?3, ?4, ?4, 'VEN', ?5, ?6, ?7)",
        )
        .unwrap();
    let mut fact = tx
        .prepare(
            "INSERT INTO fact_sales_daily (sale_date, product_id, branch_id, units_milli, revenue_minor, discount_minor, cost_minor, sales_count)
             VALUES (?1,?2,0,?3,?4,?5,?6,1)
             ON CONFLICT (product_id, branch_id, sale_date) DO UPDATE SET
               units_milli = units_milli + excluded.units_milli, revenue_minor = revenue_minor + excluded.revenue_minor,
               discount_minor = discount_minor + excluded.discount_minor, cost_minor = cost_minor + excluded.cost_minor,
               sales_count = sales_count + 1",
        )
        .unwrap();
    let mut cust_fact = tx
        .prepare(
            "INSERT INTO fact_customer_monthly (customer_id, month, sales_count, revenue_minor, cost_minor, first_sale_date, last_sale_date)
             VALUES (?1,?2,1,?3,?4,?5,?5)
             ON CONFLICT (customer_id, month) DO UPDATE SET sales_count = sales_count + 1,
               revenue_minor = revenue_minor + excluded.revenue_minor, cost_minor = cost_minor + excluded.cost_minor,
               first_sale_date = min(first_sale_date, excluded.first_sale_date), last_sale_date = max(last_sale_date, excluded.last_sale_date)",
        )
        .unwrap();
    let mut day = tx
        .prepare(
            "INSERT INTO fact_sales_day (sale_date, branch_id, sales_count, units_milli, revenue_minor, discount_minor, cost_minor)
             VALUES (?1,0,1,?2,?3,?4,?5)
             ON CONFLICT (sale_date, branch_id) DO UPDATE SET sales_count = sales_count + 1,
               units_milli = units_milli + excluded.units_milli, revenue_minor = revenue_minor + excluded.revenue_minor,
               discount_minor = discount_minor + excluded.discount_minor, cost_minor = cost_minor + excluded.cost_minor",
        )
        .unwrap();
    let mut receivable = tx
        .prepare("INSERT INTO receivables (sale_id, customer_id, due_date, amount_minor, paid_minor, status) VALUES (?1,?2,?3,?4,?5,?6)")
        .unwrap();
    let mut product_info = tx
        .prepare("SELECT price_minor, avg_cost_e4 FROM products WHERE id = ?1")
        .unwrap();
    let mut movements = 0;
    for s in 0..n {
        let days = rng.range(0, 365);
        let date = date_back(days);
        let customer = rng.chance(85).then(|| rng.range(1, n_customers + 1));
        let credit = customer.is_some() && rng.chance(30);
        let paid_state = if !credit || days > 60 || rng.chance(50) {
            "pagada"
        } else {
            "sin_pago"
        };
        let doc_state = if rng.chance(80) {
            "documentada"
        } else if days < 30 {
            "pendiente"
        } else {
            "no_aplica"
        };
        sale.execute(params![
            format!("s{s}"),
            format!("VEN-{:06}", s + 1),
            customer,
            date,
            format!("{date}T{:02}:{:02}:00Z", rng.range(9, 21), rng.range(0, 60)),
            date_back(days - 30),
            paid_state,
            0,
            doc_state,
            0,
            0,
            T
        ])
        .unwrap();
        let sale_id = tx.last_insert_rowid();
        let (mut net, mut cost_total, mut units, mut disc) = (0i64, 0i64, 0i64, 0i64);
        for line in 1..=3 {
            let pid = rng.range(1, n_products + 1);
            let (price, avg): (i64, i64) = product_info
                .query_row([pid], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap();
            let qty = rng.range(1, 4);
            let discount = if rng.chance(15) { price * qty / 10 } else { 0 };
            let line_net = price * qty - discount;
            let line_cost = avg * qty / 10_000;
            item.execute(params![
                sale_id,
                line,
                pid,
                qty * 1000,
                price,
                discount,
                line_net,
                avg,
                line_cost
            ])
            .unwrap();
            mov.execute(params![pid, date, -qty * 1000, avg, sale_id, line, T])
                .unwrap();
            fact.execute(params![
                date,
                pid,
                qty * 1000,
                line_net,
                discount,
                line_cost
            ])
            .unwrap();
            net += line_net;
            cost_total += line_cost;
            units += qty * 1000;
            disc += discount;
            movements += 1;
        }
        day.execute(params![date, units, net, disc, cost_total])
            .unwrap();
        let paid = if paid_state == "pagada" { net } else { 0 };
        tx.execute(
            "UPDATE sales SET net_minor=?1, total_minor=?1, cost_minor=?2, paid_minor=?3, commercial_state='efectuada' WHERE id=?4",
            params![net, cost_total, paid, sale_id],
        )
        .unwrap();
        if let Some(c) = customer {
            cust_fact
                .execute(params![c, &date[..7], net, cost_total, date])
                .unwrap();
            if credit {
                receivable
                    .execute(params![
                        sale_id,
                        c,
                        date_back(days - 30),
                        net,
                        paid,
                        if paid == net { "pagada" } else { "abierta" }
                    ])
                    .unwrap();
            }
        }
    }
    movements
}
