//! WhatsApp por el puente local: conexión (la llave no vuelve a la interfaz), lectura de chats sin
//! grupos ni números excluidos, y envío con cotización adjunta solo con el permiso del dueño.

use nucleo_app::quote_doc_ops::QuoteDocSettings;
use nucleo_app::sales_ops::{LineInput, QuoteInput};
use nucleo_app::wsp_ops::{self, WspDraft, WspHttp, WspLink, WspSetup};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use serde_json::{Value, json};
use std::cell::RefCell;

const KEY: &str = "nwsp_llave-de-prueba-0123456789";

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

/// Puente de mentira: responde como `integraciones/whatsapp` y anota lo que se le pide.
#[derive(Default)]
struct Fake {
    gets: RefCell<Vec<String>>,
    posts: RefCell<Vec<Value>>,
    estado: &'static str,
}
impl WspHttp for Fake {
    fn get(&self, link: &WspLink, path: &str) -> Result<Value, String> {
        assert_eq!(link.key, KEY);
        self.gets.borrow_mut().push(path.to_string());
        if path == "/estado" {
            return Ok(
                json!({ "puente": "nucleo-whatsapp", "version": 1, "estado": self.estado, "numero": "56981875679", "nombre": "Data Logger", "qr": if self.estado == "qr" { json!("data:image/png;base64,AAAA") } else { Value::Null } }),
            );
        }
        if path.starts_with("/chats?") {
            return Ok(json!({ "chats": [
                { "id": "56911111111@c.us", "nombre": "Laboratorio Alfa", "telefono": "56911111111", "no_leidos": 2, "grupo": false, "ultimo": { "texto": "¿Tienen stock?", "de_mi": false, "fecha": "2026-11-25T14:00:00.000Z" } },
                { "id": "1203@g.us", "nombre": "Familia", "telefono": null, "no_leidos": 9, "grupo": true, "ultimo": null },
                { "id": "56977777777@c.us", "nombre": "Mamá", "telefono": "56977777777", "no_leidos": 1, "grupo": false, "ultimo": null },
                { "id": "99@lid", "nombre": "Clínica Sur", "telefono": "56922222222", "no_leidos": 0, "grupo": false, "ultimo": null },
            ] }));
        }
        if path.starts_with("/chats/56977777777%40c.us/") {
            return Ok(
                json!({ "chat": { "id": "56977777777@c.us", "nombre": "Mamá", "telefono": "56977777777", "grupo": false }, "mensajes": [{ "id": "x", "de_mi": false, "texto": "privado", "tipo": "chat" }] }),
            );
        }
        Ok(
            json!({ "chat": { "id": "56911111111@c.us", "nombre": "Laboratorio Alfa", "telefono": "56911111111", "no_leidos": 2, "grupo": false },
            "mensajes": [{ "id": "m1", "de_mi": false, "texto": "¿Tienen stock del RC-5+?", "tipo": "chat", "fecha": "2026-11-25T14:00:00.000Z", "adjunto": false }] }),
        )
    }
    fn post(&self, _link: &WspLink, path: &str, body: &Value) -> Result<Value, String> {
        assert_eq!(path, "/enviar");
        self.posts.borrow_mut().push(body.clone());
        Ok(json!({ "id": "env", "chat": "56911111111@c.us" }))
    }
}

fn setup() -> WspSetup {
    WspSetup {
        url: "http://127.0.0.1:47620/".into(),
        key: KEY.into(),
        agent_send: false,
        ignore: vec!["+56 9 7777 7777".into()],
    }
}

#[test]
fn conexion_solo_local_y_sin_mostrar_la_llave() {
    let (_d, _a, mut s) = session();
    assert!(!s.wsp_status().unwrap().configured);
    assert!(
        s.wsp_link()
            .unwrap_err()
            .to_string()
            .contains("no está conectado")
    );
    for bad in [
        "https://puente.ejemplo.cl",
        "http://192.168.1.20:47620",
        "127.0.0.1:47620",
        "http://127.0.0.1",
        "http://localhost:puerto",
    ] {
        let e = s
            .wsp_save(&WspSetup {
                url: bad.into(),
                ..setup()
            })
            .unwrap_err()
            .to_string();
        assert!(e.contains("este computador"), "{bad}: {e}");
    }
    assert!(
        s.wsp_save(&WspSetup {
            key: "corta".into(),
            ..setup()
        })
        .is_err()
    );
    assert!(
        s.wsp_save(&WspSetup {
            ignore: vec!["123".into()],
            ..setup()
        })
        .is_err()
    );
    let st = s.wsp_save(&setup()).unwrap();
    assert_eq!(
        (st.url.as_str(), st.has_key, st.agent_send),
        ("http://127.0.0.1:47620", true, false)
    );
    assert_eq!(st.ignore, vec!["56977777777"]);
    assert!(!serde_json::to_string(&st).unwrap().contains(KEY));
    // Guardar sin escribir la llave conserva la anterior.
    s.wsp_save(&WspSetup {
        key: String::new(),
        ..setup()
    })
    .unwrap();
    assert_eq!(s.wsp_link().unwrap().key, KEY);
}

