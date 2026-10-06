//! Fase 9 (NÚCLEO COMEX): carpeta de importación de punta a punta con los números del caso
//! golden "Marítimo FOB" (`golden/comex.json`). Tasas de EJEMPLO.

use nucleo_app::comex_ops::{ImportCostInput, ImportInput, ImportItemInput, ImportReceiveLine};
use nucleo_app::purchase_ops::NewSupplier;
use nucleo_app::sales_ops::NewProduct;
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Importadora Sur", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn day(n: i64) -> String {
    let d = time::OffsetDateTime::now_utc().date() + time::Duration::days(n);
    d.format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap()
}

fn product(s: &mut CompanySession, name: &str, stock: i64, cost: i64) -> String {
    s.add_product(&NewProduct {
        sku: None,
        name: name.into(),
        unit: Some("un".into()),
        kind: "producto".into(),
        price_minor: 30_000,
        cost_minor: Some(cost),
        taxable: Some(true),
        initial_stock_milli: Some(stock),
    })
    .unwrap()
    .uid
}

fn supplier(s: &mut CompanySession, name: &str) -> String {
    s.add_supplier(&NewSupplier {
        name: name.into(),
        ..Default::default()
    })
    .unwrap()
    .uid
}

fn cost(kind: &str, amount: i64, estimate: bool) -> ImportCostInput {
    ImportCostInput {
        kind: kind.into(),
        description: None,
        supplier_uid: None,
        currency_code: "CLP".into(),
        amount_minor: amount,
        rate_e6: None,
        is_estimate: estimate,
        recoverable_tax: false,
        allocation_basis: None,
        document_ref: None,
        cost_date: None,
        payment: None,
        due_date: None,
        paid_method: None,
        paid_account_uid: None,
    }
}

fn folder(sup: &str, a: &str, b: &str) -> ImportInput {
    ImportInput {
        supplier_uid: Some(sup.into()),
        incoterm: Some("FOB".into()),
        transport_mode: Some("maritimo".into()),
        origin_country: Some("China".into()),
        origin_port: Some("Ningbo".into()),
        destination_port: Some("San Antonio".into()),
        currency_code: "USD".into(),
        rate_e6: Some(950_000_000),
        purchase_date: None,
        production_eta: None,
        shipment_date: None,
        eta: Some(day(40)),
        arrival_date: None,
        allocation_basis: "unidades".into(),
        vat_ppm: Some(150_000),
        vat_recoverable: true,
        notes: None,
        items: vec![
            ImportItemInput {
                product_uid: Some(a.into()),
                description: "Sensor A".into(),
                qty_milli: 100_000,
                unit_price_minor: 1_000,
                weight_g: Some(500),
                volume_cm3: None,
                duty_ppm: Some(50_000),
                hs_code: Some("9025.19".into()),
            },
            ImportItemInput {
                product_uid: Some(b.into()),
                description: "Registrador B".into(),
                qty_milli: 50_000,
                unit_price_minor: 2_000,
                weight_g: Some(3_000),
                volume_cm3: None,
                duty_ppm: None,
                hs_code: None,
            },
        ],
    }
}

