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

    // Representación impresa: se lee del XML firmado y trae el timbre como PDF417.
    let p = s.sii_document_print(d1.id).unwrap();
    assert_eq!((p.tipo, p.folio, p.totales.total), (33, 1, 23_800));
    assert_eq!(
        (p.totales.neto, p.totales.iva, p.totales.tasa_iva),
        (Some(20_000), Some(3_800), Some(19.0))
    );
    assert_eq!(p.emisor.rut, "76000000-0");
    assert_eq!(p.receptor.razon_social, "Cliente de Prueba Ltda.");
    assert_eq!(p.receptor.comuna.as_deref(), Some("Ñuñoa"));
    assert_eq!(
        (
            p.lineas.len(),
            p.lineas[0].cantidad,
            p.lineas[0].precio,
            p.lineas[0].monto
        ),
        (1, Some(2.0), Some(10_000.0), 20_000)
    );
    assert_eq!(p.referencias[0].tipo_nombre, "Set de pruebas");
    assert!(p.cedible && p.timbre_svg.starts_with("<svg"));
    assert_eq!(
        (p.resolucion_numero, p.resolucion_anio.as_str()),
        (0, "2026")
    );

    // Libro de ventas con lo enviado del período (el folio 3 sigue firmado y no entra).
    let libro = s
        .sii_libro_create(&sii_ops::SiiLibroInput {
            operacion: nucleo_dte::libro::Operacion::Venta,
            periodo: "2026-11".into(),
            tipo_libro: "ESPECIAL".into(),
            folio_notificacion: Some(5_198_397),
            fct_prop: None,
            documentos: vec![],
            compras: vec![],
        })
        .unwrap();
    assert_eq!((libro.documentos, libro.estado.as_str()), (2, "firmado"));
    let xml = String::from_utf8_lossy(&s.sii_libro_xml(libro.id).unwrap()).replace('\n', "");
    assert!(xml.contains("<TipoOperacion>VENTA</TipoOperacion>"));
    assert!(xml.contains("<TotDoc>2</TotDoc><TotMntExe>0</TotMntExe><TotMntNeto>40000</TotMntNeto><TotMntIVA>7600</TotMntIVA><TotMntTotal>47600</TotMntTotal>"));
    assert!(xml.contains("<FolioNotificacion>5198397</FolioNotificacion>"));
    let plan = s.sii_libro_send_plan(libro.id).unwrap();
    assert!(plan.file_name.starts_with("LibroCV_760000000_VENTA_202611"));
    let track = sii_ops::send(&fake, &plan).unwrap();
    assert!(String::from_utf8_lossy(&fake.uploaded.borrow()).contains("<LibroCompraVenta"));
    let l = s.sii_libro_send_apply(libro.id, &track).unwrap();
    assert_eq!(l.estado, "enviado");
    assert!(s.sii_libro_send_plan(libro.id).is_err());
    *fake.estado.borrow_mut() =
        "<SII:RESP_HDR><ESTADO>LOK</ESTADO><GLOSA>Libro Cuadrado</GLOSA></SII:RESP_HDR>".into();
    let (cred, t) = s.sii_libro_status_plan(libro.id).unwrap();
    let e = sii_ops::check(&fake, &cred, &t).unwrap();
    assert_eq!(
        s.sii_libro_status_apply(libro.id, &e).unwrap().estado,
        "aceptado"
    );

    // Libro de compras con líneas manuales.
    let c = s
        .sii_libro_create(&sii_ops::SiiLibroInput {
            operacion: nucleo_dte::libro::Operacion::Compra,
            periodo: "2026-11".into(),
            tipo_libro: "ESPECIAL".into(),
            folio_notificacion: Some(5_198_398),
            fct_prop: Some(0.6),
            documentos: vec![],
            compras: vec![nucleo_dte::libro::LineaLibro {
                tipo: 30,
                folio: 234,
                tasa_iva: Some(19.0),
                fecha: "2026-11-22".into(),
                rut: "11.111.111-1".into(),
                razon_social: "Proveedor".into(),
                neto: 58_129,
                iva: 11_045,
                total: 69_174,
                ..Default::default()
            }],
        })
        .unwrap();
    assert_eq!(c.operacion, "compra");
    assert!(
        String::from_utf8_lossy(&s.sii_libro_xml(c.id).unwrap())
            .contains("<RUTDoc>11111111-1</RUTDoc>")
    );
    assert_eq!(s.sii_libros().unwrap().len(), 2);
}

