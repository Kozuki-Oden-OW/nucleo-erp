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
    assert_eq!(info.settings.sites, vec!["mercadolibre.cl", "sii.cl"]);
    assert_eq!(info.allowed, vec!["bci.cl", "mercadolibre.cl", "sii.cl"]);
    assert!(
        s.browser_save_settings(&BrowserSettings {
            download_dir: String::new(),
            sites: vec!["mi banco".into()],
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
