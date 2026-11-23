//! Arma una factura, una nota de crédito y el sobre de envío con un certificado y un CAF de prueba
//! (generados aquí) y verifica el timbre y las firmas leyendo de vuelta el XML escrito.

use data_encoding::BASE64;
use nucleo_dte::crypto::verify_sha1_pem;
use nucleo_dte::dte::dte_scope;
use nucleo_dte::envio::{Caratula, envio_dte};
use nucleo_dte::xml::{El, from_latin1, from_rox, latin1};
use nucleo_dte::{
    Caf, Certificate, DescuentoGlobal, Detalle, Dte, Emisor, Receptor, Referencia, TipoDte,
};
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
        descuentos_globales: vec![],
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
                .replace('\n', "")
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

/// Caso 4 del set básico del SII: dos líneas afectas, una exenta y 7 % de descuento global sobre
/// las afectas (DscRcgGlobal va entre el detalle y las referencias).
#[test]
fn descuento_global_set_basico() {
    let (cert, _) = certificado();
    let (caf33, _) = caf(33, 1, 10);
    let mut f = factura(4);
    let l = |n: &str, q: i64, p: i64, exento: bool| Detalle {
        nombre: n.into(),
        cantidad_milli: Some(q * 1000),
        precio: Some(p),
        monto: q * p,
        exento,
        ..Default::default()
    };
    f.detalle = vec![
        l("ITEM 1 AFECTO", 100, 1910, false),
        l("ITEM 2 AFECTO", 43, 1730, false),
        l("ITEM 3 SERVICIO EXENTO", 2, 6771, true),
    ];
    f.descuentos_globales = vec![DescuentoGlobal {
        glosa: Some("Descuento global ítemes afectos".into()),
        porcentaje: Some(7.0),
        ..Default::default()
    }];
    f.referencias = vec![Referencia {
        tipo: "SET".into(),
        folio: "4".into(),
        fecha: "2026-11-22".into(),
        codigo: None,
        razon: Some("CASO 5198396-4".into()),
    }];
    let s = f.sign(&caf33, &cert, "2026-11-22T12:00:00").unwrap();
    let t = &s.totales;
    assert_eq!(
        (t.neto, t.exento, t.iva, t.total),
        (246_813, 13_542, 46_894, 307_249)
    );
    let xml = from_latin1(&s.to_document()).replace('\n', "");
    let (d, r) = (
        xml.find("<DscRcgGlobal>").unwrap(),
        xml.find("<Referencia>").unwrap(),
    );
    assert!(xml.rfind("</Detalle>").unwrap() < d && d < r);
    assert!(xml.contains("<TpoMov>D</TpoMov><GlosaDR>Descuento global ítemes afectos</GlosaDR><TpoValor>%</TpoValor><ValorDR>7</ValorDR>"));
    assert!(!xml.contains("IndExeDR"));
    let car = Caratula::al_sii(RUT, "11111111-1", "2026-11-22", 0);
    let bytes = envio_dte(&car, &[s], &cert, "2026-11-22T12:01:00").unwrap();
    std::fs::create_dir_all(concat!(env!("CARGO_TARGET_TMPDIR"), "/dte")).unwrap();
    std::fs::write(
        concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/dte/envio_descuento_global.xml"
        ),
        &bytes,
    )
    .unwrap();
}

/// Un .pfx en el formato antiguo (certificado con RC2-40 y llave con 3DES), como los que entregan
/// varios proveedores chilenos o exporta Windows: se lee con la clave correcta y una clave equivocada
/// se informa como tal.
#[test]
fn pfx_formato_antiguo() {
    use openssl::nid::Nid;
    nucleo_dte::crypto::load_legacy();
    let key = PKey::from_rsa(Rsa::generate(2048).unwrap()).unwrap();
    let mut name = X509NameBuilder::new().unwrap();
    name.append_entry_by_text("CN", "PERSONA ANTIGUA").unwrap();
    let name = name.build();
    let mut b = X509::builder().unwrap();
    b.set_version(2).unwrap();
    b.set_serial_number(&BigNum::from_u32(9).unwrap().to_asn1_integer().unwrap())
        .unwrap();
    b.set_subject_name(&name).unwrap();
    b.set_issuer_name(&name).unwrap();
    b.set_pubkey(&key).unwrap();
    b.set_not_before(&Asn1Time::days_from_now(0).unwrap())
        .unwrap();
    b.set_not_after(&Asn1Time::days_from_now(30).unwrap())
        .unwrap();
    b.sign(&key, MessageDigest::sha256()).unwrap();
    let der = Pkcs12::builder()
        .name("antiguo")
        .pkey(&key)
        .cert(&b.build())
        .key_algorithm(Nid::PBE_WITHSHA1AND3_KEY_TRIPLEDES_CBC)
        .cert_algorithm(Nid::PBE_WITHSHA1AND40BITRC2_CBC)
        .mac_md(MessageDigest::sha1())
        .build2("1234")
        .unwrap()
        .to_der()
        .unwrap();
    let c = Certificate::from_pkcs12(&der, "1234").unwrap();
    assert_eq!(c.subject().0.as_deref(), Some("PERSONA ANTIGUA"));
    let e = Certificate::from_pkcs12(&der, "9999")
        .err()
        .unwrap()
        .to_string();
    assert!(e.contains("clave del certificado no es correcta"), "{e}");
}