/// Muestra de impresión del caso 4 del set (descuento global, línea exenta, unidad del SII): los datos
/// salen del XML firmado. Deja el JSON en el directorio temporal para revisar la página a ojo.
#[test]
fn muestra_impresa() {
    let (_d, _a, mut s) = session();
    setup(&mut s);
    let mut st = s.sii_status().unwrap();
    st.emisor.unidad_sii = "santiago oriente".into();
    s.sii_save_setup(&SiiSetup {
        ambiente: Ambiente::Certificacion,
        emisor: st.emisor.clone(),
        resolucion_fecha: Some("2026-11-22".into()),
        resolucion_numero: Some(0),
    })
    .unwrap();
    s.sii_load_certificate(&pfx(), "clave").unwrap();
    s.sii_load_caf(&caf(RUT, 33, 1, 5)).unwrap();
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
    let mut f = factura();
    f.detalle = vec![
        l("ITEM 1 AFECTO", 100, 1910, 0.0, false),
        l("Pañuelo AFECTO", 43, 1730, 4.0, false),
        l("ITEM 3 SERVICIO EXENTO", 2, 6771, 0.0, true),
    ];
    f.descuentos_globales = vec![nucleo_dte::DescuentoGlobal {
        glosa: Some("Descuento global".into()),
        porcentaje: Some(7.0),
        ..Default::default()
    }];
    f.forma_pago = Some(2);
    f.vencimiento = Some("2026-12-22".into());
    let d = s.sii_issue(&f).unwrap();
    let p = s.sii_document_print(d.id).unwrap();
    assert_eq!(p.unidad_sii, "SANTIAGO ORIENTE");
    assert_eq!(
        (
            p.globales.len(),
            p.globales[0].tipo_valor.as_str(),
            p.globales[0].valor
        ),
        (1, "%", 7.0)
    );
    assert_eq!(p.lineas[1].descuento_monto, Some(2_976));
    assert!(p.lineas[2].exento && !p.lineas[0].exento);
    assert_eq!(
        (p.forma_pago, p.vencimiento.as_deref()),
        (Some(2), Some("2026-12-22"))
    );
    assert_eq!(p.totales.total, d.total_minor);
    std::fs::write(
        concat!(env!("CARGO_TARGET_TMPDIR"), "/muestra_impresa.json"),
        serde_json::to_string(&p).unwrap(),
    )
    .unwrap();
}

