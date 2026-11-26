//! Lo que NÚCLEO hace solo: la ronda de cobranza (primero lo más vencido, con los datos de pago), el
//! informe por correo con la meta del mes y los cobros recurrentes. Todo con un transporte simulado.

use nucleo_app::auto_ops::run_due;
use nucleo_app::collect_ops::{CollectSettings, due_at};
use nucleo_app::digest_ops::DigestSettings;
use nucleo_app::mail_ops::{MailSetup, MailTransport, OutgoingMail};
use nucleo_app::quote_doc_ops::{QuoteBank, QuoteCard, QuoteDocSettings};
use nucleo_app::recurring_ops::RecurringSaleInput;
use nucleo_app::sales_ops::{EffectInput, LineInput, SaleInput};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer};
use std::cell::RefCell;

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
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
            return Err("sin conexión".into());
        }
        self.sent.borrow_mut().push(m.clone());
        Ok(())
    }
}

fn mailbox(s: &mut CompanySession) {
    s.mail_save(&MailSetup {
        host: "smtp.titan.email".into(),
        port: None,
        security: "tls".into(),
        username: "ventas@datalogger.cl".into(),
        password: "clave-de-prueba".into(),
        from_name: "Data Logger".into(),
        from_email: "ventas@datalogger.cl".into(),
        reply_to: String::new(),
        bcc_self: false,
        agent_send: false,
    })
    .unwrap();
}

fn customer(s: &mut CompanySession, name: &str, email: Option<&str>) -> String {
    s.add_customer(&NewCustomer {
        name: name.into(),
        email: email.map(String::from),
        ..Default::default()
    })
    .unwrap()
    .uid
}

fn line(desc: &str, price: i64) -> LineInput {
    LineInput {
        product_uid: None,
        description: desc.into(),
        qty_milli: 1000,
        unit_price_minor: price,
        discount_ppm: 0,
        taxable: false,
    }
}

