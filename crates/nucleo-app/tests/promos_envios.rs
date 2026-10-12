//! Descuentos y promociones (guardar y validar) y envíos con sus estados.

use nucleo_app::promo_ops::{PromoItem, PromoRule, PromotionInput, Tier};
use nucleo_app::sales_ops::{LineInput, NewProduct, SaleInput};
use nucleo_app::ship_ops::ShipmentInput;
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore, NewCustomer};
use nucleo_db::customers::CustomerProfile;

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Data Logger Demo", BusinessProfile::Empresa)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn product(s: &mut CompanySession, sku: &str) -> String {
    s.add_product(&NewProduct {
        sku: Some(sku.into()),
        name: format!("Producto {sku}"),
        unit: None,
        kind: "producto".into(),
        price_minor: 10_000,
        cost_minor: Some(6_000),
        taxable: Some(true),
        initial_stock_milli: Some(10_000),
        category_uid: None,
        cost_sheet: None,
        stock_policy: None,
    })
    .unwrap()
    .uid
}

fn input(name: &str, kind: &str, rule: PromoRule) -> PromotionInput {
    PromotionInput {
        name: name.into(),
        kind: kind.into(),
        rule,
        starts_on: None,
        ends_on: None,
        active: true,
        notes: None,
    }
}

#[test]
fn promociones() {
    let (_d, _app, mut s) = session();
    let a = product(&mut s, "A");
    let b = product(&mut s, "B");
    let item = |u: &str, q: i64| PromoItem {
        product_uid: u.into(),
        qty_milli: q,
    };
    // Pack de 2 productos a $18.000.
    let all = s
        .save_promotion(
            None,
            &input(
                "Pack A+B",
                "pack",
                PromoRule {
                    items: vec![item(&a, 1000), item(&b, 1000)],
                    pack_price_minor: Some(18_000),
                    ..Default::default()
                },
            ),
        )
        .unwrap();
    assert_eq!(all[0].status, "activa");
    assert_eq!(all[0].products.len(), 2);
    // Pack sin precio ni porcentaje: error. Con ambos: error.
    let bad = PromoRule {
        items: vec![item(&a, 1000), item(&b, 1000)],
        ..Default::default()
    };
    assert!(
        s.save_promotion(None, &input("x", "pack", bad.clone()))
            .is_err()
    );
    assert!(
        s.save_promotion(
            None,
            &input(
                "x",
                "pack",
                PromoRule {
                    pack_price_minor: Some(1),
                    pct_ppm: Some(100_000),
                    ..bad
                }
            )
        )
        .is_err()
    );
    // Por cantidad con tramos (se ordenan).
    let all = s
        .save_promotion(
            None,
            &input(
                "Mayorista",
                "cantidad",
                PromoRule {
                    all_products: true,
                    mixed: true,
                    tiers: vec![
                        Tier {
                            min_milli: 10_000,
                            pct_ppm: 100_000,
                        },
                        Tier {
                            min_milli: 5_000,
                            pct_ppm: 50_000,
                        },
                    ],
                    ..Default::default()
                },
            ),
        )
        .unwrap();
    assert_eq!(all[0].rule.tiers[0].min_milli, 5_000);
    // 3x2 inválido si paga ≥ lleva.
    assert!(
        s.save_promotion(
            None,
            &input(
                "x",
                "lleva_paga",
                PromoRule {
                    items: vec![item(&a, 0)],
                    buy: 2,
                    pay: 2,
                    ..Default::default()
                }
            )
        )
        .is_err()
    );
    // Por cliente y preferencial; programada y pausada.
    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur".into(),
            profile: CustomerProfile {
                preferred: true,
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
    assert!(c.profile.preferred);
    let all = s
        .save_promotion(
            None,
            &PromotionInput {
                starts_on: Some("2099-01-01".into()),
                ..input(
                    "Clínica 5 %",
                    "cliente",
                    PromoRule {
                        customer_uids: vec![c.uid.clone()],
                        pct_ppm: Some(50_000),
                        ..Default::default()
                    },
                )
            },
        )
        .unwrap();
    assert_eq!(all[0].status, "programada");
    assert!(
        all[0].rule.all_products,
        "sin alcance = todos los productos"
    );
    assert_eq!(all[0].customers[0].name, "Clínica Sur");
    let uid = all[0].uid.clone();
    let all = s.set_promotion_active(&uid, false).unwrap();
    assert_eq!(all[0].status, "pausada");
    let all = s.delete_promotion(&uid).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn envios() {
    let (_d, _app, mut s) = session();
    let a = product(&mut s, "A");
    let c = s
        .add_customer(&NewCustomer {
            name: "Clínica Sur".into(),
            ..Default::default()
        })
        .unwrap();
    let v = s
        .save_sale(
            &SaleInput {
                doc_type: "VEN".into(),
                customer_uid: Some(c.uid.clone()),
                issue_date: "2026-10-12".into(),
                lines: vec![LineInput {
                    product_uid: Some(a),
                    description: "A".into(),
                    qty_milli: 1000,
                    unit_price_minor: 10_000,
                    discount_ppm: 0,
                    taxable: true,
                }],
                notes: None,
                terms: None,
            },
            None,
        )
        .unwrap();
    let e = s
        .save_shipment(
            None,
            &ShipmentInput {
                sale_uid: Some(v.summary.uid.clone()),
                carrier: Some("Starken".into()),
                first_name: Some("Ana".into()),
                last_name: Some("Pérez".into()),
                commune: Some("Frutillar".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(e.number, "ENV-000001");
    assert_eq!(e.status, "no_despachado");
    assert_eq!(
        e.customer_name.as_deref(),
        Some("Clínica Sur"),
        "toma el cliente de la venta"
    );
    // En camino sin fecha → hoy; entregado sin fecha → hoy.
    let e = s
        .save_shipment(
            Some(&e.uid),
            &ShipmentInput {
                sale_uid: Some(v.summary.uid.clone()),
                tracking: Some("123456789".into()),
                status: "en_camino".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(e.shipped_on.is_some() && e.delivered_on.is_none());
    let e = s
        .save_shipment(
            Some(&e.uid),
            &ShipmentInput {
                shipped_on: Some("2026-10-01".into()),
                delivered_on: Some("2026-09-30".into()),
                status: "entregado".into(),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(e.to_string().contains("anterior"));
    let list = s.shipments(Some(&v.summary.uid)).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].tracking.as_deref(), Some("123456789"));
    assert!(
        s.save_shipment(
            None,
            &ShipmentInput {
                status: "perdido".into(),
                ..Default::default()
            }
        )
        .is_err()
    );
    let d = s.sale(&v.summary.uid).unwrap();
    assert!(d.timeline.iter().any(|t| t.text.contains("En camino")));
}