/// Libro de compras del set de pruebas (atención 5198398 de FAVOR): factura en papel, electrónica
/// con exento, IVA de uso común con factor 0,60, nota de crédito, entrega gratuita (IVA no
/// recuperable código 4), factura de compra con retención total y nota de crédito a electrónica.
#[test]
fn libro_de_compras_set() {
    use nucleo_dte::libro::{CaratulaLibro, LineaLibro, Operacion, libro_cv};
    let (cert, _) = certificado();
    let iva = |n: i64| (n as f64 * 0.19).round() as i64;
    let l = |tipo: u16, folio: u64, rut: &str, exe: i64, neto: i64| LineaLibro {
        tipo,
        folio,
        tasa_iva: Some(19.0),
        fecha: "2026-11-22".into(),
        rut: rut.into(),
        razon_social: format!("Proveedor {rut}"),
        exento: exe,
        neto,
        iva: iva(neto),
        total: exe + neto + iva(neto),
        ..Default::default()
    };
    let mut uso_comun = l(30, 781, "33333333-3", 0, 30_229);
    uso_comun.iva_uso_comun = Some(uso_comun.iva);
    uso_comun.iva = 0;
    let mut gratis = l(33, 67, "55555555-5", 0, 12_457);
    gratis.iva_no_recuperable = Some((4, gratis.iva));
    gratis.iva = 0;
    let mut compra = l(46, 9, "66666666-6", 0, 10_793);
    compra.iva_retenido_total = Some(compra.iva);
    compra.total = compra.neto;
    let mut nc1 = l(60, 451, "11111111-1", 0, 2_960);
    (nc1.tipo_ref, nc1.folio_ref) = (Some(30), Some(234));
    let mut nc2 = l(60, 211, "22222222-2", 0, 9_753);
    (nc2.tipo_ref, nc2.folio_ref) = (Some(33), Some(32));
    let lineas = vec![
        l(30, 234, "11111111-1", 0, 58_129),
        l(33, 32, "22222222-2", 10_906, 12_228),
        uso_comun,
        nc1,
        gratis,
        compra,
        nc2,
    ];
    let car = CaratulaLibro {
        rut_emisor: RUT.into(),
        rut_envia: "11111111-1".into(),
        periodo: "2026-11".into(),
        fecha_resolucion: "2026-11-22".into(),
        numero_resolucion: 0,
        operacion: Operacion::Compra,
        tipo_libro: "ESPECIAL".into(),
        folio_notificacion: Some(5_198_398),
    };
    let bytes = libro_cv(&car, &lineas, Some(0.6), &cert, "2026-11-22T13:00:00").unwrap();
    let xml = from_latin1(&bytes).replace('\n', "");
    assert!(xml.contains("<TotIVAUsoComun>5744</TotIVAUsoComun><FctProp>0.6</FctProp><TotCredIVAUsoComun>3446</TotCredIVAUsoComun>"));
    assert!(xml.contains(
        "<IVANoRec><CodIVANoRec>4</CodIVANoRec><MntIVANoRec>2367</MntIVANoRec></IVANoRec>"
    ));
    std::fs::create_dir_all(concat!(env!("CARGO_TARGET_TMPDIR"), "/dte")).unwrap();
    std::fs::write(
        concat!(env!("CARGO_TARGET_TMPDIR"), "/dte/libro_compras.xml"),
        &bytes,
    )
    .unwrap();
    // Sin factor de proporcionalidad no se puede declarar IVA de uso común.
    assert!(libro_cv(&car, &lineas, None, &cert, "2026-11-22T13:00:00").is_err());
}

