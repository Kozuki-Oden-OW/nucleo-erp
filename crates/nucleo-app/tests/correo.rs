//! Correo de la empresa: configuración (la clave no vuelve a la interfaz), borradores de cobro y de
//! despacho con los datos reales, envío con un transporte simulado y registro de cada correo.

use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::mail_ops::{MailDraft, MailSetup, MailTemplates, MailTransport, OutgoingMail};
use nucleo_app::sales_ops::{EffectInput, LineInput, SaleInput};
use nucleo_app::ship_ops::ShipmentInput;
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer};
use std::cell::RefCell;

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    s.update_business(&BusinessPatch {
        phone: Some("+56 9 1234 5678".into()),
        ..Default::default()
    })
    .unwrap();
    (data, app, s)
}

fn day(n: i64) -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            "SELECT date('now', 'localtime', ?1)",
            [format!("{n:+} days")],
            |r| r.get(0),
        )
        .unwrap()
}

#[derive(Default)]
struct Fake {
    sent: RefCell<Vec<OutgoingMail>>,
    fail: bool,
}
impl MailTransport for Fake {
    fn send(&self, m: &OutgoingMail) -> Result<(), String> {
        if self.fail {
            return Err("el servidor rechazó el usuario o la clave".into());
        }
        self.sent.borrow_mut().push(m.clone());
        Ok(())
    }
}

fn setup() -> MailSetup {
    MailSetup {
        host: "smtp.titan.email".into(),
        port: None,
        security: "tls".into(),
        username: "ventas@datalogger.cl".into(),
        password: "clave-de-prueba".into(),
        from_name: "Data Logger".into(),
        from_email: "Ventas@DataLogger.cl".into(),
        reply_to: String::new(),
        bcc_self: true,
    }
}

fn credit_sale(s: &mut CompanySession, customer: &str, amount: i64, due: i64) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(customer.into()),
                issue_date: day(-40),
                lines: vec![LineInput {
                    product_uid: None,
                    description: "Servicio de mapeo térmico".into(),
                    qty_milli: 1000,
                    unit_price_minor: amount,
                    discount_ppm: 0,
                    taxable: false,
                }],
                notes: None,
                terms: None,
            },
            None,
        )
        .unwrap();
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: "credito".into(),
            method: String::new(),
            due_date: Some(day(due)),
            account_uid: None,
        },
    )
    .unwrap();
}

#[test]
fn configuracion_sin_mostrar_la_clave() {
    let (_d, _a, mut s) = session();
    assert!(!s.mail_status().unwrap().configured);
    let mut bad = setup();
    bad.host = "https://smtp.titan.email".into();
    assert!(s.mail_save(&bad).is_err());
    let mut bad = setup();
    bad.password = String::new();
    assert!(s.mail_save(&bad).unwrap_err().to_string().contains("clave"));
    let st = s.mail_save(&setup()).unwrap();
    assert!(st.configured && st.has_password);
    assert_eq!(
        (st.port, st.from_email.as_str()),
        (465, "ventas@datalogger.cl")
    );
    assert!(
        !serde_json::to_string(&st)
            .unwrap()
            .contains("clave-de-prueba")
    );
    // Guardar otra vez sin clave conserva la anterior.
    let mut again = setup();
    again.password = String::new();
    again.security = "starttls".into();
    let st = s.mail_save(&again).unwrap();
    assert!(st.has_password);
    assert_eq!(st.port, 587);

    let fake = Fake::default();
    let m = s.mail_test_plan(None).unwrap();
    assert_eq!(m.draft.to, "ventas@datalogger.cl");
    assert_eq!(m.cfg.password, "clave-de-prueba");
    let r = fake.send(&m);
    s.mail_record(&m, &r).unwrap();
    assert!(s.mail_status().unwrap().last_test_at.is_some());

    // Una falla también queda registrada, sin marcar la prueba.
    let failing = Fake {
        fail: true,
        ..Default::default()
    };
    let r = failing.send(&m);
    let row = s.mail_record(&m, &r).unwrap();
    assert_eq!(row.status, "fallido");
    assert_eq!(s.mail_log(None, None).unwrap().len(), 2);
}

