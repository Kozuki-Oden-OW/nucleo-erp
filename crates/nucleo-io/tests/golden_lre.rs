//! Archivo del LRE: el texto generado no cambia sin querer (`golden/lre.json`, compartido con la interfaz).
use nucleo_io::lre::{LreRow, build, totals};

#[test]
fn lre_golden() {
    let g: serde_json::Value =
        serde_json::from_str(include_str!("../../../golden/lre.json")).unwrap();
    for c in g["casos"].as_array().unwrap() {
        let rows: Vec<LreRow> = serde_json::from_value(c["rows"].clone()).unwrap();
        assert_eq!(
            build(&rows),
            c["esperado"].as_str().unwrap(),
            "{}",
            c["nombre"]
        );
        // El líquido del libro = haberes − descuentos.
        let t = totals(&rows[1].amounts);
        assert_eq!(
            t[&5501],
            650000 + 162500 + 40000 + 30000 + 27740 - (84988 + 56875 + 4875 + 20000 + 50000)
        );
        assert_eq!(t[&5341], 84988 + 56875 + 4875 + 20000);
        assert_eq!(t[&5302], 50000);
    }
}