/// Set básico del SII completo (4 facturas, 3 notas de crédito y 1 nota de débito) en un solo sobre,
/// con los datos tal como los arma NÚCLEO (notas sin montos, referencias SET y al documento).
#[test]
fn set_basico_completo() {
    let (cert, _) = certificado();
    let (caf33, _) = caf(33, 1, 10);
    let (caf61, _) = caf(61, 1, 10);
    let (caf56, _) = caf(56, 1, 10);
    let mut em = emisor();
    em.giro = "Desarrollo y operación de app marketplace de servicios entre usuarios".into();
    em.actecos = vec![620100];
    let rec = Receptor {
        rut: "77334963-0".into(),
        razon_social: "DATA LOGGER CHILE SPA".into(),
        giro: Some("Importación y exportación".into()),
        direccion: Some("Guardia Vieja 202 of 403".into()),
        comuna: Some("Providencia".into()),
        ciudad: Some("Santiago".into()),
        ..Default::default()
    };
    let l = |n: &str, q: i64, p: i64, pct: f64, exento: bool| {
        let bruto = q * p;
        let desc = (bruto as f64 * pct / 100.0).round() as i64;
        Detalle {
            nombre: n.into(),
            cantidad_milli: Some(q * 1000),
            precio: Some(p),
            descuento_pct: (pct > 0.0).then_some(pct),
            descuento_monto: (desc > 0).then_some(desc),
            monto: bruto - desc,
            exento,
            ..Default::default()
        }
    };
    let texto = |n: &str| Detalle {
        nombre: n.into(),
        ..Default::default()
    };
    let r = |tipo: &str, folio: &str, codigo: Option<u8>, razon: &str| Referencia {
        tipo: tipo.into(),
        folio: folio.into(),
        fecha: "2026-11-22".into(),
        codigo,
        razon: Some(razon.into()),
    };
    let doc =
        |tipo: TipoDte, folio: u64, detalle: Vec<Detalle>, referencias: Vec<Referencia>| Dte {
            tipo,
            folio,
            fecha: "2026-11-22".into(),
            forma_pago: Some(1),
            vencimiento: None,
            ind_traslado: None,
            tipo_despacho: None,
            emisor: em.clone(),
            receptor: rec.clone(),
            detalle,
            referencias,
            descuentos_globales: vec![],
            tasa_iva_ppm: 190_000,
        };
    let c3 = || {
        vec![
            l("Pintura B&W AFECTO", 25, 2244, 0.0, false),
            l("ITEM 2 AFECTO", 153, 3011, 0.0, false),
            l("ITEM 3 SERVICIO EXENTO", 1, 34738, 0.0, true),
        ]
    };
    let mut c4 = doc(
        TipoDte::Factura,
        4,
        vec![
            l("ITEM 1 AFECTO", 100, 1910, 0.0, false),
            l("ITEM 2 AFECTO", 43, 1730, 0.0, false),
            l("ITEM 3 SERVICIO EXENTO", 2, 6771, 0.0, true),
        ],
        vec![r("SET", "4", None, "CASO 5198396-4")],
    );
    c4.descuentos_globales = vec![DescuentoGlobal {
        glosa: Some("Descuento global".into()),
        porcentaje: Some(7.0),
        ..Default::default()
    }];
    let docs = vec![
        (
            doc(
                TipoDte::Factura,
                1,
                vec![
                    l("Cajón AFECTO", 126, 1067, 0.0, false),
                    l("Relleno AFECTO", 54, 1717, 0.0, false),
                ],
                vec![r("SET", "1", None, "CASO 5198396-1")],
            ),
            &caf33,
            270_320,
        ),
        (
            doc(
                TipoDte::Factura,
                2,
                vec![
                    l("Pañuelo AFECTO", 264, 2147, 4.0, false),
                    l("ITEM 2 AFECTO", 192, 1211, 6.0, false),
                ],
                vec![r("SET", "2", None, "CASO 5198396-2")],
            ),
            &caf33,
            907_609,
        ),
        (
            doc(
                TipoDte::Factura,
                3,
                c3(),
                vec![r("SET", "3", None, "CASO 5198396-3")],
            ),
            &caf33,
            649_710,
        ),
        (c4, &caf33, 307_249),
        (
            doc(
                TipoDte::NotaCredito,
                1,
                vec![texto("CORRIGE GIRO DEL RECEPTOR")],
                vec![
                    r("SET", "1", None, "CASO 5198396-5"),
                    r("33", "1", Some(2), "CORRIGE GIRO DEL RECEPTOR"),
                ],
            ),
            &caf61,
            0,
        ),
        (
            doc(
                TipoDte::NotaCredito,
                2,
                vec![
                    l("Pañuelo AFECTO", 97, 2147, 4.0, false),
                    l("ITEM 2 AFECTO", 130, 1211, 6.0, false),
                ],
                vec![
                    r("SET", "2", None, "CASO 5198396-6"),
                    r("33", "2", Some(3), "DEVOLUCION DE MERCADERIAS"),
                ],
            ),
            &caf61,
            414_016,
        ),
        (
            doc(
                TipoDte::NotaCredito,
                3,
                c3(),
                vec![
                    r("SET", "3", None, "CASO 5198396-7"),
                    r("33", "3", Some(1), "ANULA FACTURA"),
                ],
            ),
            &caf61,
            649_710,
        ),
        (
            doc(
                TipoDte::NotaDebito,
                1,
                vec![texto("ANULA NOTA DE CREDITO ELECTRONICA")],
                vec![
                    r("SET", "1", None, "CASO 5198396-8"),
                    r("61", "1", Some(1), "ANULA NOTA DE CREDITO ELECTRONICA"),
                ],
            ),
            &caf56,
            0,
        ),
    ];
    let mut firmados = Vec::new();
    for (i, (d, c, total)) in docs.into_iter().enumerate() {
        let s = d
            .sign(c, &cert, &format!("2026-11-22T14:00:{i:02}"))
            .unwrap();
        assert_eq!(s.totales.total, total, "documento {i}");
        firmados.push(s);
    }
    let car = Caratula::al_sii(RUT, "11111111-1", "2026-11-22", 0);
    let bytes = envio_dte(&car, &firmados, &cert, "2026-11-22T14:01:00").unwrap();
    std::fs::create_dir_all(concat!(env!("CARGO_TARGET_TMPDIR"), "/dte")).unwrap();
    std::fs::write(
        concat!(env!("CARGO_TARGET_TMPDIR"), "/dte/envio_set_basico.xml"),
        &bytes,
    )
    .unwrap();
    // El SII rechaza líneas de más de 4090 caracteres («CHR-00002: Line too long»).
    let largo = from_latin1(&bytes).lines().map(|l| l.len()).max().unwrap();
    assert!(largo < 1000, "línea de {largo} caracteres");
}

