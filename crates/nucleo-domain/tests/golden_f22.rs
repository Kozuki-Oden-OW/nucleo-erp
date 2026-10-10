//! Casos golden del F22 Pro Pyme general compartidos con la interfaz (`golden/f22.json`).
use nucleo_domain::f22::{F22Input, compute};
use serde_json::Value;

#[test]
fn f22_golden() {
    let g: Value =
        serde_json::from_str(include_str!("../../../golden/f22.json")).expect("JSON válido");
    for c in g["casos"].as_array().unwrap() {
        let name = c["nombre"].as_str().unwrap();
        let input: F22Input = serde_json::from_value(c["input"].clone()).expect(name);
        let r = compute(&input);
        assert!(r.complete, "{name}: {:?}", r.notes);
        let e = &c["esperado"];
        assert_eq!(
            r.idpc_gross,
            e["idpc_gross"].as_i64().unwrap(),
            "{name}: IDPC bruto"
        );
        let exp = e["codes"].as_object().unwrap();
        for (k, v) in exp {
            let code: u32 = k.parse().unwrap();
            assert_eq!(
                r.codes.get(&code).copied(),
                v.as_i64(),
                "{name}: código {code}"
            );
        }
        for (code, v) in &r.codes {
            assert!(
                exp.contains_key(&code.to_string()) || *v == 0,
                "{name}: código {code} sobra ({v})"
            );
        }
    }
}