fn credit_sale(s: &mut CompanySession, customer: &str, amount: i64, due: i64) {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(customer.into()),
                issue_date: day(-60),
                lines: vec![line("Servicio de mapeo térmico", amount)],
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

fn always() -> Vec<u8> {
    vec![1, 2, 3, 4, 5, 6, 7]
}

#[test]
fn la_ronda_parte_por_lo_mas_vencido() {
    let (_d, _a, mut s) = session();
    mailbox(&mut s);
    s.save_quote_doc_settings(&QuoteDocSettings {
        bank: QuoteBank {
            show: true,
            holder: "Data Logger Chile SpA".into(),
            rut: "77.334.963-0".into(),
            bank: "BCI".into(),
            account_type: "Cuenta corriente".into(),
            account: "0000".into(),
            email: "ventas@datalogger.cl".into(),
        },
        card: QuoteCard {
            show: true,
            url: "https://www.webpay.cl/company/152106".into(),
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap();
    let sur = customer(&mut s, "Clínica Sur", Some("pagos@clinicasur.cl"));
    let norte = customer(&mut s, "Frigorífico Norte", Some("admin@norte.cl"));
    let sin = customer(&mut s, "Sin Correo Ltda.", None);
    let al_dia = customer(&mut s, "Al Día SpA", Some("ok@aldia.cl"));
    credit_sale(&mut s, &sur, 100_000, -5);
    credit_sale(&mut s, &sur, 50_000, 20);
    credit_sale(&mut s, &norte, 300_000, -40);
    credit_sale(&mut s, &sin, 80_000, -10);
    credit_sale(&mut s, &al_dia, 70_000, 15);

    let r = s.collect_round().unwrap();
    let names: Vec<&str> = r.items.iter().map(|i| i.customer_name.as_str()).collect();
    assert_eq!(
        names,
        ["Frigorífico Norte", "Sin Correo Ltda.", "Clínica Sur"]
    );
    assert_eq!(r.items[0].max_days_late, 40);
    assert_eq!(r.items[1].state, "sin_correo");
    assert_eq!((r.ready, r.overdue_minor), (2, 480_000));
    // Clínica Sur debe dos documentos: el recordatorio lleva todo, pero «atrasado» es solo lo vencido.
    assert_eq!(
        (
            r.items[2].total_minor,
            r.items[2].overdue_minor,
            r.items[2].docs.len()
        ),
        (150_000, 100_000, 2)
    );
    assert!(!r.due_now);

    // Con aviso previo entra también quien vence dentro del plazo.
    let cfg = s
        .collect_save_settings(&CollectSettings {
            before_days: 15,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(s.collect_round().unwrap().items.len(), 4);
    s.collect_save_settings(&CollectSettings {
        before_days: 0,
        ..cfg
    })
    .unwrap();

    // Envío manual de toda la ronda.
    let fake = Fake::default();
    let mails = s.collect_plan(None).unwrap();
    assert_eq!(mails.len(), 2);
    assert_eq!(mails[0].draft.to, "admin@norte.cl");
    let body = &mails[1].draft.body;
    assert!(
        body.contains("Puedes pagar por transferencia")
            && body.contains("Data Logger Chile SpA")
            && body.contains("RUT 77.334.963-0")
            && body.contains("BCI · Cuenta corriente N° 0000")
            && body.contains(
                "También puedes pagar con tarjeta aquí: https://www.webpay.cl/company/152106"
            ),
        "{body}"
    );
    assert!(body.contains("$150.000") && body.contains("(vencido: $100.000)"));
    for m in &mails {
        let res = fake.send(m);
        s.mail_record(m, &res).unwrap();
    }
    s.collect_finish("manual", 2, 0).unwrap();

    // Ya se les escribió: no se repite antes de los días de espera, salvo que la persona insista.
    let r = s.collect_round().unwrap();
    assert_eq!(r.ready, 0);
    assert!(r.items.iter().filter(|i| i.state == "reciente").count() == 2);
    assert!(s.collect_plan(None).unwrap().is_empty());
    assert_eq!(
        s.collect_plan(Some(std::slice::from_ref(&sur)))
            .unwrap()
            .len(),
        1
    );
    assert!(s.collect_plan(Some(std::slice::from_ref(&sin))).is_err());

    // Excluir a un cliente lo saca de todo envío.
    s.collect_save_settings(&CollectSettings {
        excluded: vec![sur.clone(), "no-existe".into()],
        repeat_days: 0,
        ..Default::default()
    })
    .unwrap();
    let r = s.collect_round().unwrap();
    assert_eq!(r.settings.excluded, vec![sur.clone()]);
    assert_eq!(r.ready, 1);
    assert!(s.collect_plan(Some(&[sur])).is_err());
}

#[test]
fn la_ronda_programada_y_los_permisos() {
    assert!(due_at(&[1, 4], 10, None, "2026-11-26", 4, 10));
    assert!(!due_at(&[1, 4], 10, None, "2026-11-26", 4, 9));
    assert!(!due_at(&[1, 4], 10, None, "2026-11-27", 5, 12));
    assert!(!due_at(
        &[1, 4],
        10,
        Some("2026-11-26"),
        "2026-11-26",
        4,
        15
    ));

    let (_d, _a, mut s) = session();
    let sur = customer(&mut s, "Clínica Sur", Some("pagos@clinicasur.cl"));
    credit_sale(&mut s, &sur, 100_000, -5);
    let fake = Fake::default();
    // Sin nada programado no pasa nada.
    assert!(run_due(&mut s, &fake).unwrap().is_empty());

    for bad in [
        CollectSettings {
            mode: "spam".into(),
            ..Default::default()
        },
        CollectSettings {
            enabled: true,
            weekdays: vec![],
            ..Default::default()
        },
        CollectSettings {
            weekdays: vec![8],
            ..Default::default()
        },
        CollectSettings {
            hour: 24,
            ..Default::default()
        },
        CollectSettings {
            max_per_run: 0,
            ..Default::default()
        },
    ] {
        assert!(s.collect_save_settings(&bad).is_err(), "{bad:?}");
    }
    let programada = CollectSettings {
        enabled: true,
        mode: "enviar".into(),
        weekdays: always(),
        hour: 0,
        ..Default::default()
    };
    // Claude no programa la ronda.
    s.set_via_agent(true);
    assert!(s.collect_save_settings(&programada).is_err());
    s.set_via_agent(false);
    s.collect_save_settings(&programada).unwrap();
    assert!(s.collect_round().unwrap().due_now);

    // Programada para enviar, pero sin casilla: avisa una vez y no insiste el mismo día.
    let done = run_due(&mut s, &fake).unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!(
        (done[0].kind.as_str(), done[0].tone.as_str()),
        ("cobranza_sin_correo", "warning")
    );
    assert!(run_due(&mut s, &fake).unwrap().is_empty());
    assert!(fake.sent.borrow().is_empty());
}

#[test]
fn la_ronda_sale_sola_una_vez_al_dia() {
    let (_d, _a, mut s) = session();
    mailbox(&mut s);
    let sur = customer(&mut s, "Clínica Sur", Some("pagos@clinicasur.cl"));
    let norte = customer(&mut s, "Frigorífico Norte", Some("admin@norte.cl"));
    credit_sale(&mut s, &sur, 100_000, -5);
    credit_sale(&mut s, &norte, 300_000, -40);
    s.collect_save_settings(&CollectSettings {
        enabled: true,
        mode: "enviar".into(),
        weekdays: always(),
        hour: 0,
        ..Default::default()
    })
    .unwrap();
    let fake = Fake::default();

    // Mientras Claude está usando NÚCLEO no se planifica nada.
    s.set_via_agent(true);
    assert!(run_due(&mut s, &fake).unwrap().is_empty());
    s.set_via_agent(false);

    let done = run_due(&mut s, &fake).unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!(
        (done[0].kind.as_str(), done[0].sent, done[0].failed),
        ("cobranza", 2, 0)
    );
    assert_eq!(fake.sent.borrow().len(), 2);
    let log = s.mail_log(None, None).unwrap();
    assert_eq!(log.len(), 2);
    assert!(
        log.iter()
            .all(|r| r.kind == "cobro" && r.user_name.ends_with("(programado)"))
    );
    assert!(log.iter().all(|r| {
        r.reference
            .as_deref()
            .is_some_and(|x| x.starts_with("VEN-"))
    }));
    // Segunda vuelta el mismo día: nada.
    assert!(run_due(&mut s, &fake).unwrap().is_empty());
    assert_eq!(fake.sent.borrow().len(), 2);
    let r = s.collect_round().unwrap();
    assert_eq!(
        (r.last.last_kind.as_str(), r.last.last_sent, r.due_now),
        ("programada", 2, false)
    );
}

#[test]
fn modo_avisar_no_envia() {
    let (_d, _a, mut s) = session();
    mailbox(&mut s);
    let sur = customer(&mut s, "Clínica Sur", Some("pagos@clinicasur.cl"));
    credit_sale(&mut s, &sur, 100_000, -5);
    s.collect_save_settings(&CollectSettings {
        enabled: true,
        weekdays: always(),
        hour: 0,
        ..Default::default()
    })
    .unwrap();
    let fake = Fake::default();
    let done = run_due(&mut s, &fake).unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!(done[0].kind, "cobranza_aviso");
    assert!(
        done[0].title.contains("1 cliente por avisar"),
        "{}",
        done[0].title
    );
    assert!(fake.sent.borrow().is_empty());
    assert!(run_due(&mut s, &fake).unwrap().is_empty());
    // La ronda sigue lista para que la persona la envíe.
    assert_eq!(s.collect_round().unwrap().ready, 1);
}

#[test]
fn informe_por_correo_con_meta() {
    let (_d, _a, mut s) = session();
    mailbox(&mut s);
    let sur = customer(&mut s, "Clínica Sur", Some("pagos@clinicasur.cl"));
    credit_sale(&mut s, &sur, 100_000, -5);
    // Una venta de este mes para el avance de la meta.
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(sur.clone()),
                issue_date: day(0),
                lines: vec![line("Tlog 10", 250_000)],
                notes: None,
                terms: None,
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

    assert!(s.sales_goal().unwrap().is_none());
    assert!(
        s.digest_save_settings(&DigestSettings {
            to: "no-es-correo".into(),
            ..Default::default()
        })
        .is_err()
    );
    s.set_via_agent(true);
    assert!(s.digest_save_settings(&DigestSettings::default()).is_err());
    s.set_via_agent(false);
    s.digest_save_settings(&DigestSettings {
        enabled: true,
        weekdays: always(),
        hour: 0,
        to: "Dueno@DataLogger.cl".into(),
        goal_minor: 1_000_000,
    })
    .unwrap();
    let g = s.sales_goal().unwrap().unwrap();
    assert_eq!(
        (g.sold_minor, g.remaining_minor, g.progress_ppm),
        (250_000, 750_000, 250_000)
    );

    let p = s.digest_preview().unwrap();
    assert_eq!(p.to, "dueno@datalogger.cl");
    for part in [
        "Informe de Data Logger",
        "VENTAS",
        "Hoy, hasta ahora: $250.000 en 1 venta",
        "Meta del mes: $1.000.000 · llevas 25 % · faltan $750.000",
        "DINERO",
        "Te deben: $100.000 (atrasado: $100.000)",
    ] {
        assert!(p.body.contains(part), "falta «{part}» en:\n{}", p.body);
    }

    let fake = Fake::default();
    let done = run_due(&mut s, &fake).unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!((done[0].kind.as_str(), done[0].sent), ("informe", 1));
    let sent = fake.sent.borrow();
    assert_eq!(sent[0].draft.to, "dueno@datalogger.cl");
    assert!(sent[0].draft.subject.contains("ventas del mes $250.000"));
    drop(sent);
    assert_eq!(s.mail_log(None, None).unwrap()[0].kind, "informe");
    assert!(run_due(&mut s, &fake).unwrap().is_empty());

    // Si el correo falla, queda anotado y no se reintenta cada cinco minutos.
    let (_d2, _a2, mut s2) = session();
    mailbox(&mut s2);
    s2.digest_save_settings(&DigestSettings {
        enabled: true,
        weekdays: always(),
        hour: 0,
        ..Default::default()
    })
    .unwrap();
    let bad = Fake {
        fail: true,
        ..Default::default()
    };
    let done = run_due(&mut s2, &bad).unwrap();
    assert_eq!((done[0].tone.as_str(), done[0].failed), ("warning", 1));
    assert!(run_due(&mut s2, &bad).unwrap().is_empty());
    let p = s2.digest_preview().unwrap();
    assert_eq!(p.to, "ventas@datalogger.cl");
    assert_eq!(p.last.last_error.as_deref(), Some("sin conexión"));
}

#[test]
fn cobro_recurrente_genera_la_venta_y_avisa() {
    let (_d, _a, mut s) = session();
    mailbox(&mut s);
    let sur = customer(&mut s, "Clínica Sur", Some("pagos@clinicasur.cl"));
    let input = RecurringSaleInput {
        name: "Monitoreo mensual".into(),
        customer_uid: sur.clone(),
        lines: vec![line("Plataforma de monitoreo, 4 equipos", 40_000)],
        notes: None,
        frequency: "mensual".into(),
        next_date: day(5),
        end_date: None,
        credit_days: 10,
        confirm: true,
        send_mail: true,
        active: true,
    };
    for bad in [
        RecurringSaleInput {
            name: " ".into(),
            ..input.clone()
        },
        RecurringSaleInput {
            frequency: "semanal".into(),
            ..input.clone()
        },
        RecurringSaleInput {
            lines: vec![],
            ..input.clone()
        },
        RecurringSaleInput {
            end_date: Some(day(1)),
            ..input.clone()
        },
        RecurringSaleInput {
            customer_uid: "no-existe".into(),
            ..input.clone()
        },
    ] {
        assert!(s.save_recurring_sale(&bad, None).is_err());
    }
    s.set_via_agent(true);
    assert!(s.save_recurring_sale(&input, None).is_err());
    s.set_via_agent(false);
    let r = s.save_recurring_sale(&input, None).unwrap();
    assert_eq!((r.total_minor, r.due_now, r.runs), (Some(40_000), false, 0));

    // Aún no toca.
    let fake = Fake::default();
    assert!(run_due(&mut s, &fake).unwrap().is_empty());

    // Ya tocaba (NÚCLEO estuvo cerrado dos días).
    let r = s
        .save_recurring_sale(
            &RecurringSaleInput {
                next_date: day(-2),
                ..input.clone()
            },
            Some(&r.uid),
        )
        .unwrap();
    assert!(r.due_now);
    let done = run_due(&mut s, &fake).unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!(
        (done[0].kind.as_str(), done[0].sent, done[0].failed),
        ("recurrente", 1, 0)
    );
    assert!(done[0].title.contains("1 venta generada"));

    let after = s.recurring_sales().unwrap().pop().unwrap();
    assert_eq!(after.runs, 1);
    assert!(after.next_date > day(0) && !after.due_now);
    assert_eq!(after.last_run_date.as_deref(), Some(day(0).as_str()));
    let sale = s.sale(after.last_sale_uid.as_deref().unwrap()).unwrap();
    assert_eq!(sale.summary.commercial_state, "efectuada");
    assert_eq!(sale.summary.due_date.as_deref(), Some(day(10).as_str()));
    assert_eq!(sale.summary.total_minor, 40_000);
    assert!(
        sale.notes
            .as_deref()
            .unwrap()
            .starts_with("Monitoreo mensual · ")
    );

    let sent = fake.sent.borrow();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].draft.to, "pagos@clinicasur.cl");
    assert!(sent[0].draft.subject.starts_with("Monitoreo mensual — "));
    assert!(
        sent[0].draft.body.contains("Total a pagar: $40.000")
            && sent[0].draft.body.contains(&sale.summary.number),
        "{}",
        sent[0].draft.body
    );
    drop(sent);
    // No se duplica en la siguiente vuelta.
    assert!(run_due(&mut s, &fake).unwrap().is_empty());
    assert_eq!(fake.sent.borrow().len(), 1);

    // Con fecha de término: después del último cobro queda inactivo.
    let last = s
        .save_recurring_sale(
            &RecurringSaleInput {
                name: "Arriendo de equipo".into(),
                next_date: day(0),
                end_date: Some(day(3)),
                send_mail: false,
                confirm: false,
                ..input.clone()
            },
            None,
        )
        .unwrap();
    let done = run_due(&mut s, &fake).unwrap();
    assert_eq!(done[0].sent, 0);
    let all = s.recurring_sales().unwrap();
    let ended = all.iter().find(|x| x.uid == last.uid).unwrap();
    assert!(!ended.active && ended.runs == 1);
    // Sin confirmar: la venta queda en borrador y no sale correo.
    let draft = s.sale(ended.last_sale_uid.as_deref().unwrap()).unwrap();
    assert_eq!(draft.summary.commercial_state, "borrador");
    assert_eq!(fake.sent.borrow().len(), 1);

    // Generar ahora y eliminar.
    let run = s.recurring_run_one(&r.uid).unwrap();
    assert_eq!((run.created, run.mails.len()), (1, 1));
    s.delete_recurring_sale(&r.uid).unwrap();
    assert_eq!(s.recurring_sales().unwrap().len(), 1);
}
