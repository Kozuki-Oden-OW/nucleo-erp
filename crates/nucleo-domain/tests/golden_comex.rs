//! Casos golden de COMEX compartidos con la interfaz (`golden/comex.json`).
use nucleo_domain::comex::{ExportInput, LandedInput, export_margin, landed_cost};
use serde_json::Value;

fn cases() -> Value {
    serde_json::from_str(include_str!("../../../golden/comex.json")).expect("JSON válido")
}

#[test]
fn importaciones_golden() {
    for c in cases()["importaciones"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: LandedInput = serde_json::from_value(c["input"].clone()).expect(name);
        let r = landed_cost(&input);
        let e = &c["esperado"];
        for (k, v) in [
            ("customs_value_clp", r.customs_value_clp),
            ("duty_clp", r.duty_clp),
            ("vat_clp", r.vat_clp),
            ("recoverable_clp", r.recoverable_clp),
            ("landed_clp", r.landed_clp),
        ] {
            assert_eq!(e[k].as_i64(), Some(v), "{name}: {k}");
        }
        if let Some(x) = e["notional_insurance_clp"].as_i64() {
            assert_eq!(x, r.notional_insurance_clp, "{name}: seguro teórico");
        }
        for (i, it) in e["items"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                it["landed_clp"].as_i64(),
                Some(r.items[i].landed_clp),
                "{name}: producto {i}"
            );
            assert_eq!(
                it["unit_cost_e4"].as_i64(),
                Some(r.items[i].unit_cost_e4),
                "{name}: unitario {i}"
            );
        }
        assert_eq!(
            r.items.iter().map(|x| x.landed_clp).sum::<i64>(),
            r.landed_clp,
            "{name}: suma"
        );
    }
}

#[test]
fn exportaciones_golden() {
    for c in cases()["exportaciones"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: ExportInput = serde_json::from_value(c["input"].clone()).expect(name);
        let r = export_margin(&input);
        let e = &c["esperado"];
        assert_eq!(e["revenue_clp"].as_i64(), Some(r.revenue_clp), "{name}");
        assert_eq!(
            e["goods_cost_clp"].as_i64(),
            Some(r.goods_cost_clp),
            "{name}"
        );
        assert_eq!(e["profit_clp"].as_i64(), Some(r.profit_clp), "{name}");
        assert_eq!(e["margin_ppm"].as_i64(), r.margin_ppm, "{name}");
        assert_eq!(
            e["breakeven_revenue_clp"].as_i64(),
            r.breakeven_revenue_clp,
            "{name}"
        );
    }
}
