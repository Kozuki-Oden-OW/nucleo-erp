//! Facturación electrónica propia: configuración, certificado y folios en la base cifrada, timbre con
//! control de folios y conversación con el SII (simulado). Certificado y CAF se generan aquí.

use data_encoding::BASE64;
use nucleo_app::core_ops::BusinessPatch;
use nucleo_app::sii_ops::{self, SiiEmisor, SiiHttp, SiiIssueInput, SiiSetup};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use nucleo_dte::sii::Ambiente;
use nucleo_dte::{Detalle, Receptor, Referencia};
use openssl::asn1::Asn1Time;
use openssl::bn::BigNum;
use openssl::hash::MessageDigest;
use openssl::pkcs12::Pkcs12;
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::x509::{X509, X509NameBuilder};
use std::cell::RefCell;

const RUT: &str = "76000000-0";

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    // Tasa de EJEMPLO anotada por el usuario (no es un valor normativo del código).
    s.update_business(&BusinessPatch {
        tax_rate_user_ppm: Some(190_000),
        rut: Some("76.000.000-0".into()),
        legal_name: Some("DATA LOGGER DE PRUEBA SPA".into()),
        address: Some("Av. Prueba 100".into()),
        ..Default::default()
    })
    .unwrap();
    (data, app, s)
}

fn pfx() -> Vec<u8> {
    let key = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
    let mut name = X509NameBuilder::new().unwrap();
    name.append_entry_by_text("CN", "PERSONA DE PRUEBA")
        .unwrap();
    name.append_entry_by_text("serialNumber", "11.111.111-1")
        .unwrap();
    let name = name.build();
    let mut b = X509::builder().unwrap();
    b.set_version(2).unwrap();
    b.set_serial_number(&BigNum::from_u32(7).unwrap().to_asn1_integer().unwrap())
        .unwrap();
    b.set_subject_name(&name).unwrap();
    b.set_issuer_name(&name).unwrap();
    b.set_pubkey(&key).unwrap();
    b.set_not_before(&Asn1Time::days_from_now(0).unwrap())
        .unwrap();
    b.set_not_after(&Asn1Time::days_from_now(365).unwrap())
        .unwrap();
    b.sign(&key, MessageDigest::sha256()).unwrap();
    Pkcs12::builder()
        .name("p")
        .pkey(&key)
        .cert(&b.build())
        .build2("clave")
        .unwrap()
        .to_der()
        .unwrap()
}

fn caf(rut: &str, tipo: u16, desde: u64, hasta: u64) -> Vec<u8> {
    let rsa = Rsa::generate(1024).unwrap();
    format!(
        "<?xml version=\"1.0\"?>\n<AUTORIZACION><CAF version=\"1.0\"><DA><RE>{rut}</RE><RS>DATA LOGGER</RS><TD>{tipo}</TD><RNG><D>{desde}</D><H>{hasta}</H></RNG><FA>2026-11-22</FA><RSAPK><M>{}</M><E>{}</E></RSAPK><IDK>100</IDK></DA><FRMA algoritmo=\"SHA1withRSA\">ZmFsc2E=</FRMA></CAF><RSASK>{}</RSASK></AUTORIZACION>",
        BASE64.encode(&rsa.n().to_vec()),
        BASE64.encode(&rsa.e().to_vec()),
        String::from_utf8(rsa.private_key_to_pem().unwrap()).unwrap()
    )
    .into_bytes()
}

fn setup(s: &mut CompanySession) {
    s.sii_save_setup(&SiiSetup {
        ambiente: Ambiente::Certificacion,
        emisor: SiiEmisor {
            giro: "Venta de instrumentos de medición".into(),
            actecos: vec![465000],
            comuna: "Santiago".into(),
            ciudad: "Santiago".into(),
            ..Default::default()
        },
        resolucion_fecha: Some("2026-11-22".into()),
        resolucion_numero: Some(0),
    })
    .unwrap();
}

