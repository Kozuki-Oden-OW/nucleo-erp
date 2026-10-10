//! Casos golden del finiquito compartidos con la interfaz (`golden/finiquito.json`).
use nucleo_domain::severance::{SeveranceInput, compute};
use serde_json::Value;

#[test]
fn finiquito_golden() {
    let g: Value =
        serde_json::from_str(include_str!("../../../golden/finiquito.json")).expect("JSON válido");
    for c in g["casos"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: SeveranceInput = serde_json::from_value(c["input"].clone()).expect(name);
        let r = compute(&input);
        assert!(r.complete, "{name}: completo ({:?})", r.notes);
        let e = &c["esperado"];
        let v = |k: &str| e[k].as_i64().unwrap();
        for (k, x) in [
            ("total_earnings", r.total_earnings),
            ("total_deductions", r.total_deductions),
            ("to_pay", r.to_pay),
            ("ias_years", r.ias_years),
            ("capped_base", r.capped_base),
            ("vacation_business_days_e2", r.vacation_business_days_e2),
            ("vacation_calendar_days_e2", r.vacation_calendar_days_e2),
        ] {
            assert_eq!(x, v(k), "{name}: {k}");
        }
        let svc: Vec<i64> = e["service"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_i64().unwrap())
            .collect();
        assert_eq!(
            svc,
            vec![r.service_years, r.service_months, r.service_days],
            "{name}: antigüedad"
        );
        let lines = e["lines"].as_object().unwrap();
        let got = r.earnings.iter().chain(&r.deductions);
        assert_eq!(
            got.clone().count(),
            lines.len(),
            "{name}: cantidad de líneas"
        );
        for (k, x) in lines {
            let sum: i64 = got.clone().filter(|l| l.key == *k).map(|l| l.amount).sum();
            assert_eq!(sum, x.as_i64().unwrap(), "{name}: línea {k}");
        }
    }
}
