//! Arma una factura, una nota de crédito y el sobre de envío con un certificado y un CAF de prueba
//! (generados aquí) y verifica el timbre y las firmas leyendo de vuelta el XML escrito.

use data_encoding::BASE64;
use nucleo_dte::crypto::verify_sha1_pem;
use nucleo_dte::dte::dte_scope;
use nucleo_dte::envio::{Caratula, envio_dte};
use nucleo_dte::xml::{El, from_latin1, from_rox, latin1};
use nucleo_dte::{Caf, Certificate, Detalle, Dte, Emisor, Receptor, Referencia, TipoDte};
use openssl::asn1::Asn1Time;
use openssl::bn::BigNum;
use openssl::hash::{MessageDigest, hash};
use openssl::pkcs12::Pkcs12;
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::x509::{X509, X509NameBuilder};
use std::collections::BTreeMap;

const RUT: &str = "76000000-0";

fn certificado() -> (Certificate, Vec<u8>) {
    let key = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
    let mut name = X509NameBuilder::new().unwrap();
    name.append_entry_by_text("CN", "PERSONA DE PRUEBA")
        .unwrap();
    name.append_entry_by_text("serialNumber", "11111111-1")
        .unwrap();
    let name = name.build();
    let mut b = X509::builder().unwrap();
    b.set_version(2).unwrap();
    b.set_serial_number(&BigNum::from_u32(1).unwrap().to_asn1_integer().unwrap())
        .unwrap();
    b.set_subject_name(&name).unwrap();
    b.set_issuer_name(&name).unwrap();
    b.set_pubkey(&key).unwrap();
    b.set_not_before(&Asn1Time::days_from_now(0).unwrap())
        .unwrap();
    b.set_not_after(&Asn1Time::days_from_now(365).unwrap())
        .unwrap();
    b.sign(&key, MessageDigest::sha256()).unwrap();
    let cert = b.build();
    let p12 = Pkcs12::builder()
        .name("prueba")
        .pkey(&key)
        .cert(&cert)
        .build2("clave-prueba")
        .unwrap();
    let der = p12.to_der().unwrap();
    (
        Certificate::from_pkcs12(&der, "clave-prueba").unwrap(),
        cert.public_key().unwrap().public_key_to_pem().unwrap(),
    )
}

/// CAF con la misma estructura que entrega el SII (la firma FRMA del SII es ficticia).
fn caf(tipo: u16, desde: u64, hasta: u64) -> (Caf, Vec<u8>) {
    let rsa = Rsa::generate(1024).unwrap();
    let sk = String::from_utf8(rsa.private_key_to_pem().unwrap()).unwrap();
    let pk = rsa.public_key_to_pem().unwrap();
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<AUTORIZACION><CAF version=\"1.0\"><DA><RE>{RUT}</RE><RS>EMPRESA DE PRUEBA SPA</RS><TD>{tipo}</TD><RNG><D>{desde}</D><H>{hasta}</H></RNG><FA>2026-11-22</FA><RSAPK><M>{}</M><E>{}</E></RSAPK><IDK>100</IDK></DA><FRMA algoritmo=\"SHA1withRSA\">ZmFsc2E=</FRMA></CAF><RSASK>{sk}</RSASK><RSAPUBK>{}</RSAPUBK></AUTORIZACION>",
        BASE64.encode(&rsa.n().to_vec()),
        BASE64.encode(&rsa.e().to_vec()),
        String::from_utf8_lossy(&pk)
    );
    (Caf::parse(xml.as_bytes()).unwrap(), pk)
}

fn emisor() -> Emisor {
    Emisor {
        rut: RUT.into(),
        razon_social: "EMPRESA DE PRUEBA SPA".into(),
        giro: "VENTA DE INSTRUMENTOS DE MEDICIÓN".into(),
        actecos: vec![465000],
        direccion: "Av. Siempre Viva 123".into(),
        comuna: "Ñuñoa".into(),
        ciudad: Some("Santiago".into()),
        ..Default::default()
    }
}

fn receptor() -> Receptor {
    Receptor {
        rut: "77777777-7".into(),
        razon_social: "CLIENTE & ASOCIADOS LTDA.".into(),
        giro: Some("Laboratorio".into()),
        direccion: Some("Calle Uno 45".into()),
        comuna: Some("Providencia".into()),
        ciudad: Some("Santiago".into()),
        ..Default::default()
    }
}

fn factura(folio: u64) -> Dte {
    Dte {
        tipo: TipoDte::Factura,
        folio,
        fecha: "2026-11-22".into(),
        forma_pago: Some(2),
        vencimiento: Some("2026-12-22".into()),
        ind_traslado: None,
        tipo_despacho: None,
        emisor: emisor(),
        receptor: receptor(),
        detalle: vec![
            Detalle {
                codigo: Some("RC-5".into()),
                nombre: "Registrador de temperatura RC-5".into(),
                cantidad_milli: Some(3000),
                unidad: Some("UN".into()),
                precio: Some(25_000),
                monto: 75_000,
                ..Default::default()
            },
            Detalle {
                nombre: "Certificado de calibración".into(),
                cantidad_milli: Some(1000),
                precio: Some(19_990),
                monto: 19_990,
                ..Default::default()
            },
        ],
        referencias: vec![],
        tasa_iva_ppm: 190_000,
    }
}