fn factura() -> SiiIssueInput {
    SiiIssueInput {
        tipo: 33,
        fecha: Some("2026-11-22".into()),
        receptor: Receptor {
            rut: "77.777.777-7".into(),
            razon_social: "Cliente de Prueba Ltda.".into(),
            giro: Some("Laboratorio".into()),
            direccion: Some("Calle 1".into()),
            comuna: Some("Ñuñoa".into()),
            ..Default::default()
        },
        detalle: vec![Detalle {
            nombre: "Registrador RC-5".into(),
            cantidad_milli: Some(2000),
            precio: Some(10_000),
            monto: 20_000,
            ..Default::default()
        }],
        referencias: vec![Referencia {
            tipo: "SET".into(),
            folio: "1".into(),
            fecha: "2026-11-22".into(),
            codigo: None,
            razon: Some("CASO 1".into()),
        }],
        descuentos_globales: vec![],
        forma_pago: Some(1),
        vencimiento: None,
        ind_traslado: None,
        tipo_despacho: None,
        sale_uid: None,
    }
}

/// SII de mentira: responde semilla, token, subida y estado; guarda lo que recibe.
#[derive(Default)]
struct FakeSii {
    calls: RefCell<Vec<String>>,
    uploaded: RefCell<Vec<u8>>,
    estado: RefCell<String>,
}

