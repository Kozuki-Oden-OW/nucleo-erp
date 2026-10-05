//! Criterio de salida de la Fase 1 (Blueprint §17): crear una base cifrada, escribir,
//! respaldar y restaurar — más auditoría y recuperación de clave.

use nucleo_app::{AppService, BusinessProfile, MemoryKeyStore, NewCustomer};

fn cliente(name: &str, rut: Option<&str>) -> NewCustomer {
    NewCustomer {
        name: name.into(),
        rut: rut.map(Into::into),
        ..Default::default()
    }
}

#[test]
fn crear_escribir_respaldar_restaurar() {
    let data = tempfile::tempdir().unwrap();
    let backups = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();

    // 1. Crear negocio (perfil Emprendedor, sin datos tributarios).
    let created = app
        .create_company(
            "Ferretería Los Andes",
            BusinessProfile::Emprendedor,
            "admin",
        )
        .unwrap();
    assert_eq!(created.recovery_key.split('-').count(), 13);
    let uid = created.company.uid.clone();

    // 2. Escribir.
    let mut s = app.open_company(&uid).unwrap();
    assert!(!s.cipher_version().unwrap().is_empty());
    s.add_customer(&cliente("Juan Pérez", Some("12.345.678-5")), "admin")
        .unwrap();
    s.add_customer(&cliente("Comercial Sur", None), "admin")
        .unwrap();
    assert!(
        s.add_customer(&cliente("Otro", Some("12.345.678-9")), "admin")
            .is_err()
    ); // DV malo
    assert!(
        s.add_customer(&cliente("Duplicado", Some("12345678-5")), "admin")
            .is_err()
    ); // RUT repetido
    assert_eq!(s.search_customers("perez", 10).unwrap().len(), 1);

    // 3. Respaldar (con verificación inmediata).
    let done = s
        .create_backup(backups.path(), "contraseña-larga", "admin")
        .unwrap();
    assert!(done.verified);
    assert!(done.file_name.starts_with("ferreteria-los-andes_"));
    assert_eq!(done.manifest.counts.get("customers"), Some(&2));

    // 4. Restaurar como empresa nueva.
    assert!(
        app.restore_backup(done.path.as_ref(), "otra-clave-larga", "admin")
            .is_err()
    );
    let restored = app
        .restore_backup(done.path.as_ref(), "contraseña-larga", "admin")
        .unwrap();
    assert!(restored.name.contains("(restaurada"));
    assert_eq!(app.list_companies().unwrap().len(), 2);
    let r = app.open_company(&restored.uid).unwrap();
    assert_eq!(r.count_customers().unwrap(), 2);
    assert_eq!(
        r.search_customers("12345678", 5).unwrap()[0].name,
        "Juan Pérez"
    );

    // 5. La auditoría cuadra en ambas.
    let a1 = s.verify_audit().unwrap();
    let a2 = r.verify_audit().unwrap();
    assert!(a1.ok && a2.ok);
    assert!(a1.entries >= 4); // empresa.crear, 2 clientes, respaldo.crear
    assert_eq!(a2.entries, a1.entries); // lo respaldado + empresa.restaurar − respaldo.crear
}

#[test]
fn clave_de_recuperacion_rehabilita_la_empresa() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let created = app
        .create_company("Mi Negocio", BusinessProfile::Negocio, "admin")
        .unwrap();
    let uid = created.company.uid.clone();
    drop(app);

    // Se "pierde" el almacén de claves (Windows reinstalado): nuevo almacén vacío.
    let app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    assert!(app.open_company(&uid).is_err());
    assert!(
        app.recover_key(
            &uid,
            "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-IIII-JJJJ-KKKK-LLLL-MMMM"
        )
        .is_err()
    );
    app.recover_key(&uid, &created.recovery_key).unwrap();
    let s = app.open_company(&uid).unwrap();
    assert_eq!(s.name(), "Mi Negocio");
    assert_eq!(s.profile(), BusinessProfile::Negocio);
}

#[test]
fn validaciones_de_entrada() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    assert!(
        app.create_company("   ", BusinessProfile::Empresa, "admin")
            .is_err()
    );
    let c = app
        .create_company("X", BusinessProfile::Empresa, "admin")
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    assert!(s.add_customer(&cliente("", None), "admin").is_err());
    let mut bad_mail = cliente("Ana", None);
    bad_mail.email = Some("ana-sin-arroba".into());
    assert!(s.add_customer(&bad_mail, "admin").is_err());
    assert!(s.create_backup(data.path(), "corta", "admin").is_err());
}

/// Almacén de claves que siempre falla (simula un Windows sin acceso al Credential Manager).
struct BrokenKeyStore;
impl nucleo_app::KeyStore for BrokenKeyStore {
    fn put(&self, _: &str, _: &nucleo_app::nucleo_db::DataKey) -> nucleo_app::AppResult<()> {
        Err(nucleo_app::AppError::KeyStore("sin acceso".into()))
    }
    fn get(&self, _: &str) -> nucleo_app::AppResult<nucleo_app::nucleo_db::DataKey> {
        Err(nucleo_app::AppError::KeyStore("sin acceso".into()))
    }
    fn delete(&self, _: &str) -> nucleo_app::AppResult<()> {
        Ok(())
    }
}

#[test]
fn crear_negocio_es_todo_o_nada() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(BrokenKeyStore)).unwrap();
    assert!(
        app.create_company("Mi Negocio", BusinessProfile::Emprendedor, "admin")
            .is_err()
    );
    assert!(app.list_companies().unwrap().is_empty());
    let leftovers = std::fs::read_dir(data.path().join("companies"))
        .unwrap()
        .count();
    assert_eq!(leftovers, 0, "no deben quedar carpetas a medio crear");
}
