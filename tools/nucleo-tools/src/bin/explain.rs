//! Muestra tiempo y plan de consultas sueltas (diagnóstico de rendimiento).
//! Uso: explain <ruta.db> "<sql>" ["<sql>" …]
use nucleo_db::{DataKey, Db};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let db = Db::open(args[1].as_ref(), &DataKey::from_bytes([42; 32])).unwrap();
    for sql in &args[2..] {
        let mut plan = db
            .conn()
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
        let lines: Vec<String> = plan
            .query_map([], |r| r.get::<_, String>(3))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        let t = Instant::now();
        let mut stmt = db.conn().prepare(sql).unwrap();
        let n = stmt.query_map([], |_| Ok(())).unwrap().count();
        println!(
            "{:>9.1?} {n:>6} filas  {}\n          plan: {}",
            t.elapsed(),
            &sql[..sql.len().min(90)],
            lines.join(" | ")
        );
    }
}