impl SiiHttp for FakeSii {
    fn post(
        &self,
        url: &str,
        ct: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Result<String, String> {
        self.calls.borrow_mut().push(url.to_string());
        assert!(
            url.starts_with("https://maullin.sii.cl/"),
            "certificación va a maullin: {url}"
        );
        let text = String::from_utf8_lossy(body).to_string();
        if url.ends_with("CrSeed.jws") {
            assert!(text.contains("<getSeed>"));
            return Ok("<SOAP><getSeedReturn>&lt;SII:RESPUESTA&gt;&lt;SII:RESP_BODY&gt;&lt;SEMILLA&gt;000123456789&lt;/SEMILLA&gt;&lt;/SII:RESP_BODY&gt;&lt;SII:RESP_HDR&gt;&lt;ESTADO&gt;00&lt;/ESTADO&gt;&lt;/SII:RESP_HDR&gt;&lt;/SII:RESPUESTA&gt;</getSeedReturn></SOAP>".into());
        }
        if url.ends_with("GetTokenFromSeed.jws") {
            assert!(text.contains("000123456789") && text.contains("SignatureValue"));
            return Ok("<SOAP>&lt;SII:RESPUESTA&gt;&lt;SII:RESP_BODY&gt;&lt;TOKEN&gt;TOK42&lt;/TOKEN&gt;&lt;/SII:RESP_BODY&gt;&lt;SII:RESP_HDR&gt;&lt;ESTADO&gt;00&lt;/ESTADO&gt;&lt;/SII:RESP_HDR&gt;&lt;/SII:RESPUESTA&gt;</SOAP>".into());
        }
        if url.ends_with("DTEUpload") {
            assert!(ct.starts_with("multipart/form-data; boundary="));
            assert!(
                headers
                    .iter()
                    .any(|(k, v)| *k == "Cookie" && *v == "TOKEN=TOK42")
            );
            assert!(
                text.contains("name=\"rutSender\"\r\n\r\n11111111")
                    && text.contains("name=\"rutCompany\"\r\n\r\n76000000")
            );
            *self.uploaded.borrow_mut() = body.to_vec();
            return Ok(
                "<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>9001</TRACKID></RECEPCIONDTE>".into(),
            );
        }
        if url.ends_with("QueryEstUp.jws") {
            assert!(text.contains("9001") && text.contains("TOK42"));
            return Ok(self.estado.borrow().clone());
        }
        Err(format!("URL inesperada {url}"))
    }
}

#[test]
fn configuracion_y_faltantes() {
    let (_d, _a, mut s) = session();
    let st = s.sii_status().unwrap();
    assert!(st.faltantes.iter().any(|f| f.contains("certificado")));
    assert!(st.faltantes.iter().any(|f| f.contains("folios")));
    setup(&mut s);
    // Clave equivocada: no se guarda nada.
    assert!(
        s.sii_load_certificate(&pfx(), "otra")
            .unwrap_err()
            .to_string()
            .contains("clave")
    );
    let st = s.sii_load_certificate(&pfx(), "clave").unwrap();
    let cert = st.certificado.unwrap();
    assert_eq!(cert.rut.as_deref(), Some("11111111-1"));
    assert_eq!(cert.nombre.as_deref(), Some("PERSONA DE PRUEBA"));
    // Folios de otra empresa: no.
    assert!(
        s.sii_load_caf(&caf("77777777-7", 33, 1, 10))
            .unwrap_err()
            .to_string()
            .contains("otra empresa")
    );
    let st = s.sii_load_caf(&caf(RUT, 33, 1, 3)).unwrap();
    assert!(st.faltantes.is_empty(), "{:?}", st.faltantes);
    assert_eq!(st.folios[0].restantes, 3);
    // El mismo rango dos veces: no.
    assert!(s.sii_load_caf(&caf(RUT, 33, 2, 5)).is_err());
    // Producción sin resolución: no.
    let mut bad = SiiSetup {
        ambiente: Ambiente::Produccion,
        emisor: st.emisor.clone(),
        resolucion_fecha: None,
        resolucion_numero: None,
    };
    assert!(s.sii_save_setup(&bad).is_err());
    bad.resolucion_fecha = Some("22-11-2026".into());
    bad.ambiente = Ambiente::Certificacion;
    assert!(s.sii_save_setup(&bad).is_err());
}

#[test]
fn emite_envia_y_consulta() {
    let (_d, _a, mut s) = session();
    setup(&mut s);
    s.sii_load_certificate(&pfx(), "clave").unwrap();
    s.sii_load_caf(&caf(RUT, 33, 1, 2)).unwrap();

    let d1 = s.sii_issue(&factura()).unwrap();
    assert_eq!(
        (d1.folio, d1.total_minor, d1.estado.as_str()),
        (1, 23_800, "firmado")
    );
    assert_eq!(d1.receptor_rut, "77777777-7");
    let d2 = s.sii_issue(&factura()).unwrap();
    assert_eq!(d2.folio, 2);
    // Sin folios: error y ningún documento nuevo.
    assert!(
        s.sii_issue(&factura())
            .unwrap_err()
            .to_string()
            .contains("no quedan folios")
    );
    assert_eq!(s.sii_documents(None).unwrap().len(), 2);
    // Un documento inválido no consume folio.
    s.sii_load_caf(&caf(RUT, 33, 3, 3)).unwrap();
    let mut mala = factura();
    mala.receptor.giro = None;
    assert!(s.sii_issue(&mala).is_err());
    assert_eq!(s.sii_issue(&factura()).unwrap().folio, 3);

    let xml = s.sii_document_xml(d1.id).unwrap();
    assert!(xml.starts_with(b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>"));

    let fake = FakeSii::default();
    let plan = s.sii_send_plan(&[d1.id, d2.id]).unwrap();
    let track = sii_ops::send(&fake, &plan).unwrap();
    assert_eq!(track, "9001");
    let up = String::from_utf8_lossy(&fake.uploaded.borrow()).to_string();
    assert!(
        up.contains("<EnvioDTE")
            && up.contains("<NroDTE>2</NroDTE>")
            && up.contains("<RutEnvia>11111111-1</RutEnvia>")
    );
    let docs = s.sii_send_apply(&plan, &track).unwrap();
    assert!(
        docs.iter()
            .all(|d| d.estado == "enviado" && d.track_id.as_deref() == Some("9001"))
    );
    // Ya enviado: no se reenvía.
    assert!(s.sii_send_plan(&[d1.id]).is_err());

    // Estado: primero en proceso, luego aceptado.
    *fake.estado.borrow_mut() =
        "<SII:RESP_HDR><ESTADO>SOK</ESTADO><GLOSA>Schema Validado</GLOSA></SII:RESP_HDR>".into();
    let (cred, t) = s.sii_status_plan(d1.id).unwrap();
    let e = sii_ops::check(&fake, &cred, &t).unwrap();
    assert!(e.pendiente);
    s.sii_status_apply(&t, &e).unwrap();
    *fake.estado.borrow_mut() = "<SII:RESP_HDR><ESTADO>EPR</ESTADO><GLOSA>Envio Procesado</GLOSA></SII:RESP_HDR><SII:RESP_BODY><ACEPTADOS>2</ACEPTADOS><RECHAZADOS>0</RECHAZADOS><REPAROS>0</REPAROS></SII:RESP_BODY>".into();
    let e = sii_ops::check(&fake, &cred, &t).unwrap();
    let docs = s.sii_status_apply(&t, &e).unwrap();
    assert_eq!(docs.len(), 2);
    assert!(docs.iter().all(|d| d.estado == "aceptado"));
}
