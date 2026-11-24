//! La cotización como documento: ajustes del negocio (plantilla, carpeta, condiciones y datos de
//! transferencia), condiciones de cada cotización y guardado del PDF emitido en la carpeta elegida.

use data_encoding::BASE64;
use nucleo_app::quote_doc_ops::{QuoteBank, QuoteDocSettings, QuoteTerms};
use nucleo_app::sales_ops::{LineInput, QuoteInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger de prueba", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn quote(s: &mut CompanySession, prospect: &str) -> String {
    s.save_quote(
        &QuoteInput {
            customer_uid: None,
            prospect_name: Some(prospect.into()),
            issue_date: "2026-11-24".into(),
            valid_until: Some("2026-12-09".into()),
            lines: vec![LineInput {
                product_uid: None,
                description: "RC-5+ con sonda".into(),
                qty_milli: 1000,
                unit_price_minor: 27_900,
                discount_ppm: 0,
                taxable: true,
            }],
            notes: None,
        },
        None,
    )
    .unwrap()
    .summary
    .uid
}

#[test]
fn ajustes_condiciones_y_pdf_en_la_carpeta() {
    let (data, _app, mut s) = session();
    let uid = quote(&mut s, "Universidad: \"de los Andes\" / Compras");

    // De fábrica: plantilla clásica, sin carpeta.
    let d = s.quote_doc_settings().unwrap();
    assert_eq!(d.template, "clasica");
    assert!(d.folder.is_none());
    let pdf = BASE64.encode(b"%PDF-1.3\n% cotizacion de prueba\n%%EOF\n");
    let e = s.save_quote_pdf(&uid, &pdf).unwrap_err().to_string();
    assert!(e.contains("elige primero la carpeta"), "{e}");

    // El dueño elige plantilla, carpeta (aún no existe) y condiciones habituales.
    let folder = data.path().join("Cotizaciones emitidas");
    let saved = s
        .save_quote_doc_settings(&QuoteDocSettings {
            template: "moderna".into(),
            folder: Some(folder.to_string_lossy().to_string()),
            terms: QuoteTerms {
                delivery: " 2 días hábiles ".into(),
                warranty: "6 meses".into(),
                payment: "Contado".into(),
            },
            contact_note: "Si tiene alguna pregunta, escríbanos.".into(),
            footer: "Gracias por confiar en nosotros".into(),
            bank: QuoteBank {
                show: true,
                holder: "Data Logger de prueba SpA".into(),
                bank: "Banco de ejemplo".into(),
                account: "00000000".into(),
                ..Default::default()
            },
        })
        .unwrap();
    assert_eq!(saved.terms.delivery, "2 días hábiles");
    assert_eq!(s.quote_doc_settings().unwrap(), saved);

    // Una cotización sin condiciones propias usa las habituales; al cambiarlas, quedan en ella.
    assert_eq!(s.quote_terms(&uid).unwrap().delivery, "2 días hábiles");
    s.save_quote_terms(
        &uid,
        &QuoteTerms {
            delivery: "5 días hábiles".into(),
            warranty: "12 meses".into(),
            payment: "30 días con orden de compra".into(),
        },
    )
    .unwrap();
    assert_eq!(
        s.quote_terms(&uid).unwrap().payment,
        "30 días con orden de compra"
    );
    let otra = quote(&mut s, "Otro cliente");
    assert_eq!(s.quote_terms(&otra).unwrap().delivery, "2 días hábiles");

    // Emitir crea la carpeta y deja el archivo con número y cliente, sin caracteres inválidos.
    let r = s.save_quote_pdf(&uid, &pdf).unwrap();
    assert_eq!(
        r.file_name,
        "COT-000001 Universidad de los Andes Compras.pdf"
    );
    assert!(std::path::Path::new(&r.path).starts_with(&folder));
    assert!(std::fs::read(&r.path).unwrap().starts_with(b"%PDF-"));
    // Volver a emitir reemplaza el archivo.
    let again = s
        .save_quote_pdf(&uid, &BASE64.encode(b"%PDF-1.3\n% segunda version\n"))
        .unwrap();
    assert_eq!(again.path, r.path);
    assert!(String::from_utf8_lossy(&std::fs::read(&r.path).unwrap()).contains("segunda version"));
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1);

    // La emisión queda en la auditoría y la cotización no cambia de estado.
    assert!(
        s.audit_log("", None)
            .unwrap()
            .iter()
            .any(|a| a.action == "cotizacion.emitir")
    );
    assert_eq!(s.quote(&uid).unwrap().summary.status, "borrador");
}

#[test]
fn se_rechaza_lo_que_no_corresponde() {
    let (_data, _app, mut s) = session();
    let uid = quote(&mut s, "Cliente");
    let base = QuoteDocSettings::default();

    let e = s
        .save_quote_doc_settings(&QuoteDocSettings {
            template: "inventada".into(),
            ..base.clone()
        })
        .unwrap_err()
        .to_string();
    assert!(e.contains("plantillas"), "{e}");
    let e = s
        .save_quote_doc_settings(&QuoteDocSettings {
            folder: Some("Cotizaciones".into()),
            ..base.clone()
        })
        .unwrap_err()
        .to_string();
    assert!(e.contains("ruta completa"), "{e}");

    let dir = tempfile::tempdir().unwrap();
    s.save_quote_doc_settings(&QuoteDocSettings {
        folder: Some(dir.path().to_string_lossy().to_string()),
        ..base
    })
    .unwrap();
    // No es un PDF, o llegó dañado.
    assert!(
        s.save_quote_pdf(&uid, &BASE64.encode(b"<html>hola</html>"))
            .is_err()
    );
    assert!(s.save_quote_pdf(&uid, "esto no es base64 !!!").is_err());
    assert!(
        s.save_quote_pdf("no-existe", &BASE64.encode(b"%PDF-1.3\n"))
            .is_err()
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}
