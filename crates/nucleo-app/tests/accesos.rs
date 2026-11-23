//! Gestor de contraseñas de NÚCLEO: los accesos de solo lectura se guardan en la base cifrada, la clave
//! nunca vuelve a la interfaz y solo NÚCLEO la lee (dejando registro) para iniciar sesión.

use nucleo_app::access_ops::AccessInput;
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

fn ml() -> AccessInput {
    AccessInput {
        name: "Mercado Libre".into(),
        login_url: "https://www.mercadolibre.cl/".into(),
        username: "colaborador@ejemplo.cl".into(),
        password: "clave-de-ejemplo".into(),
        kind: "lectura".into(),
        notes: Some("Colaborador con permiso de ver ventas".into()),
        no_payments: true,
    }
}

#[test]
fn guarda_lista_sin_la_clave_y_borra() {
    let (_d, _a, mut s) = session();
    assert!(s.accesses().unwrap().is_empty());

    // Lo que no se acepta.
    let mut x = ml();
    x.no_payments = false;
    assert!(
        s.save_access(None, &x)
            .unwrap_err()
            .to_string()
            .contains("no puede pagar ni transferir")
    );
    let mut x = ml();
    x.login_url = "http://sitio.cl".into();
    assert!(s.save_access(None, &x).is_err());
    let mut x = ml();
    x.password.clear();
    assert!(s.save_access(None, &x).is_err());
    let mut x = ml();
    x.kind = "apoderado".into();
    assert!(s.save_access(None, &x).is_err());
    let mut x = ml();
    x.name = "SII".into();
    x.login_url = "https://zeusr.sii.cl/AUT2000/".into();
    assert!(
        s.save_access(None, &x)
            .unwrap_err()
            .to_string()
            .contains("Clave Tributaria")
    );
    let mut x = ml();
    x.login_url = "https://accounts.google.com/".into();
    assert!(s.save_access(None, &x).is_err());
    assert!(s.accesses().unwrap().is_empty());

    // Se guarda y lo que se lista no trae la clave.
    let a = s.save_access(None, &ml()).unwrap();
    assert_eq!(
        (a.name.as_str(), a.username.as_str(), a.kind.as_str()),
        ("Mercado Libre", "colaborador@ejemplo.cl", "lectura")
    );
    assert!(a.has_password);
    let shown = serde_json::to_string(&s.accesses().unwrap()).unwrap();
    assert!(!shown.contains("clave-de-ejemplo"), "{shown}");
    // Tampoco queda en la auditoría.
    let audit = serde_json::to_string(&s.audit_log("", None).unwrap()).unwrap();
    assert!(
        audit.contains("Guardó el acceso a Mercado Libre") && !audit.contains("clave-de-ejemplo")
    );

    // No se repite el nombre.
    assert!(
        s.save_access(None, &ml())
            .unwrap_err()
            .to_string()
            .contains("ya hay un acceso")
    );

    // Cambiar sin escribir la clave la conserva; escribirla la reemplaza.
    let mut x = ml();
    x.password.clear();
    x.username = "otro@ejemplo.cl".into();
    let b = s.save_access(Some(&a.uid), &x).unwrap();
    assert_eq!(
        (b.uid.as_str(), b.username.as_str()),
        (a.uid.as_str(), "otro@ejemplo.cl")
    );
    let (url, user, pass) = s.access_credentials(&a.uid, "revisar ventas").unwrap();
    assert_eq!(
        (url.as_str(), user.as_str(), pass.as_str()),
        (
            "https://www.mercadolibre.cl/",
            "otro@ejemplo.cl",
            "clave-de-ejemplo"
        )
    );
    let mut x = ml();
    x.password = "clave-nueva".into();
    s.save_access(Some(&a.uid), &x).unwrap();
    assert_eq!(
        s.access_credentials(&a.uid, "revisar ventas").unwrap().2,
        "clave-nueva"
    );
    // Cada uso de la clave queda registrado, sin la clave.
    let audit = serde_json::to_string(&s.audit_log("", None).unwrap()).unwrap();
    assert!(
        audit.contains("para iniciar sesión: revisar ventas") && !audit.contains("clave-nueva")
    );

    // Borrar elimina el acceso y su clave.
    assert!(s.delete_access(&a.uid).unwrap().is_empty());
    assert!(s.access_credentials(&a.uid, "x").is_err());
    assert!(s.delete_access(&a.uid).is_err());
}
