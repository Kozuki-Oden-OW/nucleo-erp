//! Números de serie con su certificado de calibración, y el inicio con los registros del SII.

use nucleo_app::company::NewCustomer;
use nucleo_app::sales_ops::{EffectInput, LineInput, NewProduct, SaleInput};
use nucleo_app::serial_ops::{SerialFilter, SerialInput};
use nucleo_app::sii_start_ops::StartFile;
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

fn day(n: i64) -> String {
    rusqlite::Connection::open_in_memory()
        .unwrap()
        .query_row(
            "SELECT date('now', 'localtime', ?1)",
            [format!("{n:+} days")],
            |r| r.get(0),
        )
        .unwrap()
}

fn product(s: &mut CompanySession, name: &str) -> String {
    s.add_product(&NewProduct {
        sku: None,
        name: name.into(),
        unit: None,
        kind: "servicio".into(),
        price_minor: 50_000,
        cost_minor: None,
        taxable: Some(false),
        initial_stock_milli: None,
        category_uid: None,
        extra_category_uids: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap()
    .uid
}

fn sale(s: &mut CompanySession, customer: &str, product: &str, qty: i64) -> String {
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(customer.into()),
                issue_date: day(-3),
                lines: vec![LineInput {
                    product_uid: Some(product.into()),
                    description: "x".into(),
                    qty_milli: qty * 1000,
                    unit_price_minor: 50_000,
                    discount_ppm: 0,
                    taxable: false,
                    detail: None,
                }],
                notes: None,
                terms: None,
            },
            None,
        )
        .unwrap();
    s.effect_sale(
        &v.summary.uid,
        &EffectInput {
            mode: "contado".into(),
            method: "Transferencia".into(),
            due_date: None,
            account_uid: None,
        },
    )
    .unwrap();
    v.summary.uid
}

