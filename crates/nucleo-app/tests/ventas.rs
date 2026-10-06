//! Fase 5 · Ventas: cotización → venta → efectuada → pagos → documentada, factura interna,
//! stock y costo, cuentas por cobrar, anulación y permisos.

use nucleo_app::core_ops::{BusinessPatch, NewUser};
use nucleo_app::sales_ops::{
    EffectInput, ExternalRefInput, LineInput, NewProduct, QuoteInput, SaleFilter, SaleInput,
};
use nucleo_app::{
    AppError, AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer,
};

fn session(profile: BusinessProfile) -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app.create_company("Ferretería Los Andes", profile).unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn product(s: &mut CompanySession, name: &str, price: i64, cost: i64, stock_units: i64) -> String {
    s.add_product(&NewProduct {
        sku: None,
        name: name.into(),
        unit: None,
        kind: "producto".into(),
        price_minor: price,
        cost_minor: Some(cost),
        taxable: Some(true),
        initial_stock_milli: Some(stock_units * 1000),
    })
    .unwrap()
    .uid
}

fn line(
    product_uid: Option<&str>,
    desc: &str,
    units: i64,
    price: i64,
    discount_pct: i64,
) -> LineInput {
    LineInput {
        product_uid: product_uid.map(String::from),
        description: desc.into(),
        qty_milli: units * 1000,
        unit_price_minor: price,
        discount_ppm: discount_pct * 10_000,
        taxable: true,
    }
}

const HOY: &str = "2026-10-06";