fn digest_b64(el: &El, scope: &BTreeMap<String, String>) -> String {
    BASE64.encode(&hash(MessageDigest::sha1(), el.canonical(scope).as_bytes()).unwrap())
}

fn parse_doc(bytes: &[u8]) -> El {
    let text = from_latin1(bytes);
    let body = &text[text.find("?>").unwrap() + 2..];
    let doc = roxmltree::Document::parse(body).unwrap();
    from_rox(doc.root_element())
}

/// Verifica la firma XML que es hija de `parent` y referencia a `signed` (leído del XML escrito).
fn check_signature(parent: &El, signed: &El, scope: &BTreeMap<String, String>, pub_pem: &[u8]) {
    let sig = parent.find("Signature").expect("sin firma");
    let si = sig.find("SignedInfo").unwrap();
    let dv = si
        .find("Reference")
        .unwrap()
        .find("DigestValue")
        .unwrap()
        .text_content();
    assert_eq!(
        dv,
        digest_b64(signed, scope),
        "el digest no coincide con lo firmado"
    );
    let mut si_scope = scope.clone();
    si_scope.insert(String::new(), "http://www.w3.org/2000/09/xmldsig#".into());
    let value = BASE64
        .decode(
            sig.find("SignatureValue")
                .unwrap()
                .text_content()
                .as_bytes(),
        )
        .unwrap();
    assert!(
        verify_sha1_pem(pub_pem, si.canonical(&si_scope).as_bytes(), &value).unwrap(),
        "firma no válida"
    );
}

#[test]
fn factura_timbrada_y_firmada() {
    let (cert, cert_pub) = certificado();
    let (caf, caf_pub) = caf(33, 1, 100);
    let d = factura(7);
    let t = d.totales();
    assert_eq!((t.neto, t.iva, t.total), (94_990, 18_048, 113_038));
    let signed = d.sign(&caf, &cert, "2026-11-22T10:15:00").unwrap();
    let bytes = signed.to_document();
    assert!(bytes.starts_with(b"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>"));
    assert!(bytes.contains(&0xD1), "la Ñ va en ISO-8859-1");

    // Leído de vuelta desde el archivo, como lo leería el SII.
    let dte = parse_doc(&bytes);
    assert_eq!(dte.name, "DTE");
    let doc = dte.find("Documento").unwrap();
    assert_eq!(doc.attrs[0], ("ID".to_string(), "F7T33".to_string()));
    let tot = doc.find("Encabezado").unwrap().find("Totales").unwrap();
    assert_eq!(tot.find("MntTotal").unwrap().text_content(), "113038");
    assert_eq!(tot.find("TasaIVA").unwrap().text_content(), "19");

    // Timbre: FRMT = RSA-SHA1 del DD aplanado en ISO-8859-1, con la llave del CAF.
    let ted = doc.find("TED").unwrap();
    let dd = ted.find("DD").unwrap();
    assert_eq!(
        dd.find("RSR").unwrap().text_content(),
        "CLIENTE & ASOCIADOS LTDA."
    );
    let frmt = BASE64
        .decode(ted.find("FRMT").unwrap().text_content().as_bytes())
        .unwrap();
    assert!(
        verify_sha1_pem(&caf_pub, &latin1(&dd.to_xml()), &frmt).unwrap(),
        "timbre no válido"
    );

    check_signature(&dte, doc, &dte_scope(), &cert_pub);
    assert_eq!(signed.ted_latin1(), latin1(&ted.to_xml()));

    std::fs::create_dir_all(concat!(env!("CARGO_TARGET_TMPDIR"), "/dte")).unwrap();
    std::fs::write(
        concat!(env!("CARGO_TARGET_TMPDIR"), "/dte/factura.xml"),
        &bytes,
    )
    .unwrap();
}