/// Intercambio: llega un sobre de un proveedor con una factura para esta empresa y otra para un RUT
/// ajeno; NÚCLEO lo lee y arma las tres respuestas firmadas.
#[test]
fn intercambio_responde_un_sobre() {
    use nucleo_app::sii_intercambio::IntercambioInput;
    use nucleo_dte::envio::{Caratula, envio_dte};
    use nucleo_dte::{Caf, Certificate, Dte, Emisor, TipoDte};
    let (_d, _a, mut s) = session();
    setup(&mut s);
    s.sii_load_certificate(&pfx(), "clave").unwrap();

    // El proveedor (otra empresa) emite y firma con sus propios folios y certificado.
    let prov = "88888888-8";
    let cert_prov = Certificate::from_pkcs12(&pfx(), "clave").unwrap();
    let caf_prov = Caf::parse(&caf(prov, 33, 1, 5)).unwrap();
    let doc = |folio: u64, receptor: &str| Dte {
        tipo: TipoDte::Factura,
        folio,
        fecha: "2026-11-22".into(),
        forma_pago: Some(1),
        vencimiento: None,
        ind_traslado: None,
        tipo_despacho: None,
        emisor: Emisor {
            rut: prov.into(),
            razon_social: "PROVEEDOR DE PRUEBA".into(),
            giro: "Venta de insumos".into(),
            actecos: vec![469000],
            direccion: "Calle 2".into(),
            comuna: "Santiago".into(),
            ..Default::default()
        },
        receptor: Receptor {
            rut: receptor.into(),
            ..factura().receptor
        },
        detalle: factura().detalle,
        referencias: vec![],
        descuentos_globales: vec![],
        tasa_iva_ppm: 190_000,
    };
    let firmados = vec![
        doc(1, RUT)
            .sign(&caf_prov, &cert_prov, "2026-11-22T09:00:00")
            .unwrap(),
        doc(2, "99999999-9")
            .sign(&caf_prov, &cert_prov, "2026-11-22T09:00:01")
            .unwrap(),
    ];
    let mut car = Caratula::al_sii(prov, "11111111-1", "2026-11-22", 0);
    car.rut_receptor = RUT.into();
    let sobre = envio_dte(&car, &firmados, &cert_prov, "2026-11-22T09:01:00").unwrap();

    let r = s.sii_intercambio_leer(&sobre).unwrap();
    assert_eq!((r.estado_envio, r.documentos.len()), (0, 2));
    assert_eq!((r.documentos[0].estado, r.documentos[1].estado), (0, 3));
    assert_eq!(r.documentos[0].razon_social, "PROVEEDOR DE PRUEBA");

    let input = IntercambioInput {
        contacto: Some("Persona de Prueba".into()),
        mail: Some("facturas@ejemplo.cl".into()),
        recinto: "Bodega".into(),
        ..Default::default()
    };
    let out = s
        .sii_intercambio_responder(&sobre, "ENVIO_DTE_77.xml", &input)
        .unwrap();
    let t = |b: &[u8]| String::from_utf8_lossy(b).replace('\n', "");
    let a = t(&out.recepcion);
    assert!(a.contains("<RutResponde>76000000-0</RutResponde><RutRecibe>88888888-8</RutRecibe>"));
    assert!(
        a.contains("<NmbEnvio>ENVIO_DTE_77.xml</NmbEnvio>") && a.contains("<NroDTE>2</NroDTE>")
    );
    assert!(
        a.contains("<EstadoRecepDTE>0</EstadoRecepDTE>")
            && a.contains("<EstadoRecepDTE>3</EstadoRecepDTE>")
    );
    let b = t(out.resultado.as_deref().unwrap());
    assert_eq!(b.matches("<ResultadoDTE>").count(), 1);
    assert!(b.contains("<Folio>1</Folio>") && b.contains("<EstadoDTE>0</EstadoDTE>"));
    let c = t(out.recibos.as_deref().unwrap());
    assert!(c.contains("<Recinto>Bodega</Recinto><RutFirma>11111111-1</RutFirma>"));
    assert_eq!(c.matches("<DocumentoRecibo ").count(), 1);
    // Sin recinto no hay recibo.
    assert!(
        s.sii_intercambio_responder(&sobre, "x.xml", &IntercambioInput::default())
            .is_err()
    );

    // Un sobre dirigido a otro RUT se rechaza completo: solo hay acuse.
    car.rut_receptor = "99999999-9".into();
    let ajeno = envio_dte(&car, &firmados, &cert_prov, "2026-11-22T09:02:00").unwrap();
    let out = s
        .sii_intercambio_responder(&ajeno, "y.xml", &input)
        .unwrap();
    assert_eq!(out.resumen.estado_envio, 3);
    assert!(out.resultado.is_none() && out.recibos.is_none());
    assert!(t(&out.recepcion).contains("<EstadoRecepEnv>3</EstadoRecepEnv>"));
}

