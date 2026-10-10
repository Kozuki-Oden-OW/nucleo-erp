//! Borrador del F29 (Fase 10, hito A): desde NÚCLEO, desde el registro del SII importado, con
//! montos manuales, marcado como declarado y remanente al mes siguiente.

use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::f29_ops::{F29Inputs, TaxDocInput, TaxProfile};
use nucleo_app::sales_ops::{EffectInput, ExternalRefInput, LineInput, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Comercial Ejemplo", BusinessProfile::Negocio)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn today() -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
        .unwrap()
}

fn sale(s: &mut CompanySession, amount: i64, document: Option<&str>) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: None,
                issue_date: today(),
                lines: vec![LineInput {
                    product_uid: None,
                    description: "Servicio".into(),
                    qty_milli: 1000,
                    unit_price_minor: amount,
                    discount_ppm: 0,
                    taxable: true,
                }],
                notes: None,
            },
            None,
        )
        .unwrap();
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: "contado".into(),
            method: "Transferencia".into(),
            due_date: None,
            account_uid: None,
        },
    )
    .unwrap();
    if let Some(kind) = document {
        s.mark_documented(
            &v.summary.uid,
            &ExternalRefInput {
                doc_kind: Some(kind.into()),
                external_number: Some("100".into()),
                issue_date: Some(today()),
                observation: None,
            },
        )
        .unwrap();
    }
}

const COMPRAS: &str = "Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social;Folio;Fecha Docto;Monto Exento;Monto Neto;Monto IVA Recuperable;Monto Iva No Recuperable;Monto Total\n\
1;33;Del Giro;76123456-7;Proveedor Uno SpA;1500;05/09/2026;0;30000;3000;0;33000\n\
2;33;Del Giro;77111222-3;Restaurante;9;15/09/2026;0;5000;0;500;5500\n";

#[test]
fn borrador_del_f29_de_punta_a_punta() {
    let (_d, _app, mut s) = session();
    // Tasa de EJEMPLO anotada por el usuario (no es un valor normativo).
    s.update_business(&BusinessPatch {
        tax_rate_user_ppm: Some(100_000),
        ..Default::default()
    })
    .unwrap();
    let period = today()[..7].to_string();
    sale(&mut s, 100_000, Some("Factura"));
    sale(&mut s, 50_000, None); // queda pendiente de documentar

    // 1) Solo con datos de NÚCLEO y sin tasa de PPM: borrador incompleto.
    let v = s.f29(&period).unwrap();
    assert_eq!(v.sources[0].source, "nucleo");
    assert_eq!(v.result.codes[&503], 1);
    assert_eq!(v.result.codes[&502], 10_000);
    assert_eq!(v.result.codes[&89], 10_000);
    assert!(!v.result.complete, "falta la tasa de PPM");
    assert!(v.checks.iter().any(|c| c.text.contains("sin documentar")));

    // 2) Perfil con tasa de PPM de EJEMPLO.
    s.save_tax_profile(&TaxProfile {
        regime: "14d3".into(),
        ppm_rate_ppm: Some(2_500),
        utm_decimals: None,
        due_day: Some(20),
        common_use_ppm: None,
    })
    .unwrap();
    let v = s.f29(&period).unwrap();
    assert!(v.result.complete);
    assert_eq!(v.result.codes[&563], 100_000);
    assert_eq!(v.result.codes[&62], 250);
    assert!(v.due_date.unwrap().ends_with("-20"));

    // 3) Registro de compras del SII: reemplaza las compras de NÚCLEO.
    let rep = s
        .import_rcv(&period, "compra", Some("RCV_COMPRA.csv"), COMPRAS)
        .unwrap();
    assert_eq!(rep.rows, 2);
    let v = rep.view;
    assert_eq!(v.sources[1].source, "rcv");
    assert_eq!(v.result.codes[&520], 3_000);
    assert_eq!(v.result.codes[&564], 1, "la del restaurante no da crédito");
    assert_eq!(v.result.codes[&89], 7_000);

    // 4) Un documento a mano (resumen de boletas) y el impuesto único del sueldo empresarial.
    let v = s
        .add_tax_document(
            &period,
            &TaxDocInput {
                direction: "venta".into(),
                sii_type: 39,
                folio: None,
                issue_date: None,
                counterpart_rut: None,
                counterpart_name: None,
                doc_count: Some(12),
                exempt_minor: 0,
                net_minor: 10_000,
                tax_minor: 1_000,
                purchase_kind: None,
                not_of_business: false,
                note: Some("Resumen de boletas".into()),
            },
        )
        .unwrap();
    assert_eq!(v.result.codes[&110], 12);
    let mut inputs = F29Inputs::default();
    inputs.manual.insert("48".into(), 5_000);
    let v = s.save_f29_inputs(&period, &inputs).unwrap();
    // 89 = 10.000 + 1.000 − 3.000; PPM sobre 110.000; + impuesto único.
    assert_eq!(v.result.codes[&89], 8_000);
    assert_eq!(v.result.codes[&62], 275);
    assert_eq!(v.result.codes[&91], 8_000 + 275 + 5_000);
    let mut bad = F29Inputs::default();
    bad.manual.insert("502".into(), 1);
    assert!(
        s.save_f29_inputs(&period, &bad).is_err(),
        "502 no es manual"
    );

    // 5) Marcar como declarado congela el borrador; reabrir exige motivo.
    let v = s
        .mark_f29_declared(&period, 0, 13_275, Some("123456".into()))
        .unwrap();
    assert_eq!(v.status, "declarado");
    assert!(s.save_f29_inputs(&period, &inputs).is_err());
    assert!(s.reopen_f29(&period, " ").is_err());
    let v = s.reopen_f29(&period, "Faltó una factura").unwrap();
    assert_eq!(v.status, "borrador");

    // 6) Quitar el registro importado vuelve a los datos de NÚCLEO.
    let v = s.clear_rcv(&period, "compra").unwrap();
    assert_eq!(v.sources[1].source, "nucleo");
}

#[test]
fn remanente_declarado_pasa_al_mes_siguiente_reajustado() {
    let (_d, _app, mut s) = session();
    let rcv = "Tipo Doc;Folio;Rut Proveedor;Razon Social;Fecha Docto;Monto Neto;Monto IVA Recuperable;Monto Total\n\
33;1;76123456-7;Proveedor;10/01/2026;100000;50000;150000\n";
    let v = s.import_rcv("2026-01", "compra", None, rcv).unwrap().view;
    assert_eq!(v.result.codes[&77], 50_000);
    s.mark_f29_declared("2026-01", 50_000, 0, None).unwrap();

    let v = s.f29("2026-02").unwrap();
    assert_eq!(v.remnant_suggested, Some(50_000));
    assert_eq!(v.remnant_from.as_deref(), Some("2026-01"));
    assert!(!v.result.complete, "faltan las UTM");
    // UTM de EJEMPLO.
    let v = s
        .save_f29_inputs(
            "2026-02",
            &F29Inputs {
                utm_prev: Some(70_000),
                utm_cur: Some(70_700),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(v.result.codes[&504], 50_500);
    assert_eq!(v.result.codes[&77], 50_500);
    assert!(v.result.complete);
}