#[test]
fn envio_con_factura_y_nota_de_credito() {
    let (cert, cert_pub) = certificado();
    let (caf33, _) = caf(33, 1, 100);
    let (caf61, _) = caf(61, 1, 50);
    let f = factura(8)
        .sign(&caf33, &cert, "2026-11-22T10:16:00")
        .unwrap();
    let mut nc = factura(3);
    nc.tipo = TipoDte::NotaCredito;
    nc.forma_pago = None;
    nc.vencimiento = None;
    nc.detalle.truncate(1);
    nc.referencias.push(Referencia {
        tipo: "33".into(),
        folio: "8".into(),
        fecha: "2026-11-22".into(),
        codigo: Some(1),
        razon: Some("Anula factura".into()),
    });
    let nc = nc.sign(&caf61, &cert, "2026-11-22T10:17:00").unwrap();
    let car = Caratula::al_sii(RUT, "11111111-1", "2026-11-22", 0);
    let bytes = envio_dte(&car, &[f, nc], &cert, "2026-11-22T10:18:00").unwrap();

    let env = parse_doc(&bytes);
    let set = env.find("SetDTE").unwrap();
    let car = set.find("Caratula").unwrap();
    assert_eq!(
        car.find("RutReceptor").unwrap().text_content(),
        "60803000-K"
    );
    let subtot: Vec<_> = car
        .kids
        .iter()
        .filter_map(|k| match k {
            nucleo_dte::xml::Node::El(e) if e.name == "SubTotDTE" => {
                Some(e.find("TpoDTE").unwrap().text_content())
            }
            _ => None,
        })
        .collect();
    assert_eq!(subtot, ["33", "61"]);
    // Firma del sobre…
    check_signature(&env, set, &dte_scope(), &cert_pub);
    // …y la de cada documento sigue válida dentro del sobre.
    for k in &set.kids {
        if let nucleo_dte::xml::Node::El(e) = k
            && e.name == "DTE"
        {
            check_signature(e, e.find("Documento").unwrap(), &dte_scope(), &cert_pub);
        }
    }
    std::fs::create_dir_all(concat!(env!("CARGO_TARGET_TMPDIR"), "/dte")).unwrap();
    std::fs::write(
        concat!(env!("CARGO_TARGET_TMPDIR"), "/dte/envio.xml"),
        &bytes,
    )
    .unwrap();
}

#[test]
fn validaciones() {
    let (cert, _) = certificado();
    let (caf33, _) = caf(33, 1, 10);
    // Folio fuera del rango del CAF.
    assert!(
        factura(11)
            .sign(&caf33, &cert, "2026-11-22T10:00:00")
            .unwrap_err()
            .to_string()
            .contains("no está en el CAF")
    );
    // CAF de otro tipo.
    let (caf61, _) = caf(61, 1, 10);
    assert!(
        factura(1)
            .sign(&caf61, &cert, "2026-11-22T10:00:00")
            .is_err()
    );
    // Crédito sin vencimiento.
    let mut f = factura(1);
    f.vencimiento = None;
    assert!(
        f.validate()
            .unwrap_err()
            .to_string()
            .contains("vencimiento")
    );
    // Nota de crédito sin referencia.
    let mut nc = factura(1);
    nc.tipo = TipoDte::NotaCredito;
    assert!(nc.validate().is_err());
    // Factura sin datos del receptor.
    let mut f = factura(1);
    f.receptor.giro = None;
    assert!(f.validate().is_err());
    // Clave equivocada del certificado.
    assert!(Certificate::from_pkcs12(b"no es un pfx", "x").is_err());
}

#[test]
fn token_firmado() {
    let (cert, cert_pub) = certificado();
    let xml = nucleo_dte::sii::token_xml("012345678901", &cert).unwrap();
    let body = &xml[xml.find("?>").unwrap() + 2..];
    let doc = roxmltree::Document::parse(body).unwrap();
    let root = from_rox(doc.root_element());
    // Firma envolvente: el digest es del documento sin la firma.
    let mut sin_firma = root.clone();
    sin_firma
        .kids
        .retain(|k| !matches!(k, nucleo_dte::xml::Node::El(e) if e.name == "Signature"));
    check_signature(&root, &sin_firma, &BTreeMap::new(), &cert_pub);
    assert!(nucleo_dte::sii::token_request(&xml).contains("&lt;getToken&gt;"));
}

#[test]
fn guia_y_exenta() {
    let (cert, _) = certificado();
    let (caf52, _) = caf(52, 1, 10);
    let (caf34, _) = caf(34, 1, 10);
    let mut g = factura(1);
    g.tipo = TipoDte::GuiaDespacho;
    g.forma_pago = None;
    g.vencimiento = None;
    g.ind_traslado = Some(1);
    g.tipo_despacho = Some(2);
    let g = g.sign(&caf52, &cert, "2026-11-22T11:00:00").unwrap();
    let mut e = factura(1);
    e.tipo = TipoDte::FacturaExenta;
    let e = e.sign(&caf34, &cert, "2026-11-22T11:01:00").unwrap();
    assert_eq!(
        (e.totales.iva, e.totales.exento, e.totales.total),
        (0, 94_990, 94_990)
    );
    let car = Caratula::al_sii(RUT, "11111111-1", "2026-11-22", 0);
    let bytes = envio_dte(&car, &[g, e], &cert, "2026-11-22T11:02:00").unwrap();
    std::fs::create_dir_all(concat!(env!("CARGO_TARGET_TMPDIR"), "/dte")).unwrap();
    std::fs::write(
        concat!(env!("CARGO_TARGET_TMPDIR"), "/dte/envio_guia_exenta.xml"),
        &bytes,
    )
    .unwrap();
}