#[test]
fn lee_chats_sin_grupos_ni_numeros_excluidos() {
    let (_d, _a, mut s) = session();
    s.wsp_save(&setup()).unwrap();
    let link = s.wsp_link().unwrap();
    let qr = Fake {
        estado: "qr",
        ..Default::default()
    };
    let st = wsp_ops::state(&qr, &link).unwrap();
    assert_eq!(st.estado, "qr");
    assert!(st.qr.unwrap().starts_with("data:image/png"));

    let fake = Fake {
        estado: "listo",
        ..Default::default()
    };
    let chats = wsp_ops::chats(&fake, &link, 30, false).unwrap();
    let names: Vec<_> = chats.iter().map(|c| c.nombre.clone().unwrap()).collect();
    assert_eq!(names, vec!["Laboratorio Alfa", "Clínica Sur"]);
    assert_eq!(chats[0].ultimo.as_ref().unwrap().texto, "¿Tienen stock?");

    let c = wsp_ops::conversation(&fake, &link, "56911111111@c.us", 20).unwrap();
    assert_eq!(c.mensajes[0].texto, "¿Tienen stock del RC-5+?");
    assert!(
        fake.gets
            .borrow()
            .iter()
            .any(|p| p == "/chats/56911111111%40c.us/mensajes?limite=20")
    );
    // Un número excluido no se puede abrir aunque se conozca su id.
    let e = wsp_ops::conversation(&fake, &link, "56977777777@c.us", 20).unwrap_err();
    assert!(e.contains("fuera de lo que NÚCLEO puede ver"), "{e}");
}