#[test]
fn importacion_de_punta_a_punta() {
    let (_d, _app, mut s) = session();
    let sup = supplier(&mut s, "Ningbo Instruments Co.");
    let agent = supplier(&mut s, "Agencia de Aduanas Ejemplo");
    let a = product(&mut s, "Sensor A", 10_000, 10_000);
    let b = product(&mut s, "Registrador B", 0, 0);

    let d = s.save_import(&folder(&sup, &a, &b), None).unwrap();
    assert_eq!(d.header.number, "IMP-000001");
    assert_eq!(d.header.stage, "cotizacion");
    assert_eq!(d.header.incoterm_version.as_deref(), Some("2020"));
    let uid = d.header.uid.clone();
    s.add_import_cost(
        &uid,
        &ImportCostInput {
            allocation_basis: Some("valor".into()),
            ..cost("flete", 190_000, true)
        },
    )
    .unwrap();
    s.add_import_cost(&uid, &cost("seguro", 19_000, true))
        .unwrap();
    let d = s
        .add_import_cost(
            &uid,
            &ImportCostInput {
                supplier_uid: Some(agent.clone()),
                payment: Some("por_pagar".into()),
                due_date: Some(day(45)),
                document_ref: Some("F-1001".into()),
                ..cost("agente_aduana", 100_000, false)
            },
        )
        .unwrap();
    // Mismos números que el caso golden.
    assert_eq!(d.calc.landed_clp, 2_261_725);
    assert_eq!(d.calc.items[0].unit_cost_e4, 117_389_200);
    assert_eq!(d.calc.recoverable_clp, 324_259);
    assert!(d.has_estimates);
    assert!(!d.receivable, "una cotización no se recibe");

    // Confirmar: guarda la foto del estimado. Embarque y cambios de ETA con motivo.
    let d = s
        .set_import_stage(&uid, "ordenada", Some("Pedido confirmado"))
        .unwrap();
    assert_eq!(d.header.estimated_landed_clp, Some(2_261_725));
    assert_eq!(d.items[0].estimated_unit_cost_e4, Some(117_389_200));
    assert!(d.header.purchase_date.is_some());
    assert!(
        s.save_import(&folder(&sup, &a, &b), Some(&uid)).is_ok(),
        "editable antes de recibir"
    );
    let d = s.set_import_stage(&uid, "embarcada", None).unwrap();
    assert_eq!(
        d.items[0].estimated_unit_cost_e4,
        Some(117_389_200),
        "editar no pierde el estimado"
    );
    assert!(
        s.change_import_eta(&uid, &day(50), None).is_err(),
        "cambiar la ETA pide motivo"
    );
    let d = s
        .change_import_eta(&uid, &day(52), Some("Transbordo en Callao"))
        .unwrap();
    assert_eq!(d.eta_history.len(), 1);
    assert_eq!(
        d.eta_history[0].reason.as_deref(),
        Some("Transbordo en Callao")
    );
    assert!(s.set_import_stage(&uid, "recibida", None).is_err());

    // Inventario: lo importado cuenta como "por llegar" con su ETA.
    let inv = s.product_inventory(&a, None).unwrap();
    let an = inv.analysis.unwrap();
    assert_eq!(an.in_purchase_milli, 100_000);
    assert_eq!(an.next_arrival, Some(day(52)));
    let list = s.list_imports("en_curso", "sensor").unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].eta_shift_days, 12);

    // Dinero: el agente queda por pagar con enlace a la carpeta; se paga desde ahí.
    let ov = s.money_overview().unwrap();
    let p = ov
        .payables
        .iter()
        .find(|p| p.link == format!("/comex/importacion/{uid}"))
        .unwrap();
    assert_eq!(p.pending_minor, 100_000);
    assert_eq!(p.party, "Agencia de Aduanas Ejemplo");
    let agent_cost = d
        .costs
        .iter()
        .find(|c| c.cost.kind == "agente_aduana")
        .unwrap()
        .cost
        .id;
    let d = s
        .pay_import_cost(&uid, agent_cost, 100_000, "Transferencia", &day(0), None)
        .unwrap();
    assert_eq!(
        d.costs
            .iter()
            .find(|c| c.cost.id == agent_cost)
            .unwrap()
            .payments
            .len(),
        1
    );
    assert!(
        s.update_import_cost(&uid, agent_cost, &cost("agente_aduana", 1, false))
            .is_err(),
        "en Dinero: se anula, no se edita"
    );

    // El flete real reemplaza al estimado.
    let flete = d
        .costs
        .iter()
        .find(|c| c.cost.kind == "flete")
        .unwrap()
        .cost
        .id;
    let d = s
        .update_import_cost(
            &uid,
            flete,
            &ImportCostInput {
                allocation_basis: Some("valor".into()),
                ..cost("flete", 200_000, false)
            },
        )
        .unwrap();
    // +10.000 de flete y +250 de derechos (arancel de A sobre su mitad del flete adicional).
    assert_eq!(d.calc.landed_clp, 2_261_725 + 10_000 + 250);

    // Recepción parcial y total al costo puesto en bodega.
    let item_a = d.items[0].id;
    let d = s
        .receive_import(
            &uid,
            &[ImportReceiveLine {
                item_id: item_a,
                qty_milli: 40_000,
            }],
            &day(0),
        )
        .unwrap();
    assert_eq!(d.header.stage, "embarcada");
    assert!(!d.editable);
    let d = s.receive_import(&uid, &[], &day(0)).unwrap();
    assert_eq!(d.header.stage, "recibida");
    assert_eq!(d.receipts.len(), 2);
    let inv = s.product_inventory(&a, None).unwrap();
    assert_eq!(inv.product.on_hand_milli, 110_000);
    let unit = d.calc.items[0].unit_cost_e4;
    // Promedio: (10 × $1.000 + 100 × costo importado) / 110
    let expected = (10 * 100_000_000 + 100 * unit) / 110;
    assert!(
        (inv.product.cost_e4 - expected).abs() <= 1,
        "{} vs {expected}",
        inv.product.cost_e4
    );
    let k = &inv.kardex[0];
    assert_eq!(
        (k.source_type.as_str(), k.source_uid.as_deref()),
        ("IMP", Some(uid.as_str()))
    );
    assert!(
        s.void_import(&uid, "error").is_err(),
        "con mercadería recibida no se anula"
    );

    // Cierre: exige reemplazar los estimados; luego compara con lo estimado.
    assert!(s.close_import(&uid).is_err());
    let seguro = d
        .costs
        .iter()
        .find(|c| c.cost.kind == "seguro")
        .unwrap()
        .cost
        .id;
    s.update_import_cost(&uid, seguro, &cost("seguro", 19_000, false))
        .unwrap();
    let d = s.close_import(&uid).unwrap();
    assert_eq!(d.header.stage, "cerrada");
    assert_eq!(d.header.landed_total_clp, Some(2_271_975));
    assert!(
        d.timeline
            .iter()
            .any(|t| t.text.contains("estimado $2.261.725 · diferencia +$10.250"))
    );
    assert!(
        s.add_import_cost(&uid, &cost("otros", 1_000, false))
            .is_err()
    );
}

