//! Casos golden del borrador del F29 compartidos con la interfaz (`golden/f29.json`).
use nucleo_domain::f29::{F29Input, compute};
use serde_json::Value;

#[test]
fn f29_golden() {
    let g: Value =
        serde_json::from_str(include_str!("../../../golden/f29.json")).expect("JSON válido");
    for c in g["casos"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: F29Input = serde_json::from_value(c["input"].clone()).expect(name);
        let r = compute(&input);
        let e = &c["esperado"];
        for (k, v) in e["codes"].as_object().unwrap() {
            let code: u32 = k.parse().unwrap();
            assert_eq!(
                r.codes.get(&code).copied().unwrap_or(0),
                v.as_i64().unwrap(),
                "{name}: código {code}"
            );
        }
        for a in e["absent"].as_array().into_iter().flatten() {
            let code = a.as_u64().unwrap() as u32;
            assert!(
                !r.codes.contains_key(&code),
                "{name}: no debe tener el código {code}"
            );
        }
        assert_eq!(
            e["complete"].as_bool(),
            Some(r.complete),
            "{name}: completo"
        );
    }
}