/// Factura desde una venta: el borrador toma el receptor de la ficha del cliente, las líneas con su
/// descuento y la forma de pago; al timbrarla queda unida a la venta y no se emite dos veces.
#[test]
fn factura_desde_una_venta() {
    use nucleo_app::NewCustomer;
    use nucleo_app::sales_ops::{EffectInput, LineInput, SaleInput};
    let (_d, _a, mut s) = session();
    setup(&mut s);
    s.sii_load_certificate(&pfx(), "clave").unwrap();
    s.sii_load_caf(&caf(RUT, 33, 1, 5)).unwrap();
    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur SpA".into(),
            rut: Some("77.777.777-7".into()),
            email: Some("pagos@clinicasur.cl".into()),
            profile: nucleo_db::customers::CustomerProfile {
                business_activity: Some("Servicios de salud".into()),
                address: Some("Av. Lyon 1801".into()),
                commune: Some("Curicó".into()),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(c.uid.clone()),
                issue_date: "2026-11-20".into(),
                lines: vec![
                    LineInput {
                        product_uid: None,
                        description: "Registrador de temperatura RC-5".into(),
                        qty_milli: 3000,
                        unit_price_minor: 25_000,
                        discount_ppm: 100_000,
                        taxable: true,
                    },
                    LineInput {
                        product_uid: None,
                        description: "Despacho".into(),
                        qty_milli: 1000,
                        unit_price_minor: 5_000,
                        discount_ppm: 0,
                        taxable: true,
                    },
                ],
                notes: None,
                terms: None,
            },
            None,
        )
        .unwrap();
    let uid = v.summary.uid.clone();
    // Una venta en borrador no se factura.
    assert!(
        s.sii_sale_draft(&uid)
            .unwrap_err()
            .to_string()
            .contains("efectuada")
    );
    s.effect_sale(
        &uid,
        &EffectInput {
            mode: "credito".into(),
            method: String::new(),
            due_date: Some("2026-12-20".into()),
            account_uid: None,
        },
    )
    .unwrap();
    let b = s.sii_sale_draft(&uid).unwrap();
    assert_eq!(b.tipo, 33);
    assert_eq!(
        (b.receptor.rut.as_str(), b.receptor.razon_social.as_str()),
        ("77777777-7", "Clínica Sur SpA")
    );
    assert_eq!(b.receptor.giro.as_deref(), Some("Servicios de salud"));
    assert_eq!(b.receptor.comuna.as_deref(), Some("Curicó"));
    assert_eq!(b.detalle.len(), 2);
    assert_eq!(
        (
            b.detalle[0].cantidad_milli,
            b.detalle[0].precio,
            b.detalle[0].descuento_pct,
            b.detalle[0].descuento_monto,
            b.detalle[0].monto
        ),
        (Some(3000), Some(25_000), Some(10.0), Some(7_500), 67_500)
    );
    assert_eq!(b.sale_uid.as_deref(), Some(uid.as_str()));
    let antes = s.sale(&uid).unwrap().summary.documentation_state;
    let d = s.sii_issue(&b).unwrap();
    assert_eq!(
        (d.folio, d.total_minor),
        (1, s.sale(&uid).unwrap().summary.total_minor)
    );
    // En certificación la venta no cambia; y no se emite dos veces.
    assert_eq!(s.sale(&uid).unwrap().summary.documentation_state, antes);
    assert!(
        s.sii_sale_draft(&uid)
            .unwrap_err()
            .to_string()
            .contains("ya tiene factura electrónica N° 1")
    );

    // En producción (con resolución y folios reales) la venta queda documentada con el folio.
    let st = s.sii_status().unwrap();
    s.sii_save_setup(&SiiSetup {
        ambiente: Ambiente::Produccion,
        emisor: st.emisor.clone(),
        resolucion_fecha: Some("2026-12-10".into()),
        resolucion_numero: Some(80),
    })
    .unwrap();
    s.sii_load_caf(&caf(RUT, 33, 100, 105)).unwrap();
    let b = s.sii_sale_draft(&uid).unwrap();
    let d = s.sii_issue(&b).unwrap();
    assert_eq!((d.folio, d.ambiente), (100, Ambiente::Produccion));
    let venta = s.sale(&uid).unwrap();
    assert_eq!(venta.summary.documentation_state, "documentada");
    let r = venta.external_ref.unwrap();
    assert_eq!(
        (r.doc_kind.as_deref(), r.external_number.as_deref()),
        (Some("Factura electrónica"), Some("100"))
    );
}
