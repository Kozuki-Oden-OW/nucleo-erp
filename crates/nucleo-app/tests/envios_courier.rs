//! Envíos con los datos del courier (Bluexpress): destinatario, dirección por partes, paquete, talla,
//! costo y transacción; etiqueta adjunta al envío.

use nucleo_app::core_ops::EntityRef;
use nucleo_app::ship_ops::ShipmentInput;
use nucleo_app::{AppService, BusinessProfile, MemoryKeyStore};

#[test]
fn envio_con_datos_del_courier() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger", BusinessProfile::Empresa)
        .unwrap();
    let mut s = app.open_company(&c.company.uid).unwrap();
    let input = ShipmentInput {
        carrier: Some("Bluexpress".into()),
        tracking: Some("2480522914".into()),
        first_name: Some("Clinica Rauquen".into()),
        last_name: Some("SpA".into()),
        phone: Some("944341460".into()),
        email: Some("recepcion@clinicarauquen.cl".into()),
        region: Some("Región del Maule".into()),
        commune: Some("Curicó".into()),
        street: Some("Avenida Lyon".into()),
        street_number: Some("1801".into()),
        reference: Some("Recepción".into()),
        delivery_mode: Some("domicilio".into()),
        origin_point: Some("Punto Blue Express Market Plaza Ñuñoa".into()),
        service: Some("48 horas".into()),
        content: Some("Registrador de temperatura RC-5+".into()),
        declared_value_minor: Some(27_900),
        size: Some("s".into()),
        no_dangerous: true,
        cost_minor: Some(3_920),
        payment_ref: Some("MWS6REU73M5A0M4X5F3".into()),
        ..Default::default()
    };
    let e = s.save_shipment(None, &input).unwrap();
    assert_eq!(e.address.as_deref(), Some("Avenida Lyon 1801"));
    assert_eq!(e.size.as_deref(), Some("S"));
    assert!(e.no_dangerous);
    assert_eq!(
        (e.cost_minor, e.declared_value_minor),
        (Some(3_920), Some(27_900))
    );
    assert_eq!(e.delivery_mode.as_deref(), Some("domicilio"));

    // Validaciones.
    assert!(
        s.save_shipment(
            None,
            &ShipmentInput {
                size: Some("XL".into()),
                ..input.clone()
            }
        )
        .is_err()
    );
    assert!(
        s.save_shipment(
            None,
            &ShipmentInput {
                email: Some("sin-arroba".into()),
                ..input.clone()
            }
        )
        .is_err()
    );
    assert!(
        s.save_shipment(
            None,
            &ShipmentInput {
                weight_g: Some(0),
                ..input.clone()
            }
        )
        .is_err()
    );
    assert!(
        s.save_shipment(
            None,
            &ShipmentInput {
                delivery_mode: Some("dron".into()),
                ..input.clone()
            }
        )
        .is_err()
    );

    // Etiqueta adjunta al envío.
    let dir = tempfile::tempdir().unwrap();
    let pdf = dir.path().join("etiqueta-2480522914.pdf");
    std::fs::write(&pdf, b"%PDF-1.4 etiqueta").unwrap();
    let link = EntityRef {
        entity: "envio".into(),
        uid: e.uid.clone(),
    };
    s.add_attachment(&pdf, Some("Etiqueta Bluexpress"), Some(&link))
        .unwrap();
    assert_eq!(s.list_attachments("", Some(&link)).unwrap().len(), 1);
}
