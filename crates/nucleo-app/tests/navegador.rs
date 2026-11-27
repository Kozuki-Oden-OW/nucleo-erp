//! Navegador de NÚCLEO: sitios permitidos, permiso de ingreso por el día y entrega de la clave solo
//! a NÚCLEO, solo con el permiso de hoy y solo para una página del mismo sitio.

use nucleo_app::access_ops::AccessInput;
use nucleo_app::browser_ops::BrowserSettings;
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn banco() -> AccessInput {
    AccessInput {
        name: "BCI Pyme".into(),
        login_url: "https://www.bci.cl/corporativo/banco-en-linea/pyme".into(),
        username: "11111111-1".into(),
        password: "clave-de-ejemplo".into(),
        kind: "lectura".into(),
        notes: None,
        no_payments: true,
    }
}

#[test]
fn sitios_permitidos_y_ajustes_solo_de_la_persona() {
    let (_d, _a, mut s) = session();
    // De fábrica: el SII. Un banco no entra hasta que haya un acceso o la persona lo agregue.
    assert_eq!(
        s.browser_check_url("https://www1.sii.cl/cgi-bin/x")
            .unwrap(),
        "www1.sii.cl"
    );
    assert!(s.browser_check_url("https://www.bci.cl/").is_err());
    assert!(s.browser_check_url("http://www.sii.cl/").is_err());
    assert!(s.browser_check_url("https://sii.cl.malo.com/").is_err());

    // Guardar un acceso agrega su sitio (con todos sus subdominios).
    s.save_access(None, &banco()).unwrap();
    assert_eq!(
        s.browser_check_url("https://bel.bci.cl/x").unwrap(),
        "bel.bci.cl"
    );

    // La persona agrega sitios y la carpeta; el asistente no.
    let v = BrowserSettings {
        download_dir: " D:\\Facturas ".into(),
        shipping_dir: " D:\\Datalogger spa\\Envios ".into(),
        sites: vec![
            "https://www.MercadoLibre.cl/ventas".into(),
            "sii.cl".into(),
            "".into(),
        ],
    };
    s.set_via_agent(true);
    assert!(s.browser_save_settings(&v).is_err());
    s.set_via_agent(false);
    let info = s.browser_save_settings(&v).unwrap();
    assert_eq!(info.settings.download_dir, "D:\\Facturas");
    // La carpeta de las etiquetas de envío es aparte; el nombre «blue.<seguimiento>.pdf» es válido.
    assert_eq!(info.settings.shipping_dir, "D:\\Datalogger spa\\Envios");
    assert_eq!(
        nucleo_app::browser_ops::safe_file_name("blue.2486244670.pdf").unwrap(),
        "blue.2486244670.pdf"
    );
    assert!(nucleo_app::browser_ops::safe_file_name("..\\blue.2486244670.pdf").is_err());
    assert_eq!(info.settings.sites, vec!["mercadolibre.cl", "sii.cl"]);
    assert_eq!(info.allowed, vec!["bci.cl", "mercadolibre.cl", "sii.cl"]);
    assert!(
        s.browser_save_settings(&BrowserSettings {
            sites: vec!["mi banco".into()],
            ..BrowserSettings::default()
        })
        .is_err()
    );
}

#[test]
fn la_clave_solo_con_el_permiso_de_hoy_y_para_el_mismo_sitio() {
    let (_d, _a, mut s) = session();
    let a = s.save_access(None, &banco()).unwrap();

    // Sin permiso no hay clave, ni para la persona ni para el asistente.
    let e = s.browser_login_data(&a.uid, None).unwrap_err().to_string();
    assert!(e.contains("Autorizar por hoy"), "{e}");

    // El asistente no se puede autorizar a sí mismo.
    s.set_via_agent(true);
    assert!(s.browser_grant(&a.uid, true).is_err());
    assert!(!s.browser_info().unwrap().accesses[0].granted_today);
    s.set_via_agent(false);

    // La persona autoriza por hoy: desde ahí NÚCLEO puede rellenar, también cuando lo pide el asistente.
    let info = s.browser_grant(&a.uid, true).unwrap();
    assert!(info.accesses[0].granted_today);
    s.set_via_agent(true);
    let d = s.browser_login_data(&a.uid, Some("www.bci.cl")).unwrap();
    assert_eq!(
        (d.username.as_str(), d.secret.as_str()),
        ("11111111-1", "clave-de-ejemplo")
    );
    assert_eq!(d.host, "www.bci.cl");
    // Otro subdominio del mismo banco sirve; otro sitio, no.
    assert!(s.browser_login_data(&a.uid, Some("bel.bci.cl")).is_ok());
    let e = s
        .browser_login_data(&a.uid, Some("bci.cl.entrar.com"))
        .unwrap_err()
        .to_string();
    assert!(e.contains("no entrega la clave"), "{e}");
    s.set_via_agent(false);

    // Lo que ve la interfaz nunca trae la clave.
    let json = serde_json::to_string(&s.browser_info().unwrap()).unwrap();
    assert!(!json.contains("clave-de-ejemplo"));

    // Quitar el permiso lo corta de inmediato.
    s.browser_grant(&a.uid, false).unwrap();
    assert!(s.browser_login_data(&a.uid, None).is_err());

    // Por nombre, sin distinguir mayúsculas.
    assert_eq!(s.browser_find_access("bci").unwrap().uid, a.uid);
    assert!(s.browser_find_access("otro").is_err());
}

