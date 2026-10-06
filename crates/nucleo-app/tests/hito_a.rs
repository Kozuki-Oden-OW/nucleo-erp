//! Hito A (Blueprint §17, Fase 4): "puedo crear mi empresa, usuarios y adjuntar documentos".

use nucleo_app::core_ops::{BusinessPatch, EntityRef, NewUser, UserPatch};
use nucleo_app::{AppError, AppService, BusinessProfile, MemoryKeyStore, NewCustomer};

fn app() -> (tempfile::TempDir, AppService) {
    let data = tempfile::tempdir().unwrap();
    let app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    (data, app)
}

#[test]
fn empresa_usuarios_y_documentos() {
    let (data, mut app) = app();
    let created = app
        .create_company("Ferretería Los Andes", BusinessProfile::Emprendedor)
        .unwrap();
    let uid = created.company.uid.clone();
    let mut s = app.open_company(&uid).unwrap();

    // Sin contraseñas, opera el dueño directamente.
    assert!(!s.login_required());
    let me = s.current_user().unwrap();
    assert_eq!(me.username, "dueno");
    assert!(me.permissions.contains(&"usuarios.gestionar".to_string()));

    // Formalizarse: actualizar perfil y datos tributarios sin perder nada.
    let b = s.business().unwrap();
    assert!(
        !b.documentation_reminder,
        "emprendedor: sin recordatorio por defecto"
    );
    assert_eq!(b.tax_rate_ppm, None, "sin paquete normativo no hay tasa");
    let b = s
        .update_business(&BusinessPatch {
            profile: Some(BusinessProfile::Negocio),
            rut: Some("76.123.456-0".into()),
            legal_name: Some("Comercial Los Andes SpA".into()),
            documentation_reminder: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(b.profile, BusinessProfile::Negocio);
    assert_eq!(b.rut.as_deref(), Some("76.123.456-0"));
    app.update_company(&uid, &b.name, b.profile).unwrap();
    assert_eq!(
        app.list_companies().unwrap()[0].profile,
        BusinessProfile::Negocio
    );
    assert!(
        s.update_business(&BusinessPatch {
            rut: Some("76.123.456-1".into()),
            ..Default::default()
        })
        .is_err()
    );

    // Usuarios: no se puede dar contraseña a otros si el dueño no tiene una (quedaría fuera).
    assert!(
        s.create_user(&NewUser {
            username: "x".into(),
            display_name: "X".into(),
            roles: vec!["ventas".into()],
            password: Some("ventas-2026".into())
        })
        .is_err()
    );
    let dueno_uid = me.uid.clone();
    s.set_password(&dueno_uid, Some("dueno-seguro-1")).unwrap();
    // Vendedora con contraseña.
    let ventas = s
        .create_user(&NewUser {
            username: "Maria.Lopez".into(),
            display_name: "María López".into(),
            roles: vec!["ventas".into()],
            password: Some("ventas-2026".into()),
        })
        .unwrap();
    assert_eq!(ventas.username, "maria.lopez");
    assert!(
        s.create_user(&NewUser {
            username: "maria.lopez".into(),
            display_name: "Otra".into(),
            roles: vec!["ventas".into()],
            password: None
        })
        .is_err()
    );
    assert!(
        s.set_password(&dueno_uid, None).is_err(),
        "el dueño no puede quedar sin contraseña si otros la tienen"
    );
    // No se puede dejar el negocio sin un dueño activo.
    assert!(
        s.update_user(
            &dueno_uid,
            &UserPatch {
                display_name: "Dueño".into(),
                is_active: false,
                roles: vec!["dueno".into()]
            }
        )
        .is_err()
    );

    // Documentos: adjuntar a un cliente, listar, exportar y quitar.
    let cli = s
        .add_customer(&NewCustomer {
            name: "Constructora Sur".into(),
            ..Default::default()
        })
        .unwrap();
    let file = data.path().join("contrato.pdf");
    std::fs::write(&file, b"%PDF-1.4 contrato de suministro").unwrap();
    let link = EntityRef {
        entity: "cliente".into(),
        uid: cli.uid.clone(),
    };
    let att = s
        .add_attachment(&file, Some("Contrato 2026"), Some(&link))
        .unwrap();
    assert_eq!(att.mime_type, "application/pdf");
    assert_eq!(s.list_attachments("", Some(&link)).unwrap().len(), 1);
    let stored = std::fs::read_dir(data.path().join("companies").join(&uid).join("documents"))
        .unwrap()
        .count();
    assert!(stored >= 1);
    let out = data.path().join("copia.pdf");
    s.export_attachment(&att.uid, &out).unwrap();
    assert_eq!(
        std::fs::read(&out).unwrap(),
        b"%PDF-1.4 contrato de suministro"
    );
    assert!(
        s.global_search("contrato")
            .unwrap()
            .iter()
            .any(|h| h.kind == "documento")
    );

    // Numeración y monedas.
    s.update_sequence("COT", "PRESU", 10, 4).unwrap();
    assert!(s.update_sequence("COT", "presu ñ", 10, 4).is_err());
    s.set_rate("USD", "2026-10-06", 950_250_000, None).unwrap();
    assert!(s.set_rate("CLP", "2026-10-06", 1, None).is_err());
    assert_eq!(
        s.currencies()
            .unwrap()
            .iter()
            .find(|c| c.code == "USD")
            .unwrap()
            .last_rate_e6,
        Some(950_250_000)
    );

    // Auditoría: todo quedó registrado y la cadena está íntegra.
    let log = s.audit_log("", None).unwrap();
    for action in [
        "usuario.crear",
        "usuario.contrasena",
        "documento.adjuntar",
        "documento.exportar",
        "negocio.editar",
        "numeracion.editar",
        "moneda.tasa",
    ] {
        assert!(log.iter().any(|r| r.action == action), "falta {action}");
    }
    assert!(s.verify_audit().unwrap().ok);
    s.archive_attachment(&att.uid, "Contrato reemplazado")
        .unwrap();
    assert!(s.list_attachments("", Some(&link)).unwrap().is_empty());
    drop(s);

    // Al reabrir, como hay contraseñas, se pide iniciar sesión.
    let mut s = app.open_company(&uid).unwrap();
    assert!(s.login_required());
    assert!(matches!(s.business(), Err(AppError::LoginRequired)));
    assert!(matches!(
        s.login("maria.lopez", "mala"),
        Err(AppError::BadCredentials)
    ));
    let m = s.login("MARIA.LOPEZ", "ventas-2026").unwrap();
    assert_eq!(m.display_name, "María López");
    // Permisos verificados en el backend.
    assert!(matches!(s.list_users(), Err(AppError::Forbidden(_))));
    assert!(matches!(
        s.update_sequence("VEN", "V", 5, 6),
        Err(AppError::Forbidden(_))
    ));
    assert!(
        s.global_search("constructora")
            .unwrap()
            .iter()
            .any(|h| h.kind == "cliente")
    );
    s.logout().unwrap();
    assert!(s.login_required());

    // Bloqueo tras 5 intentos fallidos.
    for _ in 0..4 {
        assert!(matches!(
            s.login("dueno", "x"),
            Err(AppError::BadCredentials)
        ));
    }
    assert!(matches!(s.login("dueno", "x"), Err(AppError::Locked(_))));
    assert!(
        matches!(s.login("dueno", "dueno-seguro-1"), Err(AppError::Locked(_))),
        "bloqueado aunque la clave sea correcta"
    );
}

#[test]
fn respaldo_incluye_documentos_cifrados() {
    let (data, mut app) = app();
    let c = app
        .create_company("Mi Negocio", BusinessProfile::Negocio)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    let att = s
        .add_attachment_bytes("boleta-luz.png", b"\x89PNG imagen", None, None)
        .unwrap();
    let backups = tempfile::tempdir().unwrap();
    let done = s
        .create_backup(backups.path(), "respaldo-seguro-1")
        .unwrap();
    assert!(done.verified);
    drop(s);
    let restored = app
        .restore_backup(done.path.as_ref(), "respaldo-seguro-1", "dueno")
        .unwrap();
    let r = app.open_company(&restored.uid).unwrap();
    let (row, bytes) = r.attachment_bytes(&att.uid).unwrap();
    assert_eq!(row.file_name, "boleta-luz.png");
    assert_eq!(bytes, b"\x89PNG imagen");
    let _ = data;
}
