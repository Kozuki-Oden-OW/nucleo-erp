//! Fase S1 de la sincronización (docs/SINCRONIZACION.md): el celular se empareja con el código que
//! muestra el computador y sincroniza por la red local con un canal cifrado. Aquí «la red» es la
//! propia máquina (127.0.0.1), con un servidor real y conexiones reales.

use nucleo_app::sales_ops::{NewProduct, SaleFilter};
use nucleo_app::sync_net::{SyncHost, SyncServer, encode_code, parse_code};
use nucleo_app::sync_ops::{OpLine, QuickSaleOp};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};

type Shared = Arc<Mutex<Option<CompanySession>>>;

struct Pc {
    _dir: tempfile::TempDir,
    _app: AppService,
    session: Shared,
    server: SyncServer,
}

struct Cel {
    _dir: tempfile::TempDir,
    _app: AppService,
    s: CompanySession,
}

fn session(role: &str) -> (tempfile::TempDir, AppService, CompanySession) {
    let dir = tempfile::tempdir().unwrap();
    let mut app = AppService::open(dir.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Ferretería Los Andes", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    s.sync_set_role(role).unwrap();
    (dir, app, s)
}

fn pc() -> Pc {
    let (dir, app, s) = session("escritorio");
    let session: Shared = Arc::new(Mutex::new(Some(s)));
    let host: Arc<dyn SyncHost> = session.clone();
    let bind: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let server = SyncServer::start(host, bind).unwrap();
    Pc {
        _dir: dir,
        _app: app,
        session,
        server,
    }
}

fn cel() -> Cel {
    let (dir, app, s) = session("celular");
    Cel {
        _dir: dir,
        _app: app,
        s,
    }
}

impl Pc {
    fn with<T>(&self, f: impl FnOnce(&mut CompanySession) -> T) -> T {
        f(self.session.lock().unwrap().as_mut().unwrap())
    }
}

fn product(s: &mut CompanySession, name: &str, price: i64, stock: i64) -> String {
    s.add_product(&NewProduct {
        sku: None,
        name: name.into(),
        unit: None,
        kind: "producto".into(),
        price_minor: price,
        cost_minor: Some(price / 2),
        taxable: Some(true),
        initial_stock_milli: Some(stock * 1000),
        category_uid: None,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap()
    .uid
}

#[test]
fn empareja_con_el_codigo_y_sincroniza_por_la_red() {
    let pc = pc();
    let mut cel = cel();
    let taladro = pc.with(|s| product(s, "Taladro percutor 18 V", 64_990, 14));
    pc.with(|s| product(s, "Martillo carpintero", 6_990, 31));

    // El computador muestra el código; el celular lo escribe.
    let code = pc.server.begin_pairing().unwrap();
    assert!(pc.server.pairing_open());
    assert_eq!(code.code.split('-').count(), 8);
    let paired = cel.s.sync_join(&code.code, "Celular de Ana").unwrap();
    assert_eq!(paired.business, "Ferretería Los Andes");
    assert_eq!(paired.address, pc.server.address().to_string());
    assert!(!pc.server.pairing_open(), "el código es de un solo uso");

    // Ambos lados se conocen y tienen llave; la llave no sale en la lista de dispositivos.
    let (pc_uid, cel_uid) = (
        pc.with(|s| s.sync_device().unwrap().0),
        cel.s.sync_device().unwrap().0,
    );
    let peers = pc.with(|s| s.sync_peers().unwrap());
    assert_eq!(peers.len(), 1);
    assert_eq!(
        (
            peers[0].device_uid.as_str(),
            peers[0].name.as_str(),
            peers[0].has_key
        ),
        (cel_uid.as_str(), "Celular de Ana", true)
    );
    let mine = cel.s.sync_peers().unwrap();
    assert_eq!(mine[0].device_uid, pc_uid);
    assert!(mine[0].has_key && mine[0].address.is_some());
    let k_pc = pc.with(|s| s.sync_peer_key(&cel_uid).unwrap().unwrap());
    let k_cel = cel.s.sync_peer_key(&pc_uid).unwrap().unwrap();
    assert_eq!(k_pc.len(), 32);
    assert_eq!(k_pc, k_cel);

    // Primera sincronización: el celular recibe las fichas.
    let first = cel.s.sync_now(None).unwrap();
    assert!(first.local.changes.created >= 2, "{first:?}");
    assert_eq!(
        pc.with(|s| s.sync_digest().unwrap()),
        cel.s.sync_digest().unwrap()
    );

    // Venta rápida hecha en terreno: viaja, el computador la crea y la confirma en la misma vuelta.
    cel.s
        .queue_quick_sale(&QuickSaleOp {
            customer_uid: None,
            issue_date: "2026-11-23".into(),
            lines: vec![OpLine {
                product_uid: Some(taladro),
                description: "Taladro percutor 18 V".into(),
                qty_milli: 1000,
                unit_price_minor: 64_990,
                discount_ppm: 0,
                taxable: true,
            }],
            mode: "contado".into(),
            method: "Efectivo".into(),
            due_date: None,
            notes: None,
        })
        .unwrap();
    let second = cel.s.sync_now(None).unwrap();
    assert_eq!(second.sent_ops, 1);
    assert_eq!(second.remote.ops_applied, 1, "{second:?}");
    assert_eq!(second.local.ops_confirmed, 1);
    assert!(cel.s.sync_outbox().unwrap().is_empty());
    let sales = pc.with(|s| s.list_sales(&SaleFilter::default()).unwrap());
    assert_eq!(sales.len(), 1);

    // Repetir no duplica nada.
    let third = cel.s.sync_now(None).unwrap();
    assert_eq!((third.sent_ops, third.remote.ops_applied), (0, 0));
    assert_eq!(
        pc.with(|s| s.list_sales(&SaleFilter::default()).unwrap())
            .len(),
        1
    );
}

#[test]
fn un_codigo_equivocado_no_entra_y_el_bueno_sirve_una_sola_vez() {
    let pc = pc();
    let mut cel = cel();
    let code = pc.server.begin_pairing().unwrap();

    // Mismo computador, otro secreto (alguien que adivina).
    let target = parse_code(&code.code).unwrap();
    let mut other = target.secret;
    other[0] ^= 0xff;
    let wrong = encode_code(target.addr, &other);
    let e = cel.s.sync_join(&wrong, "Intruso").unwrap_err().to_string();
    assert!(e.contains("cerró la conexión"), "{e}");
    assert!(pc.with(|s| s.sync_peers().unwrap()).is_empty());

    // El código bueno sigue vigente tras un intento fallido…
    cel.s.sync_join(&code.code, "Celular de Ana").unwrap();
    // …y no se puede volver a usar.
    let mut otro = self::cel();
    let e = otro
        .s
        .sync_join(&code.code, "Otro celular")
        .unwrap_err()
        .to_string();
    assert!(e.contains("no hay un emparejamiento abierto"), "{e}");
    assert_eq!(pc.with(|s| s.sync_peers().unwrap()).len(), 1);
}

#[test]
fn cinco_intentos_fallidos_cierran_el_emparejamiento() {
    let pc = pc();
    let mut cel = cel();
    let code = pc.server.begin_pairing().unwrap();
    let target = parse_code(&code.code).unwrap();
    for i in 0..5u8 {
        let mut other = target.secret;
        other[1] ^= i + 1;
        assert!(
            cel.s
                .sync_join(&encode_code(target.addr, &other), "Intruso")
                .is_err()
        );
    }
    assert!(!pc.server.pairing_open());
    assert!(cel.s.sync_join(&code.code, "Celular de Ana").is_err());
}

#[test]
fn un_celular_quitado_o_desconocido_no_sincroniza() {
    let pc = pc();
    let mut cel = cel();
    let code = pc.server.begin_pairing().unwrap();
    cel.s.sync_join(&code.code, "Celular de Ana").unwrap();
    cel.s.sync_now(None).unwrap();

    let cel_uid = cel.s.sync_device().unwrap().0;
    pc.with(|s| s.sync_revoke(&cel_uid).unwrap());
    let e = cel.s.sync_now(None).unwrap_err().to_string();
    assert!(e.contains("no está emparejado"), "{e}");

    // Sin emparejar: ni siquiera intenta conectarse.
    let mut nuevo = self::cel();
    let e = nuevo.s.sync_now(None).unwrap_err().to_string();
    assert!(e.contains("aún no está emparejado"), "{e}");
}

#[test]
fn con_el_computador_sin_negocio_abierto_se_explica() {
    let pc = pc();
    let mut cel = cel();
    let code = pc.server.begin_pairing().unwrap();
    let closed = pc.session.lock().unwrap().take();
    let e = cel
        .s
        .sync_join(&code.code, "Celular de Ana")
        .unwrap_err()
        .to_string();
    assert!(e.contains("no tiene un negocio abierto"), "{e}");
    drop(closed);
}

#[test]
fn lo_que_viaja_por_la_red_va_cifrado() {
    // Un tercero en la misma red que habla con el servidor sin conocer ningún secreto: solo recibe
    // el saludo (una llave pública de un solo uso) y nada del negocio.
    let pc = pc();
    pc.with(|s| product(s, "Taladro percutor 18 V", 64_990, 14));
    pc.server.begin_pairing().unwrap();
    let mut t = TcpStream::connect(SocketAddr::V4(pc.server.address())).unwrap();
    t.set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .unwrap();
    let hello = serde_json::json!({ "nucleo": 1, "mode": "pair", "device": "", "eph": data_encoding::BASE64.encode(&[9u8; 32]) })
        .to_string();
    t.write_all(&(hello.len() as u32).to_be_bytes()).unwrap();
    t.write_all(hello.as_bytes()).unwrap();
    // Mensaje «sellado» inventado: el servidor lo descarta y corta.
    let junk = [0u8; 48];
    t.write_all(&(junk.len() as u32).to_be_bytes()).unwrap();
    t.write_all(&junk).unwrap();
    let mut all = Vec::new();
    let _ = t.read_to_end(&mut all);
    let text = String::from_utf8_lossy(&all);
    assert!(text.contains("\"eph\""), "{text}");
    assert!(!text.contains("Taladro") && !text.contains("Ferretería"));
    assert!(pc.with(|s| s.sync_peers().unwrap()).is_empty());
}