#[test]
fn anular_importacion_anula_costos_y_pagos() {
    let (_d, _app, mut s) = session();
    let sup = supplier(&mut s, "Proveedor X");
    let a = product(&mut s, "A", 0, 0);
    let b = product(&mut s, "B", 0, 0);
    let uid = s
        .save_import(&folder(&sup, &a, &b), None)
        .unwrap()
        .header
        .uid;
    let d = s
        .add_import_cost(
            &uid,
            &ImportCostInput {
                payment: Some("pagado".into()),
                paid_method: Some("Transferencia".into()),
                ..cost("gastos_bancarios", 25_000, false)
            },
        )
        .unwrap();
    assert_eq!(d.costs[0].payments.len(), 1);
    let cash = s.money_overview().unwrap().cash_minor;
    assert!(s.void_import(&uid, " ").is_err());
    let d = s.void_import(&uid, "El proveedor no confirmó").unwrap();
    assert_eq!(d.header.stage, "anulada");
    assert_eq!(d.costs[0].cost.status, "anulado");
    assert_eq!(
        s.money_overview().unwrap().cash_minor,
        cash + 25_000,
        "el pago vuelve a la cuenta"
    );
    assert!(s.set_import_stage(&uid, "ordenada", None).is_err());
    // Un estimado se quita sin motivo; un real exige motivo.
    let uid2 = s
        .save_import(&folder(&sup, &a, &b), None)
        .unwrap()
        .header
        .uid;
    let d = s
        .add_import_cost(&uid2, &cost("flete", 10_000, true))
        .unwrap();
    let d = s
        .remove_import_cost(&uid2, d.costs[0].cost.id, None)
        .unwrap();
    assert!(d.costs.is_empty());
    let d = s
        .add_import_cost(&uid2, &cost("otros", 10_000, false))
        .unwrap();
    assert!(
        s.remove_import_cost(&uid2, d.costs[0].cost.id, None)
            .is_err()
    );
    assert_eq!(s.incoterms().unwrap().len(), 11);
    assert!(
        s.save_import(
            &ImportInput {
                incoterm: Some("XYZ".into()),
                ..folder(&sup, &a, &b)
            },
            None
        )
        .is_err()
    );
    assert!(
        s.save_import(
            &ImportInput {
                items: vec![],
                ..folder(&sup, &a, &b)
            },
            None
        )
        .is_err()
    );
}
