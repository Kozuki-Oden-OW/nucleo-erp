//! Herramienta del mantenedor para paquetes normativos firmados.
//!
//!   rules keygen <archivo-clave-privada>          crea una clave Ed25519 (¡guardar fuera del repositorio!)
//!   rules sign <paquete.json> <clave-privada> <salida.nucleo-rules>
//!   rules verify <salida.nucleo-rules> <clave-publica-hex>
//!
//! La clave privada NUNCA va en la aplicación ni en el repositorio: solo su clave pública.

use ed25519_dalek::{SigningKey, VerifyingKey};
use nucleo_rules::RuleSet;
use nucleo_rules::signed::{key_id, sign, verify};

fn read_key(path: &str) -> SigningKey {
    let hex_key = std::fs::read_to_string(path).expect("leer clave privada");
    let bytes: [u8; 32] = hex::decode(hex_key.trim())
        .ok()
        .and_then(|b| b.try_into().ok())
        .expect("clave privada inválida");
    SigningKey::from_bytes(&bytes)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("keygen") => {
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes).expect("aleatoriedad del sistema");
            let key = SigningKey::from_bytes(&bytes);
            std::fs::write(&a[2], hex::encode(bytes)).expect("escribir clave privada");
            let public = key.verifying_key();
            println!(
                "Clave privada guardada en {} (guárdala fuera del repositorio).",
                a[2]
            );
            println!("Clave pública (hex): {}", hex::encode(public.as_bytes()));
            println!("key_id: {}", key_id(&public));
        }
        Some("sign") => {
            let set: RuleSet =
                serde_json::from_str(&std::fs::read_to_string(&a[2]).expect("leer paquete"))
                    .expect("paquete inválido");
            let mut book = nucleo_rules::RuleBook::new();
            book.add(set.clone())
                .expect("el paquete no pasa las validaciones (fuente, vigencias)");
            let signed = sign(set, &read_key(&a[3]));
            std::fs::write(&a[4], serde_json::to_string_pretty(&signed).unwrap())
                .expect("escribir salida");
            println!("Paquete firmado: {} (key_id {})", a[4], signed.key_id);
        }
        Some("verify") => {
            let bytes: [u8; 32] = hex::decode(a[3].trim())
                .ok()
                .and_then(|b| b.try_into().ok())
                .expect("clave pública inválida");
            let key = VerifyingKey::from_bytes(&bytes).expect("clave pública inválida");
            match verify(
                &std::fs::read_to_string(&a[2]).expect("leer paquete"),
                &[key],
            ) {
                Ok(set) => println!("Firma válida: {} ({} valores)", set.code, set.values.len()),
                Err(e) => {
                    eprintln!("Firma NO válida: {e}");
                    std::process::exit(1);
                }
            }
        }
        _ => eprintln!(
            "uso: rules keygen <clave> | rules sign <paquete.json> <clave> <salida> | rules verify <salida> <pública-hex>"
        ),
    }
}
