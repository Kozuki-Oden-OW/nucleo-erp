//! Casos golden de la hoja de costo y del precio neto o con IVA (`golden/costo.json`).
use nucleo_domain::costing::{CostSheet, compute_cost_sheet, gross_from_net, net_from_gross};
use serde_json::Value;

#[test]
fn costo_golden() {
    let g: Value =
        serde_json::from_str(include_str!("../../../golden/costo.json")).expect("JSON válido");
    for c in g["casos"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: CostSheet = serde_json::from_value(c["input"].clone()).expect(name);
        let r = compute_cost_sheet(&input, c["tax_ppm"].as_i64());
        let e = &c["esperado"];
        for (k, x) in [
            ("purchase_clp", r.purchase_clp),
            ("freight", r.freight),
            ("shipping", r.shipping),
            ("labor", r.labor),
            ("other", r.other),
            ("total", r.total),
            ("units_milli", r.units_milli),
            ("unit_cost_e4", r.unit_cost_e4),
            ("unit_cost", r.unit_cost),
        ] {
            assert_eq!(x, e[k].as_i64().unwrap(), "{name}: {k}");
        }
    }
    for p in g["precios"].as_array().unwrap() {
        let t = p["tax_ppm"].as_i64();
        let n = net_from_gross(p["con_iva"].as_i64().unwrap(), t);
        assert_eq!(n, p["neto"].as_i64().unwrap());
        assert_eq!(
            gross_from_net(n, t),
            p["con_iva_desde_neto"].as_i64().unwrap()
        );
    }
}