#[test]
fn envia_con_cotizacion_solo_con_permiso() {
    let (data, _a, mut s) = session();
    s.wsp_save(&setup()).unwrap();
    let folder = data.path().join("Cotizaciones");
    s.save_quote_doc_settings(&QuoteDocSettings {
        folder: Some(folder.to_string_lossy().to_string()),
        ..Default::default()
    })
    .unwrap();
    let q = s
        .save_quote(
            &QuoteInput {
                customer_uid: None,
                prospect_name: Some("Laboratorio Alfa".into()),
                issue_date: "2026-11-25".into(),
                valid_until: None,
                lines: vec![LineInput {
                    product_uid: None,
                    description: "RC-5+ con sonda".into(),
                    qty_milli: 1000,
                    unit_price_minor: 23_445,
                    discount_ppm: 0,
                    taxable: true,
                    detail: None,
                }],
                notes: None,
            },
            None,
        )
        .unwrap();
    let uid = q.summary.uid.clone();
    let number = q.summary.number.clone();
    let draft = WspDraft {
        chat: "56911111111@c.us".into(),
        texto: " Sí, tenemos stock. Le adjunto la cotización. ".into(),
        quote_uids: vec![uid.clone()],
        ..Default::default()
    };
    assert!(
        s.wsp_plan(&draft)
            .unwrap_err()
            .to_string()
            .contains("emítela primero")
    );
    s.save_quote_pdf(
        &uid,
        &data_encoding::BASE64.encode(b"%PDF-1.3\n% cotizacion\n%%EOF\n"),
    )
    .unwrap();

    // Lo que no se puede: sin destino, grupos, números excluidos, texto vacío.
    for bad in [
        WspDraft {
            texto: "hola".into(),
            ..Default::default()
        },
        WspDraft {
            chat: "1203@g.us".into(),
            texto: "hola".into(),
            ..Default::default()
        },
        WspDraft {
            telefono: "+56 9 7777 7777".into(),
            texto: "hola".into(),
            ..Default::default()
        },
        WspDraft {
            chat: "56977777777@c.us".into(),
            texto: "hola".into(),
            ..Default::default()
        },
        WspDraft {
            telefono: "12".into(),
            texto: "hola".into(),
            ..Default::default()
        },
        WspDraft {
            chat: "56911111111@c.us".into(),
            texto: "  ".into(),
            ..Default::default()
        },
    ] {
        assert!(s.wsp_plan(&bad).is_err(), "{bad:?}");
    }

    // La persona envía: sale el texto y después el PDF, al mismo chat.
    let m = s.wsp_plan(&draft).unwrap();
    assert_eq!(m.reference, number);
    let fake = Fake {
        estado: "listo",
        ..Default::default()
    };
    let r = wsp_ops::send(&fake, &m);
    s.wsp_record(&m, &r).unwrap();
    let sent = r.unwrap();
    assert_eq!((sent.mensajes, sent.chat.as_str()), (2, "56911111111@c.us"));
    let posts = fake.posts.borrow();
    assert_eq!(
        posts[0]["texto"],
        "Sí, tenemos stock. Le adjunto la cotización."
    );
    assert_eq!(
        posts[1]["archivo"]["nombre"],
        format!("{number} Laboratorio Alfa.pdf")
    );
    assert!(
        posts[1]["archivo"]["base64"]
            .as_str()
            .unwrap()
            .starts_with("JVBERi0")
    );
    assert!(
        s.audit_log("", None)
            .unwrap()
            .iter()
            .any(|a| a.entity == "whatsapp")
    );

    // Claude: sin el permiso no envía, y no puede dárselo ni tocar los números excluidos.
    s.set_via_agent(true);
    assert!(
        s.wsp_plan(&draft)
            .unwrap_err()
            .to_string()
            .contains("no tiene permiso")
    );
    assert!(
        s.wsp_save(&WspSetup {
            agent_send: true,
            key: String::new(),
            ..setup()
        })
        .is_err()
    );
    assert!(
        s.wsp_save(&WspSetup {
            ignore: vec![],
            key: String::new(),
            ..setup()
        })
        .is_err()
    );
    assert!(s.wsp_disconnect().is_err());
    s.set_via_agent(false);
    let st = s
        .wsp_save(&WspSetup {
            agent_send: true,
            key: String::new(),
            ..setup()
        })
        .unwrap();
    assert!(st.agent_send);
    s.set_via_agent(true);
    let m = s
        .wsp_plan(&WspDraft {
            telefono: "+56 9 2222 2222".into(),
            texto: "Hola".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!((m.chat.as_str(), m.telefono.as_str()), ("", "56922222222"));
    s.set_via_agent(false);
}

/// Contra el servidor real del puente (con WhatsApp simulado), por HTTP. Solo si NUCLEO_WSP_TEST=1 y
/// está corriendo `node integraciones/whatsapp/test/puente-simulado.mjs 47622` con la misma llave.
#[test]
fn contra_el_puente_por_http() {
    if std::env::var("NUCLEO_WSP_TEST").is_err() {
        return;
    }
    use nucleo_app::wsp_ops::{UreqBridge, WspFile, WspOutgoing};
    let http = UreqBridge::default();
    let link = WspLink {
        url: "http://127.0.0.1:47622".into(),
        key: KEY.into(),
        ignore: vec!["56922222222".into()],
    };
    assert_eq!(wsp_ops::state(&http, &link).unwrap().estado, "listo");
    let chats = wsp_ops::chats(&http, &link, 10, false).unwrap();
    assert_eq!(chats.len(), 1, "el número excluido no aparece");
    let out = WspOutgoing {
        link: link.clone(),
        chat: String::new(),
        telefono: "56911111111".into(),
        texto: "Sí, tenemos stock: ñandú.".into(),
        files: vec![WspFile {
            name: "COT-1529 Alfa.pdf".into(),
            data: b"%PDF-1.3\n".to_vec(),
        }],
        reference: "COT-1529".into(),
    };
    let sent = wsp_ops::send(&http, &out).unwrap();
    assert_eq!((sent.mensajes, sent.chat.as_str()), (2, "56911111111@c.us"));
    let c = wsp_ops::conversation(&http, &link, &chats[0].id, 20).unwrap();
    assert!(
        c.mensajes
            .iter()
            .any(|m| m.de_mi && m.texto.contains("ñandú"))
    );
    assert!(c.mensajes.iter().any(|m| m.adjunto));
    // Llave equivocada y puente apagado: mensajes claros.
    let bad = WspLink {
        key: "otra-llave-de-prueba-0123456789".into(),
        ..link.clone()
    };
    assert!(
        wsp_ops::state(&http, &bad)
            .unwrap_err()
            .contains("rechazó la llave")
    );
    let off = WspLink {
        url: "http://127.0.0.1:1".into(),
        ..link
    };
    assert!(
        wsp_ops::state(&http, &off)
            .unwrap_err()
            .contains("no se pudo hablar")
    );
}
