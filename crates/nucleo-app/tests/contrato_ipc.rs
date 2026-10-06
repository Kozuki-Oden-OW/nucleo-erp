//! Contrato IPC de Ventas: los JSON que envía la interfaz (TauriBackend) se leen en Rust y lo que
//! Rust devuelve tiene los campos que espera `src/data/types.ts`.

use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::sales_ops::{
    EffectInput, ExternalRefInput, NewProduct, QuoteInput, SaleFilter, SaleInput, SaleSummary,
};
use serde_json::json;

#[test]
fn entradas_de_la_interfaz() {
    let line = json!({ "product_uid": null, "description": "Saco de cemento", "qty_milli": 2000, "unit_price_minor": 5990, "discount_ppm": 0, "taxable": true });
    let q: QuoteInput = serde_json::from_value(json!({
        "customer_uid": null, "prospect_name": "Juan", "issue_date": "2026-10-06", "valid_until": null, "lines": [line]
    }))
    .unwrap();
    assert_eq!(q.lines.len(), 1);
    let _: SaleInput = serde_json::from_value(json!({
        "doc_type": "FV", "customer_uid": "x", "issue_date": "2026-10-06", "lines": [line]
    }))
    .unwrap();
    let _: EffectInput = serde_json::from_value(
        json!({ "mode": "contado", "method": "Efectivo", "due_date": null }),
    )
    .unwrap();
    let _: ExternalRefInput = serde_json::from_value(json!({ "doc_kind": "Boleta" })).unwrap();
    let _: SaleFilter =
        serde_json::from_value(json!({ "query": null, "view": "por_cobrar" })).unwrap();
    let p: NewProduct = serde_json::from_value(json!({
        "name": "Taladro", "unit": "un", "kind": "producto", "price_minor": 45990, "cost_minor": 30000, "initial_stock_milli": 4000
    }))
    .unwrap();
    assert_eq!(p.initial_stock_milli, Some(4000));
    // La interfaz manda texto vacío para borrar datos y 0 para borrar la tasa anotada.
    let b: BusinessPatch =
        serde_json::from_value(json!({ "rut": "", "tax_enabled": true, "tax_rate_user_ppm": 0 }))
            .unwrap();
    assert_eq!(b.tax_rate_user_ppm, Some(0));
}

#[test]
fn salida_con_campos_de_types_ts() {
    let s = SaleSummary {
        uid: "u".into(),
        doc_type: "VEN".into(),
        number: "VEN-000001".into(),
        customer_name: "Cliente ocasional".into(),
        issue_date: "2026-10-06".into(),
        due_date: None,
        commercial_state: "efectuada".into(),
        payment_state: "pagada".into(),
        documentation_state: "pendiente".into(),
        total_minor: 100,
        paid_minor: 100,
    };
    let v = serde_json::to_value(&s).unwrap();
    for k in [
        "uid",
        "doc_type",
        "number",
        "customer_name",
        "issue_date",
        "due_date",
        "commercial_state",
        "payment_state",
        "documentation_state",
        "total_minor",
        "paid_minor",
    ] {
        assert!(v.get(k).is_some(), "falta {k}");
    }
}