#[test]
fn ciclo_completo_cotizacion_a_venta_cerrada() {
    let (_d, _app, mut s) = session(BusinessProfile::Negocio);
    // Tasa de EJEMPLO anotada por el usuario (no es un valor normativo del código).
    let b = s
        .update_business(&BusinessPatch {
            tax_rate_user_ppm: Some(100_000),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(b.tax_rate_ppm, Some(100_000));
    assert!(b.tax_rule_source.unwrap().contains("anotada"));
    assert!(b.documentation_reminder, "negocio: recordatorio activo");

    let martillo = product(&mut s, "Martillo carpintero", 10_000, 6_000, 10);
    let found = s.search_products("martil", 10).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].on_hand_milli, 10_000);
    assert_eq!(found[0].cost_e4, 60_000_000);

    let cliente = s
        .add_customer(&NewCustomer {
            name: "Constructora Sur".into(),
            rut: Some("76.543.210-3".into()),
            ..Default::default()
        })
        .unwrap();

    // Cotización con descuento: 3 × 10.000 − 10 % = 27.000 neto + 10 % = 29.700.
    let q = s
        .save_quote(
            &QuoteInput {
                customer_uid: Some(cliente.uid.clone()),
                prospect_name: None,
                issue_date: HOY.into(),
                valid_until: Some("2026-10-21".into()),
                lines: vec![line(Some(&martillo), "Martillo carpintero", 3, 10_000, 10)],
                notes: None,
            },
            None,
        )
        .unwrap();
    assert_eq!(q.summary.number, "COT-000001");
    assert_eq!(q.totals.net_minor, 27_000);
    assert_eq!(q.totals.tax_minor, 2_700);
    assert_eq!(q.totals.total_minor, 29_700);
    let q = s.set_quote_status(&q.summary.uid, "aceptada").unwrap();
    assert_eq!(q.summary.status, "aceptada");

    // Convertir sin volver a digitar.
    let v = s.convert_quote(&q.summary.uid).unwrap();
    assert_eq!(v.summary.number, "VEN-000001");
    assert_eq!(v.summary.commercial_state, "aceptada");
    assert_eq!(v.quote_number.as_deref(), Some("COT-000001"));
    assert_eq!(v.lines.len(), 1);
    assert!(
        s.convert_quote(&q.summary.uid).is_err(),
        "no se convierte dos veces"
    );
    assert_eq!(
        s.quote(&q.summary.uid).unwrap().sale_number.as_deref(),
        Some("VEN-000001")
    );

    // Efectuar a crédito: exige cliente y fecha; descuenta stock y fija costo.
    assert!(
        s.effect_sale(
            &v.summary.uid,
            &EffectInput {
                mode: "credito".into(),
                method: "".into(),
                due_date: None
            }
        )
        .is_err()
    );
    let v = s
        .effect_sale(
            &v.summary.uid,
            &EffectInput {
                mode: "credito".into(),
                method: "".into(),
                due_date: Some("2026-11-05".into()),
            },
        )
        .unwrap();
    assert_eq!(v.summary.commercial_state, "efectuada");
    assert_eq!(v.summary.payment_state, "sin_pago");
    assert_eq!(v.summary.documentation_state, "pendiente");
    assert_eq!(v.cost_minor, 18_000);
    assert_eq!(v.lines[0].unit_cost_e4, Some(60_000_000));
    assert_eq!(
        s.search_products("martillo", 10).unwrap()[0].on_hand_milli,
        7_000
    );
    assert_eq!(
        s.list_sales(&SaleFilter {
            view: Some("por_cobrar".into()),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        s.list_sales(&SaleFilter {
            view: Some("pendientes_doc".into()),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );

    // La venta efectuada no se edita.
    assert!(
        s.save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: None,
                issue_date: HOY.into(),
                lines: vec![line(None, "x", 1, 1, 0)],
                notes: None
            },
            Some(&v.summary.uid),
        )
        .is_err()
    );

    // Abono y pago final.
    assert!(
        s.register_payment(&v.summary.uid, 40_000, "Efectivo", HOY)
            .is_err(),
        "no supera el saldo"
    );
    let v = s
        .register_payment(&v.summary.uid, 10_000, "Transferencia", HOY)
        .unwrap();
    assert_eq!(v.summary.payment_state, "abonada");
    let v = s
        .register_payment(&v.summary.uid, 19_700, "Efectivo", "2026-10-10")
        .unwrap();
    assert_eq!(v.summary.payment_state, "pagada");
    assert_eq!(
        v.summary.commercial_state, "efectuada",
        "falta documentar: no se cierra"
    );
    assert_eq!(v.payments.len(), 2);
    assert_eq!(v.payments[0].method, "Transferencia");

    // Documentar (fuera de NÚCLEO) → se cierra sola.
    let v = s
        .mark_documented(
            &v.summary.uid,
            &ExternalRefInput {
                doc_kind: Some("Factura".into()),
                external_number: Some("563".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(v.summary.documentation_state, "documentada");
    assert_eq!(v.summary.commercial_state, "cerrada");
    let kinds: Vec<_> = v.chain.iter().map(|c| c.kind.as_str()).collect();
    assert_eq!(kinds, ["COT", "VEN", "PAG", "PAG", "REF"]);
    assert!(
        v.timeline
            .iter()
            .any(|t| t.text.contains("Cerrada automáticamente"))
    );

    // Ficha del cliente.
    let c = s.customer_detail(&cliente.uid).unwrap();
    assert_eq!(c.sales_count, 1);
    assert_eq!(c.revenue_minor, 29_700);
    assert_eq!(c.receivable_minor, 0);

    // Anular una venta cerrada (con motivo) devuelve el stock y anula sus cobros.
    assert!(s.void_sale(&v.summary.uid, "  ").is_err());
    let v = s
        .void_sale(&v.summary.uid, "Cliente devolvió todo")
        .unwrap();
    assert_eq!(v.summary.commercial_state, "anulada");
    assert!(v.payments.is_empty());
    assert_eq!(
        s.search_products("martillo", 10).unwrap()[0].on_hand_milli,
        10_000
    );
    assert!(s.verify_audit().unwrap().ok);
}

#[test]
fn factura_interna_al_contado_y_emprendedor_sin_impuesto() {
    let (_d, _app, mut s) = session(BusinessProfile::Emprendedor);
    let b = s.business().unwrap();
    assert!(!b.tax_enabled && !b.documentation_reminder);
    let servicio = s
        .add_product(&NewProduct {
            sku: Some("SRV-1".into()),
            name: "Instalación".into(),
            unit: None,
            kind: "servicio".into(),
            price_minor: 25_000,
            cost_minor: None,
            taxable: Some(true),
            initial_stock_milli: None,
        })
        .unwrap();
    assert_eq!(servicio.unit, "sv");
    let fv = s
        .save_sale(
            &SaleInput {
                doc_type: "FV".into(),
                customer_uid: None,
                issue_date: HOY.into(),
                lines: vec![line(Some(&servicio.uid), "Instalación", 2, 25_000, 0)],
                notes: Some("Domicilio".into()),
            },
            None,
        )
        .unwrap();
    assert_eq!(fv.summary.number, "FV-000001");
    assert_eq!(fv.totals.tax_minor, 0, "sin impuesto: todo exento");
    assert_eq!(fv.totals.exempt_minor, 50_000);
    // Borrador editable.
    let fv = s
        .save_sale(
            &SaleInput {
                doc_type: "FV".into(),
                customer_uid: None,
                issue_date: HOY.into(),
                lines: vec![line(Some(&servicio.uid), "Instalación", 3, 25_000, 0)],
                notes: None,
            },
            Some(&fv.summary.uid),
        )
        .unwrap();
    assert_eq!(fv.totals.total_minor, 75_000);
    assert!(
        s.effect_sale(
            &fv.summary.uid,
            &EffectInput {
                mode: "credito".into(),
                method: "".into(),
                due_date: Some(HOY.into())
            }
        )
        .is_err(),
        "crédito exige cliente"
    );
    let fv = s
        .effect_sale(
            &fv.summary.uid,
            &EffectInput {
                mode: "contado".into(),
                method: "Tarjeta de débito".into(),
                due_date: None,
            },
        )
        .unwrap();
    assert_eq!(fv.summary.payment_state, "pagada");
    assert_eq!(fv.summary.documentation_state, "no_aplica");
    assert_eq!(fv.summary.commercial_state, "cerrada");
    assert_eq!(fv.payment_method.as_deref(), Some("Tarjeta de débito"));
    assert_eq!(fv.cost_minor, 0, "servicio sin stock ni costo");
    assert_eq!(fv.payments[0].number, "PAG-000001");
}

#[test]
fn permisos_de_venta() {
    let (_d, _app, mut s) = session(BusinessProfile::Empresa);
    s.set_password(&s.current_user().unwrap().uid, Some("clave-dueno-1"))
        .unwrap();
    s.create_user(&NewUser {
        username: "bodega".into(),
        display_name: "Bodeguero".into(),
        roles: vec!["bodega".into()],
        password: Some("clave-bodega-1".into()),
    })
    .unwrap();
    s.logout().unwrap();
    s.login("bodega", "clave-bodega-1").unwrap();
    let r = s.save_sale(
        &SaleInput {
            doc_type: "VEN".into(),
            customer_uid: None,
            issue_date: HOY.into(),
            lines: vec![line(None, "Saco", 1, 100, 0)],
            notes: None,
        },
        None,
    );
    assert!(matches!(r, Err(AppError::Forbidden(_))));
    assert!(
        s.list_sales(&SaleFilter::default()).is_ok(),
        "bodega ve las ventas"
    );
    assert!(matches!(
        s.register_payment("x", 1, "Efectivo", HOY),
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        s.void_sale("x", "motivo"),
        Err(AppError::Forbidden(_))
    ));
}

#[test]
fn editar_producto_y_cliente() {
    use nucleo_app::sales_ops::ProductPatch;
    let (_d, _app, mut s) = session(BusinessProfile::Negocio);
    let p = product(&mut s, "Cinta aisladora", 1_200, 600, 5);
    let sku = s.search_products("cinta", 5).unwrap()[0].sku.clone();
    let e = s
        .update_product(
            &p,
            &ProductPatch {
                name: "Cinta aisladora 3M".into(),
                sku: sku.clone(),
                unit: "un".into(),
                price_minor: 1_490,
                taxable: true,
                min_milli: 3_000,
            },
        )
        .unwrap();
    assert_eq!(e.price_minor, 1_490);
    assert_eq!(e.min_milli, 3_000);
    assert_eq!(e.on_hand_milli, 5_000, "el stock no cambia al editar");
    assert!(
        s.update_product(
            &p,
            &ProductPatch {
                name: "x".into(),
                sku,
                unit: "zz".into(),
                price_minor: 1,
                taxable: true,
                min_milli: 0
            }
        )
        .is_err()
    );
    let c = s
        .add_customer(&NewCustomer {
            name: "Juan".into(),
            ..Default::default()
        })
        .unwrap();
    let c = s
        .update_customer(
            &c.uid,
            &NewCustomer {
                name: "Juan Pérez".into(),
                rut: Some("12.345.678-5".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(c.name, "Juan Pérez");
    assert_eq!(c.rut.as_deref(), Some("12345678-5"));
    assert!(s.verify_audit().unwrap().ok);
}