/// El timbre de una factura como PDF417: se escribe el símbolo (PBM y SVG) y el texto esperado para
/// leerlo con un decodificador independiente (zxing) fuera de las pruebas.
#[test]
fn timbre_pdf417() {
    use nucleo_dte::timbre::{ALTO_FILA, pdf417};
    let (cert, _) = certificado();
    let (caf, _) = caf(33, 1, 100);
    let s = factura(7).sign(&caf, &cert, "2026-11-22T10:15:00").unwrap();
    let ted = s.ted_latin1();
    assert!(ted.starts_with(b"<TED version=\"1.0\"><DD><RE>") && ted.ends_with(b"</FRMT></TED>"));
    assert!(!ted.contains(&b'\n'), "el timbre va aplanado");
    let p = pdf417(&ted).unwrap();
    let dir = concat!(env!("CARGO_TARGET_TMPDIR"), "/dte");
    std::fs::create_dir_all(dir).unwrap();
    let (esc, q) = (3usize, 6usize);
    let (w, h) = (p.ancho * esc + 2 * q, p.filas * ALTO_FILA * esc + 2 * q);
    let mut pbm = format!("P1\n{w} {h}\n");
    for y in 0..h {
        for x in 0..w {
            let dentro = x >= q && y >= q && x < w - q && y < h - q;
            let negro =
                dentro && p.modulos[((y - q) / (ALTO_FILA * esc)) * p.ancho + (x - q) / esc];
            pbm.push(if negro { '1' } else { '0' });
        }
        pbm.push('\n');
    }
    std::fs::write(format!("{dir}/timbre.pbm"), pbm).unwrap();
    std::fs::write(format!("{dir}/timbre.svg"), p.svg()).unwrap();
    std::fs::write(format!("{dir}/timbre.txt"), &ted).unwrap();
}

