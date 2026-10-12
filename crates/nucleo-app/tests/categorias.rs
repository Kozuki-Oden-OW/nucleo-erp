//! Un producto en varias categorías: principal + otras, conteos, agregar en lote, quitar y
//! eliminar una categoría (la siguiente pasa a principal).

use nucleo_app::sales_ops::{NewProduct, ProductPatch};
use nucleo_app::{AppService, BusinessProfile, CompanySession, MemoryKeyStore};

fn session() -> (tempfile::TempDir, AppService, CompanySession) {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppService::open(data.path(), Box::new(MemoryKeyStore::default())).unwrap();
    let c = app
        .create_company("Tienda Demo", BusinessProfile::Negocio)
        .unwrap();
    let s = app.open_company(&c.company.uid).unwrap();
    (data, app, s)
}

fn uid_of(s: &CompanySession, name: &str) -> String {
    s.product_categories()
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap()
        .uid
}

fn count(s: &CompanySession, name: &str) -> i64 {
    s.product_categories()
        .unwrap()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap()
        .product_count
}

fn get(s: &CompanySession, uid: &str) -> nucleo_app::nucleo_db::products::ProductRow {
    s.search_products("", 200)
        .unwrap()
        .into_iter()
        .find(|p| p.uid == uid)
        .unwrap()
}

#[test]
fn producto_en_varias_categorias() {
    let (_d, _app, mut s) = session();
    s.save_category(None, "Ropa").unwrap();
    s.save_category(None, "One Piece").unwrap();
    s.save_category(None, "Ofertas").unwrap();
    let ropa = uid_of(&s, "Ropa");
    let op = uid_of(&s, "One Piece");
    let of = uid_of(&s, "Ofertas");

    // Calcetín de One Piece: principal «Ropa», además «One Piece» (y la principal repetida se ignora).
    let p = s
        .add_product(&NewProduct {
            sku: Some("CAL-OP".into()),
            name: "Calcetín Luffy".into(),
            unit: None,
            kind: "producto".into(),
            price_minor: 4_990,
            cost_minor: Some(1_800),
            taxable: Some(true),
            initial_stock_milli: None,
            category_uid: Some(ropa.clone()),
            extra_category_uids: Some(vec![op.clone(), ropa.clone()]),
            cost_sheet: None,
            stock_policy: None,
        })
        .unwrap();
    assert_eq!(p.category.as_deref(), Some("Ropa"));
    assert_eq!(p.extra_categories, vec!["One Piece".to_string()]);
    assert_eq!(count(&s, "Ropa"), 1);
    assert_eq!(count(&s, "One Piece"), 1);

    // Agregar en lote a «Ofertas»: se suma, no reemplaza la principal.
    s.assign_category(std::slice::from_ref(&p.uid), Some(&of))
        .unwrap();
    let p = get(&s, &p.uid);
    assert_eq!(p.category.as_deref(), Some("Ropa"));
    assert_eq!(
        p.extra_categories,
        vec!["Ofertas".to_string(), "One Piece".to_string()]
    );

    // Editar sin tocar las otras categorías (None) y cambiando la principal a una de ellas.
    let patch = ProductPatch {
        name: p.name.clone(),
        sku: p.sku.clone(),
        unit: "un".into(),
        price_minor: 4_990,
        taxable: true,
        min_milli: 0,
        category_uid: Some(op.clone()),
        extra_category_uids: None,
        cost_minor: None,
        cost_sheet: None,
        stock_policy: None,
    };
    let p = s.update_product(&p.uid, &patch).unwrap();
    assert_eq!(p.category.as_deref(), Some("One Piece"));
    assert_eq!(p.extra_categories, vec!["Ofertas".to_string()]);

    // Quitar «Ofertas».
    s.remove_product_category(&p.uid, &of).unwrap();
    assert!(get(&s, &p.uid).extra_categories.is_empty());

    // Volver a poner «Ropa» como otra y eliminar «One Piece» (la principal): «Ropa» pasa a principal.
    let p = s
        .update_product(
            &p.uid,
            &ProductPatch {
                extra_category_uids: Some(vec![ropa.clone()]),
                ..patch
            },
        )
        .unwrap();
    assert_eq!(p.extra_categories, vec!["Ropa".to_string()]);
    s.delete_category(&op).unwrap();
    let p = get(&s, &p.uid);
    assert_eq!(p.category.as_deref(), Some("Ropa"));
    assert!(p.extra_categories.is_empty());
}
