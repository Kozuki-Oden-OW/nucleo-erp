//! Crédito a clientes: habilitar, documentos de respaldo opcionales, consejos y carpeta exportada.

use nucleo_app::core_ops::EntityRef;
use nucleo_app::credit_ops::CreditDocInput;
use nucleo_app::nucleo_db::customers::CustomerProfile;
use nucleo_app::{AppService, BusinessProfile, MemoryKeyStore, NewCustomer};

#[test]
fn credito_con_documentos_y_carpeta_del_cliente() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let co = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&co.company.uid).unwrap();

    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Los Lagos SpA".into(),
            rut: Some("76.086.428-5".into()),
            profile: CustomerProfile {
                kind: "empresa".into(),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
    let cr = s.customer_credit(&c.uid).unwrap();
    assert!(!cr.enabled);
    assert_eq!(cr.docs.len(), 7);
    assert_eq!(cr.docs_applicable, 6, "empresa: aplican los de sociedad");

    // Crédito sin respaldos: se permite, con un consejo.
    let c = s
        .update_customer(
            &c.uid,
            &NewCustomer {
                name: c.name.clone(),
                rut: c.rut.clone(),
                profile: CustomerProfile {
                    kind: "empresa".into(),
                    credit_enabled: true,
                    payment_terms_days: 30,
                    credit_limit_minor: Some(2_000_000),
                    credit_conditions: Some("Pagaré firmado".into()),
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .unwrap();
    let cr = s.customer_credit(&c.uid).unwrap();
    assert!(cr.enabled);
    assert_eq!(cr.available_minor, Some(2_000_000));
    assert!(cr.advice.iter().any(|a| a.contains("sin respaldos")));

    // Carpeta tributaria adjunta y verificada; un certificado viejo queda marcado.
    let file = data.path().join("carpeta.pdf");
    std::fs::write(&file, b"%PDF-1.4 prueba").unwrap();
    let a = s
        .add_attachment(
            &file,
            Some("Carpeta tributaria"),
            Some(&EntityRef {
                entity: "cliente".into(),
                uid: c.uid.clone(),
            }),
        )
        .unwrap();
    let cr = s
        .save_credit_doc(
            &c.uid,
            "carpeta_tributaria",
            &CreditDocInput {
                status: "verificado".into(),
                attachment_uid: Some(a.uid.clone()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(cr.docs_ready, 1);
    let cr = s
        .save_credit_doc(
            &c.uid,
            "vigencia",
            &CreditDocInput {
                status: "recibido".into(),
                issued_on: Some("2020-01-01".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(cr.docs.iter().find(|d| d.kind == "vigencia").unwrap().stale);
    assert!(
        s.save_credit_doc(&c.uid, "pasaporte", &CreditDocInput::default())
            .is_err()
    );

    // Carpeta del cliente con la subcarpeta Crédito.
    let out = tempfile::tempdir().unwrap();
    let (folder, n) = s.export_customer_folder(&c.uid, out.path()).unwrap();
    assert_eq!(n, 1);
    let copied = std::path::Path::new(&folder)
        .join("Crédito")
        .join("02 Carpeta tributaria electrónica - carpeta.pdf");
    assert_eq!(std::fs::read(copied).unwrap(), b"%PDF-1.4 prueba");
    // Exportar de nuevo reemplaza, no duplica.
    s.export_customer_folder(&c.uid, out.path()).unwrap();
    assert_eq!(
        std::fs::read_dir(std::path::Path::new(&folder).join("Crédito"))
            .unwrap()
            .count(),
        1
    );
}