/// Intercambio: un proveedor nos manda un sobre con dos facturas (una dirigida a otro RUT). Se lee,
/// se revisan las firmas y se arman las tres respuestas (acuse, resultado comercial y recibos).
#[test]
fn intercambio_recibir_y_responder() {
    use nucleo_dte::crypto::FirmaEstado;
    use nucleo_dte::intercambio::*;
    let (cert_prov, _) = certificado();
    let (caf33, _) = caf(33, 1, 10);
    let buena = factura(1)
        .sign(&caf33, &cert_prov, "2026-11-22T15:00:00")
        .unwrap();
    let mut otra = factura(2);
    otra.receptor.rut = "99999999-9".into();
    let otra = otra
        .sign(&caf33, &cert_prov, "2026-11-22T15:00:01")
        .unwrap();
    let mut car = Caratula::al_sii(RUT, "11111111-1", "2026-11-22", 0);
    car.rut_receptor = "77777777-7".into();
    let sobre = envio_dte(&car, &[buena, otra], &cert_prov, "2026-11-22T15:01:00").unwrap();

    let envio = leer_envio(&sobre).unwrap();
    assert_eq!(
        (
            envio.set_id.as_str(),
            envio.rut_emisor.as_str(),
            envio.rut_receptor.as_str()
        ),
        ("SetDoc", RUT, "77777777-7")
    );
    assert_eq!(envio.firma, FirmaEstado::Valida);
    assert!(envio.digest.as_deref().is_some_and(|d| d.len() == 28));
    assert_eq!(envio.dtes.len(), 2);
    assert!(envio.dtes.iter().all(|d| d.firma == FirmaEstado::Valida));
    assert_eq!(
        (envio.dtes[0].tipo, envio.dtes[0].folio, envio.dtes[0].total),
        (33, 1, 113_038)
    );
    let estados: Vec<u8> = envio
        .dtes
        .iter()
        .map(|d| estado_recepcion(d, "77.777.777-7"))
        .collect();
    assert_eq!(estados, vec![0, 3]);

    // Un sobre alterado después de firmado se detecta.
    let alterado =
        from_latin1(&sobre).replace("<MntTotal>113038</MntTotal>", "<MntTotal>113039</MntTotal>");
    let malo = leer_envio(&latin1(&alterado)).unwrap();
    assert_eq!(malo.firma, FirmaEstado::Invalida);
    assert!(malo.dtes.iter().all(|d| d.firma == FirmaEstado::Invalida));
    assert!(leer_envio(b"<?xml version=\"1.0\"?><Otro/>").is_err());

    let (cert, _) = certificado();
    let r = Responde {
        rut: "77777777-7".into(),
        contacto: Some("Persona de Prueba".into()),
        fono: Some("+56 2 2222 2222".into()),
        mail: Some("facturas@ejemplo.cl".into()),
    };
    let ts = "2026-11-22T16:00:00";
    let a =
        respuesta_recepcion(&envio, "ENVIO_DTE_1234.xml", &r, 1, 0, &estados, &cert, ts).unwrap();
    let b = respuesta_resultado(&envio, &r, 2, &[(0, 0)], &cert, ts).unwrap();
    let c = envio_recibos(&envio, &r, "Bodega central", "11111111-1", &[0], &cert, ts).unwrap();
    let ta = from_latin1(&a).replace('\n', "");
    assert!(ta.contains("<EstadoRecepEnv>0</EstadoRecepEnv><RecepEnvGlosa>Envio Recibido Conforme</RecepEnvGlosa><NroDTE>2</NroDTE>"));
    assert!(ta.contains("<EstadoRecepDTE>3</EstadoRecepDTE><RecepDTEGlosa>DTE No Recibido - Error en RUT Receptor</RecepDTEGlosa>"));
    assert!(
        from_latin1(&b)
            .replace('\n', "")
            .contains("<EstadoDTE>0</EstadoDTE><EstadoDTEGlosa>DTE Aceptado OK</EstadoDTEGlosa>")
    );
    assert!(from_latin1(&c).contains(DECLARACION));
    assert!(respuesta_recepcion(&envio, "x.xml", &r, 1, 0, &[0], &cert, ts).is_err());
    assert!(envio_recibos(&envio, &r, " ", "11111111-1", &[0], &cert, ts).is_err());
    let dir = concat!(env!("CARGO_TARGET_TMPDIR"), "/dte");
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(format!("{dir}/intercambio_recibido.xml"), &sobre).unwrap();
    std::fs::write(format!("{dir}/intercambio_1_recepcion.xml"), &a).unwrap();
    std::fs::write(format!("{dir}/intercambio_2_resultado.xml"), &b).unwrap();
    std::fs::write(format!("{dir}/intercambio_3_recibos.xml"), &c).unwrap();
}