#[test]
fn del_sii_solo_se_guarda_e_boleta_y_su_clave_vale_solo_en_ese_servidor() {
    use nucleo_app::access_ops::AccessInput;
    let data = tempfile::tempdir().unwrap();
    let mut app =
        nucleo_app::AppService::open(data.path(), Box::new(nucleo_app::MemoryKeyStore::default()))
            .unwrap();
    let c = app
        .create_company("Data Logger", nucleo_app::BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    let acceso = |name: &str, url: &str| AccessInput {
        name: name.into(),
        login_url: url.into(),
        username: "17256184-5".into(),
        password: "secreta".into(),
        kind: "operador".into(),
        notes: None,
        no_payments: true,
    };
    // El resto del SII sigue sin guardarse; un nombre parecido en otro dominio tampoco pasa por e-Boleta.
    assert!(
        s.save_access(None, &acceso("SII", "https://zeusr.sii.cl/AUT2000/"))
            .is_err()
    );
    assert!(
        s.save_access(None, &acceso("Clave Tributaria", "https://misii.sii.cl/"))
            .is_err()
    );
    assert_eq!(
        nucleo_app::CompanySession::login_scope("https://eboleta.sii.cl.malo.com/x").as_deref(),
        Some("malo.com")
    );
    let a = s
        .save_access(None, &acceso("SII e-Boleta", "https://eboleta.sii.cl/"))
        .unwrap();
    assert_eq!(
        nucleo_app::CompanySession::login_scope(&a.login_url).as_deref(),
        Some("eboleta.sii.cl")
    );
    assert_eq!(
        nucleo_app::CompanySession::login_scope("https://www.bci.cl/pyme").as_deref(),
        Some("bci.cl")
    );
    // Con el permiso de hoy, la clave va a e-Boleta y a ningún otro servidor del SII.
    s.browser_grant(&a.uid, true).unwrap();
    assert!(s.browser_login_data(&a.uid, Some("eboleta.sii.cl")).is_ok());
    for otro in ["zeusr.sii.cl", "www.sii.cl", "misii.sii.cl", "sii.cl"] {
        assert!(
            s.browser_login_data(&a.uid, Some(otro)).is_err(),
            "no debe entregar la clave a {otro}"
        );
    }
}

#[test]
fn la_clave_de_firma_la_guarda_la_persona_y_solo_sale_para_el_sii() {
    let (_d, _a, mut s) = session();
    assert!(!s.signing_key_status().unwrap().saved);
    // Sin clave guardada no hay nada que entregar.
    let e = s
        .signing_secret("www1.sii.cl", "FV-000001")
        .unwrap_err()
        .to_string();
    assert!(e.contains("Aún no hay clave de firma"), "{e}");

    // El asistente no la guarda ni la borra.
    s.set_via_agent(true);
    assert!(s.save_signing_key("clave-de-ejemplo", true).is_err());
    assert!(s.delete_signing_key().is_err());
    s.set_via_agent(false);
    // La persona, declarando que entiende para qué es.
    assert!(s.save_signing_key("clave-de-ejemplo", false).is_err());
    assert!(s.save_signing_key("", true).is_err());
    let st = s.save_signing_key("clave-de-ejemplo", true).unwrap();
    assert!(st.saved && st.updated_at.is_some());
    // Lo que ve la interfaz no trae la clave, y no aparece entre los accesos.
    let json = serde_json::to_string(&s.signing_key_status().unwrap()).unwrap();
    assert!(!json.contains("clave-de-ejemplo"), "{json}");
    assert!(s.accesses().unwrap().is_empty());
    assert!(s.browser_info().unwrap().accesses.is_empty());

    // Solo para una página del SII.
    assert!(s.signing_secret("www.bci.cl", "x").is_err());
    assert!(s.signing_secret("sii.cl.entrar.com", "x").is_err());
    assert_eq!(
        s.signing_secret("www1.sii.cl", "FV-000001 · Cliente · total $ 37.900")
            .unwrap(),
        "clave-de-ejemplo"
    );
    // Se reemplaza y se borra.
    s.save_signing_key("otra-clave", true).unwrap();
    assert_eq!(s.signing_secret("www1.sii.cl", "x").unwrap(), "otra-clave");
    assert!(!s.delete_signing_key().unwrap().saved);
    assert!(s.signing_secret("www1.sii.cl", "x").is_err());
    assert!(s.signing_sale_brief("FV-999999").is_err());
}