#[test]
fn cobro_y_despacho() {
    let (_d, _a, mut s) = session();
    s.mail_save(&setup()).unwrap();
    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur".into(),
            email: Some("pagos@clinicasur.cl".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(
        s.mail_draft_collection(&c.uid)
            .unwrap_err()
            .to_string()
            .contains("no tiene documentos pendientes")
    );
    credit_sale(&mut s, &c.uid, 100_000, -5);
    credit_sale(&mut s, &c.uid, 50_000, 20);

    let d = s.mail_draft_collection(&c.uid).unwrap();
    assert_eq!(d.to, "pagos@clinicasur.cl");
    assert!(d.body.contains("Hola Clínica Sur"));
    assert!(
        d.body.contains("$150.000") && d.body.contains("(vencido: $100.000)"),
        "{}",
        d.body
    );
    assert!(d.body.contains("venció el") && d.body.contains("vence el"));
    assert!(d.body.contains("+56 9 1234 5678"));

    let fake = Fake::default();
    let m = s.mail_plan(&d).unwrap();
    let r = fake.send(&m);
    let row = s.mail_record(&m, &r).unwrap();
    assert_eq!(
        (row.status.as_str(), row.customer_name.as_deref()),
        ("enviado", Some("Clínica Sur"))
    );
    assert_eq!(s.mail_log(Some(&c.uid), None).unwrap().len(), 1);

    // Plantilla propia.
    let mut t = MailTemplates::default();
    t.envio.subject = "Despachamos tu pedido {venta}".into();
    s.mail_save_templates(&t).unwrap();
    let e = s
        .save_shipment(
            None,
            &ShipmentInput {
                customer_uid: Some(c.uid.clone()),
                carrier: Some("Bluexpress".into()),
                tracking: Some("BX123".into()),
                commune: Some("Frutillar".into()),
                status: "en_camino".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let d = s.mail_draft_shipment(&e.uid).unwrap();
    assert_eq!(d.subject, format!("Despachamos tu pedido {}", e.number));
    assert!(
        d.body.contains("Bluexpress") && d.body.contains("BX123") && d.body.contains("Frutillar")
    );

    // Validaciones del envío.
    assert!(
        s.mail_plan(&MailDraft {
            to: String::new(),
            ..d.clone()
        })
        .is_err()
    );
    assert!(
        s.mail_plan(&MailDraft {
            to: "no-es-correo".into(),
            ..d.clone()
        })
        .is_err()
    );
    assert!(
        s.mail_plan(&MailDraft {
            kind: "spam".into(),
            ..d.clone()
        })
        .is_err()
    );
    let p = s.mail_draft_promotion(&c.uid).unwrap();
    assert!(p.body.contains("BAJA"));
}

/// Envío SMTP real contra un servidor local (solo si NUCLEO_SMTP_TEST=1 y hay un servidor en 2525).
#[test]
fn smtp_local() {
    if std::env::var("NUCLEO_SMTP_TEST").is_err() {
        return;
    }
    use nucleo_app::mail_ops::{MailConfig, SmtpMail};
    let m = OutgoingMail {
        cfg: MailConfig {
            host: "127.0.0.1".into(),
            port: 2525,
            security: "ninguna".into(),
            username: "ventas@datalogger.cl".into(),
            password: "clave".into(),
            from_name: "Data Logger".into(),
            from_email: "ventas@datalogger.cl".into(),
            reply_to: String::new(),
            bcc_self: false,
        },
        draft: MailDraft {
            kind: "prueba".into(),
            to: "cliente@ejemplo.cl".into(),
            subject: "Prueba ñandú".into(),
            body: "Hola, línea con tildes: Frutillar.".into(),
            ..Default::default()
        },
        customer_id: None,
    };
    SmtpMail.send(&m).unwrap();
    let mut bad = m.clone();
    bad.cfg.password = "otra".into();
    // Clave equivocada: falla (el texto depende de cómo responda el servidor).
    assert!(SmtpMail.send(&bad).is_err());
}