#[test]
fn series_con_certificado_y_venta() {
    let (_d, _a, mut s) = session();
    let tlog = product(&mut s, "Tlog 10EH");
    let otro = product(&mut s, "RC-5");
    let cliente = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur".into(),
            ..Default::default()
        })
        .unwrap()
        .uid;

    // Varias de una vez; las repetidas (aunque se escriban distinto) no se duplican.
    let r = s
        .add_serials(
            &tlog,
            &[
                "EF-724A-0011".into(),
                "EF-724A-0012".into(),
                " ef 724a 0012 ".into(),
                "".into(),
            ],
        )
        .unwrap();
    assert_eq!((r.added, r.duplicates.len()), (2, 1));
    let cert = s
        .save_serial(
            &SerialInput {
                product_uid: tlog.clone(),
                serial: "EF-724A-0013".into(),
                certificate_number: Some("CAL-2026-0456".into()),
                certificate_date: Some(day(-350)),
                certificate_due: Some(day(15)),
                certificate_lab: Some("Laboratorio acreditado".into()),
                certificate_file: Some("D:\\Certificados\\CAL-2026-0456.pdf".into()),
                ..Default::default()
            },
            None,
        )
        .unwrap();
    assert_eq!(
        (cert.status.as_str(), cert.due_in_days),
        ("en_stock", Some(15))
    );
    assert!(
        s.save_serial(
            &SerialInput {
                product_uid: tlog.clone(),
                serial: "ef724a0013".into(),
                ..Default::default()
            },
            None
        )
        .unwrap_err()
        .to_string()
        .contains("ya está registrada")
    );
    assert!(
        s.save_serial(
            &SerialInput {
                product_uid: tlog.clone(),
                serial: "X1".into(),
                certificate_date: Some(day(0)),
                certificate_due: Some(day(-1)),
                ..Default::default()
            },
            None
        )
        .is_err()
    );
    // La misma serie en otro producto sí se puede.
    s.add_serials(&otro, &["EF-724A-0011".into()]).unwrap();

    let all = s.serials(&SerialFilter::default()).unwrap();
    assert_eq!(all.len(), 4);
    let find = |s: &CompanySession, q: &str| {
        s.serials(&SerialFilter {
            query: Some(q.into()),
            ..Default::default()
        })
        .unwrap()
    };
    assert_eq!(find(&s, "724a-0013").len(), 1);
    assert_eq!(find(&s, "cal-2026").len(), 1);
    assert_eq!(find(&s, "tlog").len(), 3);

    // Venta de una unidad: admite una serie de ese producto, no dos, y no la de otro producto.
    let venta = sale(&mut s, &cliente, &tlog, 1);
    let uid_of = |s: &CompanySession, q: &str, p: &str| {
        s.serials(&SerialFilter {
            query: Some(q.into()),
            product_uid: Some(p.into()),
            ..Default::default()
        })
        .unwrap()[0]
            .uid
            .clone()
    };
    let s11 = uid_of(&s, "0011", &tlog);
    let s11_otro = uid_of(&s, "0011", &otro);
    assert!(
        s.assign_serials(&venta, &[s11_otro])
            .unwrap_err()
            .to_string()
            .contains("no incluye")
    );
    let en_venta = s
        .assign_serials(&venta, std::slice::from_ref(&cert.uid))
        .unwrap();
    assert_eq!(en_venta.len(), 1);
    assert_eq!(
        (
            en_venta[0].status.as_str(),
            en_venta[0].customer_name.as_deref(),
            en_venta[0].sold_at.as_deref()
        ),
        ("vendido", Some("Clínica Sur"), Some(day(-3).as_str()))
    );
    assert!(
        s.assign_serials(&venta, std::slice::from_ref(&s11))
            .unwrap_err()
            .to_string()
            .contains("ya tiene 1 serie")
    );
    // Todo o nada: una lista con una serie que no corresponde no deja ninguna asignada.
    let venta2 = sale(&mut s, &cliente, &tlog, 1);
    let s12 = uid_of(&s, "0012", &tlog);
    assert!(
        s.assign_serials(&venta2, &[s12.clone(), s11.clone()])
            .is_err()
    );
    assert!(
        s.serials(&SerialFilter {
            sale_uid: Some(venta2.clone()),
            ..Default::default()
        })
        .unwrap()
        .is_empty()
    );
    // Asignar otra vez la misma no cambia nada.
    assert_eq!(
        s.assign_serials(&venta, std::slice::from_ref(&cert.uid))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(s.customer_serials(&cliente).unwrap().len(), 1);
    assert!(s.delete_serial(&cert.uid).is_err());

    // El certificado vence en 15 días: aparece en lo que requiere atención.
    let alert = s
        .alerts()
        .unwrap()
        .into_iter()
        .find(|a| a.kind == "calibraciones")
        .expect("aviso de calibraciones");
    assert_eq!(alert.count, 1);
    assert!(
        alert.lines[0].label.contains("EF-724A-0013")
            && alert.lines[0].label.contains("Clínica Sur")
    );
    assert_eq!(
        s.serials(&SerialFilter {
            due_within_days: Some(30),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );

    // Devolución: la serie vuelve al stock y se puede dar de baja o eliminar.
    let back = s.release_serial(&cert.uid).unwrap();
    assert_eq!((back.status.as_str(), back.sale_uid), ("en_stock", None));
    assert!(
        s.alerts()
            .unwrap()
            .iter()
            .all(|a| a.kind != "calibraciones")
    );
    let baja = s
        .save_serial(
            &SerialInput {
                product_uid: tlog.clone(),
                serial: "EF-724A-0013".into(),
                status: Some("baja".into()),
                ..Default::default()
            },
            Some(&cert.uid),
        )
        .unwrap();
    assert_eq!(baja.status, "baja");
    assert!(
        s.assign_serials(&venta, std::slice::from_ref(&cert.uid))
            .is_err()
    );
    s.delete_serial(&s11).unwrap();
    assert_eq!(s.serials(&SerialFilter::default()).unwrap().len(), 3);
}

const VENTAS: &str = "Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total\n\
1;33;Del Giro;76123456-0;Clínica Sur SpA;101;05/10/2026;05/10/2026 10:00:00;;;0;100000;19000;119000\n\
2;33;Del Giro;76987654-5;Frigorífico Norte Ltda;102;12/10/2026;;;;0;200000;38000;238000\n\
3;34;Del Giro;76123456-0;Clínica Sur SpA;7;15/10/2026;;;;50000;0;0;50000\n\
4;61;Del Giro;76987654-5;Frigorífico Norte Ltda;3;20/10/2026;;;;0;10000;1900;11900\n\
5;39;Del Giro;;;;31/10/2026;;;;0;84034;15966;100000\n";

const COMPRAS: &str = "Nro;Tipo Doc;Tipo Compra;RUT Proveedor;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse;Monto Exento;Monto Neto;Monto IVA Recuperable;Monto Iva No Recuperable;Codigo IVA No Rec.;Monto Total;Monto Neto Activo Fijo;IVA Activo Fijo;IVA uso Comun;Impto. Sin Derecho a Credito;IVA No Retenido\n\
1;33;Del Giro;77111222-6;Importadora Uno SpA;1500;05/10/2026;06/10/2026;;0;100000;19000;0;;119000;0;0;0;0;0\n\
2;33;Del Giro;96500000-3;Courier Dos S.A.;77;10/10/2026;;;0;20000;3800;0;;23800;0;0;0;0;0\n";

#[test]
fn inicio_con_los_registros_del_sii() {
    let (_d, _a, mut s) = session();
    assert!(s.sii_start_import(&[]).is_err());
    let files = vec![
        StartFile {
            name: "RCV_VENTA_77334963-0_202610.csv".into(),
            text: VENTAS.into(),
        },
        StartFile {
            name: "RCV_COMPRA_REGISTRO_77334963-0_202610.csv".into(),
            text: COMPRAS.into(),
        },
        StartFile {
            name: "otra-cosa.csv".into(),
            text: "a;b;c\n1;2;3\n".into(),
        },
        StartFile {
            name: "RCV_VENTA_77334963-0_202610 (1).csv".into(),
            text: VENTAS.into(),
        },
    ];
    let r = s.sii_start_import(&files).unwrap();
    let status: Vec<&str> = r.files.iter().map(|f| f.status.as_str()).collect();
    assert_eq!(status, ["ok", "ok", "error", "error"]);
    assert_eq!(
        (
            r.files[0].direction.as_deref(),
            r.files[0].period.as_deref(),
            r.files[0].documents
        ),
        (Some("venta"), Some("2026-10"), 5)
    );
    assert_eq!(r.periods, ["2026-10"]);
    // Ventas: 119.000 + 238.000 + 50.000 + 100.000 − 11.900 de la nota de crédito.
    assert_eq!((r.sales_docs, r.sales_total_minor), (5, 495_100));
    assert_eq!((r.purchases_docs, r.purchases_total_minor), (2, 142_800));
    assert_eq!(
        (
            r.sales_imported,
            r.sales_existing,
            r.sales_errors,
            r.customers_created
        ),
        (4, 0, 0, 2),
        "{:?}",
        r.notes
    );
    assert_eq!(
        (r.suppliers_created, r.credit_notes, r.credit_notes_minor),
        (2, 1, 11_900)
    );
    assert!(r.notes.iter().any(|n| n.contains("nota(s) de crédito")));

    // Las ventas quedan como historial, con su cliente, y el F29 del mes parte con el registro.
    let ventas = s.search_customers("Clínica Sur", 5).unwrap();
    assert_eq!(ventas.len(), 1);
    let total: i64 = s
        .list_sales(&Default::default())
        .unwrap()
        .iter()
        .filter(|v| v.historical)
        .map(|v| v.total_minor)
        .sum();
    assert_eq!(total, 507_000);
    assert_eq!(s.search_suppliers("Importadora", 5).unwrap().len(), 1);

    // Repetir no duplica nada.
    let again = s.sii_start_import(&files[..2]).unwrap();
    assert_eq!(
        (
            again.sales_imported,
            again.sales_existing,
            again.customers_created,
            again.suppliers_created
        ),
        (0, 4, 0, 0)
    );
}
