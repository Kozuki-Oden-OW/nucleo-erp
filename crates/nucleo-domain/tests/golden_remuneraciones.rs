//! Casos golden de la liquidación de sueldo compartidos con la interfaz (`golden/remuneraciones.json`).
use nucleo_domain::payroll::{PayslipInput, PayslipResult, compute};
use serde_json::Value;

fn line(r: &PayslipResult, key: &str) -> i64 {
    r.taxable_earnings
        .iter()
        .chain(&r.legal_deductions)
        .chain(&r.employer)
        .filter(|l| l.key == key)
        .map(|l| l.amount)
        .sum()
}

#[test]
fn remuneraciones_golden() {
    let g: Value = serde_json::from_str(include_str!("../../../golden/remuneraciones.json"))
        .expect("JSON válido");
    for c in g["casos"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: PayslipInput = serde_json::from_value(c["input"].clone()).expect(name);
        let r = compute(&input);
        assert!(r.complete, "{name}: completo ({:?})", r.notes);
        let e = &c["esperado"];
        let v = |k: &str| e[k].as_i64().unwrap();
        let got = [
            ("total_taxable", r.total_taxable),
            ("pension_base", r.pension_base),
            ("afc_base", r.afc_base),
            ("afp", line(&r, "afp")),
            ("salud", line(&r, "salud")),
            ("salud_adicional", line(&r, "salud_adicional")),
            ("afc", line(&r, "afc")),
            ("horas_extra", line(&r, "horas_extra")),
            ("gratificacion", line(&r, "gratificacion")),
            ("tax_base", r.tax_base),
            ("tax", r.tax),
            ("tax_bracket", r.tax_bracket as i64),
            ("total_earnings", r.total_earnings),
            ("total_deductions", r.total_deductions),
            ("net", r.net),
            ("to_pay", r.to_pay),
            ("employer_total", r.employer_total),
            ("employer_cost", r.employer_cost),
        ];
        for (k, x) in got {
            assert_eq!(x, v(k), "{name}: {k}");
        }
        for (k, x) in e["employer_lines"].as_object().unwrap() {
            assert_eq!(line(&r, k), x.as_i64().unwrap(), "{name}: aporte {k}");
        }
    }
}
