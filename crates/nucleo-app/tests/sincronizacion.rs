//! Fase S0 de la sincronización (docs/SINCRONIZACION.md): dos bases quedan iguales intercambiando
//! paquetes; los choques se resuelven campo por campo con el reloj lógico híbrido; las operaciones
//! del celular se aplican una sola vez en el computador y salen de la cola al confirmarse.

use nucleo_app::company::NewCustomer;
use nucleo_app::purchase_ops::NewSupplier;
use nucleo_app::sales_ops::{NewProduct, SaleFilter};
use nucleo_app::sync_ops::{CollectionOp, ExpenseOp, OpLine, QuickSaleOp, SyncPackage};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use std::{thread, time::Duration};

struct Device {
    _dir: tempfile::TempDir,
    _app: AppService,
    s: CompanySession,
    uid: String,
}

fn device(role: &str) -> Device {
    let dir = tempfile::tempdir().unwrap();
    let mut app = AppService::open(dir.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Ferretería Los Andes", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    s.sync_set_role(role).unwrap();
    let uid = s.sync_device().unwrap().0;
    Device {
        _dir: dir,
        _app: app,
        s,
        uid,
    }
}

/// Computador y celular emparejados.
fn pair() -> (Device, Device) {
    let mut pc = device("escritorio");
    let mut cel = device("celular");
    pc.s.sync_pair(&cel.uid, "Celular de Ana", "celular")
        .unwrap();
    cel.s
        .sync_pair(&pc.uid, "Computador de la oficina", "escritorio")
        .unwrap();
    (pc, cel)
}

/// Lleva lo de `a` a `b` pasando por JSON, como el archivo o la conexión.
fn send(a: &mut Device, b: &mut Device) -> nucleo_app::sync_ops::SyncReport {
    let pkg = a.s.sync_export(&b.uid).unwrap();
    let wire = serde_json::to_string(&pkg).unwrap();
    let back: SyncPackage = serde_json::from_str(&wire).unwrap();
    b.s.sync_import(&back).unwrap()
}

fn product(
    s: &mut CompanySession,
    name: &str,
    price: i64,
    stock: i64,
    category: Option<String>,
) -> String {
    s.add_product(&NewProduct {
        sku: None,
        name: name.into(),
        unit: None,
        kind: "producto".into(),
        price_minor: price,
        cost_minor: Some(price / 2),
        taxable: Some(true),
        initial_stock_milli: Some(stock * 1000),
        category_uid: category,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap()
    .uid
}

fn customer(s: &mut CompanySession, name: &str, rut: Option<&str>) -> String {
    s.add_customer(&NewCustomer {
        name: name.into(),
        rut: rut.map(Into::into),
        ..Default::default()
    })
    .unwrap()
    .uid
}

fn edit_customer(s: &mut CompanySession, uid: &str, f: impl FnOnce(&mut NewCustomer)) {
    let c = s
        .search_customers("", 500)
        .unwrap()
        .into_iter()
        .find(|c| c.uid == uid)
        .unwrap();
    let mut input = NewCustomer {
        name: c.name.clone(),
        rut: c.rut.clone(),
        email: c.email.clone(),
        phone: c.phone.clone(),
        profile: Default::default(),
    };
    f(&mut input);
    s.update_customer(uid, &input).unwrap();
}

fn field(d: &Device, uid: &str, f: &str) -> serde_json::Value {
    d.s.sync_digest()
        .unwrap()
        .into_iter()
        .find(|(_, u, name, _)| u == uid && name == f)
        .map(|x| x.3)
        .unwrap()
}

#[test]
fn la_primera_sincronizacion_deja_ambas_bases_iguales() {
    let (mut pc, mut cel) = pair();
    let cat =
        pc.s.save_category(None, "Herramientas eléctricas")
            .unwrap()
            .into_iter()
            .find(|c| c.name == "Herramientas eléctricas")
            .unwrap()
            .uid;
    let taladro = product(
        &mut pc.s,
        "Taladro percutor 18 V",
        64_990,
        14,
        Some(cat.clone()),
    );
    product(&mut pc.s, "Martillo carpintero", 6_990, 31, None);
    customer(&mut pc.s, "Constructora Sur Ltda.", Some("76266225-6"));
    pc.s.add_supplier(&NewSupplier {
        name: "Distribuidora Ferretera".into(),
        rut: None,
        email: None,
        phone: None,
        payment_terms_days: Some(30),
    })
    .unwrap();

    let r = send(&mut pc, &mut cel);
    assert!(r.changes.created >= 5, "{r:?}");
    assert_eq!(r.changes.conflicts, 0);
    assert_eq!(pc.s.sync_digest().unwrap(), cel.s.sync_digest().unwrap());
    // La referencia a la categoría viajó por uid y quedó resuelta en el celular.
    assert_eq!(
        field(&cel, &taladro, "category_uid"),
        serde_json::json!(cat)
    );

    // De vuelta no cambia nada y ambos siguen iguales.
    let back = send(&mut cel, &mut pc);
    assert_eq!(back.changes.applied, 0);
    assert_eq!(pc.s.sync_digest().unwrap(), cel.s.sync_digest().unwrap());

    // Lo ya confirmado no se vuelve a enviar.
    send(&mut pc, &mut cel);
    let again = pc.s.sync_export(&cel.uid).unwrap();
    assert!(
        !again.full && again.changes.is_empty(),
        "{:?}",
        again.changes.len()
    );
}

#[test]
fn los_choques_se_resuelven_campo_por_campo_y_ambos_convergen() {
    let (mut pc, mut cel) = pair();
    let c = customer(&mut pc.s, "Antonia Reyes", None);
    send(&mut pc, &mut cel);
    send(&mut cel, &mut pc);

    // Cambios concurrentes sin sincronizar: el computador cambia el nombre y el teléfono; después el
    // celular cambia el teléfono (más reciente) y el correo.
    edit_customer(&mut pc.s, &c, |x| {
        x.name = "Antonia Reyes Soto".into();
        x.phone = Some("+56 9 1111 1111".into());
    });
    thread::sleep(Duration::from_millis(5));
    edit_customer(&mut cel.s, &c, |x| {
        x.phone = Some("+56 9 2222 2222".into());
        x.email = Some("antonia@ejemplo.cl".into());
    });

    // Ambos paquetes se arman antes de recibir el del otro (verdadera concurrencia).
    let from_pc = pc.s.sync_export(&cel.uid).unwrap();
    let from_cel = cel.s.sync_export(&pc.uid).unwrap();
    pc.s.sync_import(&from_cel).unwrap();
    cel.s.sync_import(&from_pc).unwrap();

    assert_eq!(pc.s.sync_digest().unwrap(), cel.s.sync_digest().unwrap());
    assert_eq!(
        field(&pc, &c, "name"),
        serde_json::json!("Antonia Reyes Soto")
    );
    assert_eq!(
        field(&pc, &c, "phone"),
        serde_json::json!("+56 9 2222 2222")
    );
    assert_eq!(
        field(&pc, &c, "email"),
        serde_json::json!("antonia@ejemplo.cl")
    );

    // Un tercer intercambio no cambia nada.
    let r1 = send(&mut pc, &mut cel);
    let r2 = send(&mut cel, &mut pc);
    assert_eq!(r1.changes.applied + r2.changes.applied, 0);
}

#[test]
fn las_operaciones_del_celular_se_aplican_una_sola_vez() {
    let (mut pc, mut cel) = pair();
    let taladro = product(&mut pc.s, "Taladro percutor 18 V", 50_000, 10, None);
    let cliente = customer(&mut pc.s, "Gasfitería Rápida", None);
    send(&mut pc, &mut cel);

    // En terreno: una venta al contado, una a crédito, un cobro de esa venta y un gasto.
    let line = OpLine {
        product_uid: Some(taladro.clone()),
        description: "Taladro percutor 18 V".into(),
        qty_milli: 1000,
        unit_price_minor: 50_000,
        discount_ppm: 0,
        taxable: true,
    };
    let today = "2026-10-24".to_string();
    cel.s
        .queue_quick_sale(&QuickSaleOp {
            customer_uid: None,
            issue_date: today.clone(),
            lines: vec![line.clone()],
            mode: "contado".into(),
            method: "Efectivo".into(),
            due_date: None,
            notes: None,
        })
        .unwrap();
    let credito = cel
        .s
        .queue_quick_sale(&QuickSaleOp {
            customer_uid: Some(cliente.clone()),
            issue_date: today.clone(),
            lines: vec![OpLine {
                qty_milli: 2000,
                ..line
            }],
            mode: "credito".into(),
            method: String::new(),
            due_date: Some("2026-11-24".into()),
            notes: None,
        })
        .unwrap();
    cel.s
        .queue_collection(&CollectionOp {
            sale_ref: credito,
            amount_minor: 30_000,
            method: "Transferencia".into(),
            date: today.clone(),
        })
        .unwrap();
    cel.s
        .queue_expense(&ExpenseOp {
            category: "Combustible".into(),
            date: today,
            description: "Bencina camioneta".into(),
            total_minor: 25_000,
            tax_included: true,
            paid_method: Some("Efectivo".into()),
            due_date: None,
            notes: None,
        })
        .unwrap();
    assert_eq!(cel.s.sync_outbox().unwrap().len(), 4);
    assert!(
        cel.s
            .queue_quick_sale(&QuickSaleOp {
                customer_uid: None,
                issue_date: "2026-10-24".into(),
                lines: vec![],
                mode: "contado".into(),
                method: "Efectivo".into(),
                due_date: None,
                notes: None
            })
            .is_err()
    );

    let sales_before =
        pc.s.list_sales(&SaleFilter {
            query: None,
            view: None,
        })
        .unwrap()
        .len();
    let pkg = cel.s.sync_export(&pc.uid).unwrap();
    let r = pc.s.sync_import(&pkg).unwrap();
    assert_eq!(r.ops_applied, 4, "{:?}", r.ops_failed);
    let sales =
        pc.s.list_sales(&SaleFilter {
            query: None,
            view: None,
        })
        .unwrap();
    assert_eq!(sales.len(), sales_before + 2);
    let cred = sales
        .iter()
        .find(|s| s.customer_name == "Gasfitería Rápida")
        .unwrap();
    assert_eq!(cred.commercial_state, "efectuada");
    assert_eq!(cred.payment_state, "abonada");
    // El stock bajó con las dos ventas (1 + 2 taladros).
    let stock = pc.s.search_products("Taladro", 5).unwrap()[0].on_hand_milli;
    assert_eq!(stock, 7_000);

    // El mismo paquete otra vez (reintento, archivo duplicado): nada se repite.
    let r = pc.s.sync_import(&pkg).unwrap();
    assert_eq!((r.ops_applied, r.ops_repeated), (0, 4));
    assert_eq!(
        pc.s.list_sales(&SaleFilter {
            query: None,
            view: None
        })
        .unwrap()
        .len(),
        sales_before + 2
    );

    // El computador confirma y la cola del celular queda vacía.
    let r = send(&mut pc, &mut cel);
    assert_eq!(r.ops_confirmed, 4);
    assert!(cel.s.sync_outbox().unwrap().is_empty());
}

#[test]
fn el_mismo_rut_creado_en_ambos_equipos_se_une_en_una_ficha() {
    let (mut pc, mut cel) = pair();
    let en_pc = customer(&mut pc.s, "Juan Pérez", Some("12345678-5"));
    thread::sleep(Duration::from_millis(5));
    let en_cel = customer(&mut cel.s, "Juan Pérez Rojas", Some("12345678-5"));
    let r = send(&mut cel, &mut pc);
    assert_eq!(r.changes.conflicts, 1, "{r:?}");
    let conflicts = pc.s.sync_conflicts().unwrap();
    assert_eq!(
        (conflicts[0].1.as_str(), conflicts[0].2.as_str()),
        (en_pc.as_str(), "rut")
    );
    // Una sola ficha en el computador, con el nombre más reciente (el del celular).
    let juanes = pc.s.search_customers("Juan", 10).unwrap();
    assert_eq!(juanes.len(), 1);
    assert_eq!(juanes[0].uid, en_pc);
    assert_eq!(juanes[0].name, "Juan Pérez Rojas");
    // El celular adopta el uid del computador y ambos quedan iguales.
    send(&mut pc, &mut cel);
    let en_cel_ahora = cel.s.search_customers("Juan", 10).unwrap();
    assert_eq!(en_cel_ahora.len(), 1);
    assert_eq!(en_cel_ahora[0].uid, en_pc);
    assert_ne!(en_cel, en_pc);
    assert_eq!(pc.s.sync_digest().unwrap(), cel.s.sync_digest().unwrap());
}

#[test]
fn solo_se_acepta_lo_de_dispositivos_emparejados() {
    let (mut pc, mut cel) = pair();
    let mut extraño = device("celular");
    pc.s.sync_pair(&extraño.uid, "Otro celular", "celular")
        .unwrap();
    extraño.s.sync_pair(&pc.uid, "PC", "escritorio").unwrap();

    // Un paquete dirigido a otro dispositivo no se aplica.
    let pkg = pc.s.sync_export(&cel.uid).unwrap();
    assert!(extraño.s.sync_import(&pkg).is_err());

    // Un celular quitado deja de ser aceptado.
    pc.s.sync_revoke(&cel.uid).unwrap();
    let pkg = cel.s.sync_export(&pc.uid).unwrap();
    assert!(pc.s.sync_import(&pkg).is_err());
    assert!(pc.s.sync_export(&cel.uid).is_err());
}
