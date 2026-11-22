//! Código de Autorización de Folios (CAF): el archivo que entrega el SII con el rango de folios
//! autorizados, la firma del SII y la llave privada con que se firma el timbre de cada documento.

use crate::xml::{El, from_latin1, from_rox};
use crate::{DteError, DteResult};
use data_encoding::BASE64;
use openssl::pkey::{PKey, Private};
use openssl::rsa::Rsa;

pub struct Caf {
    /// RUT del emisor (como viene en el CAF, ej. 76123456-0).
    pub rut: String,
    pub razon_social: String,
    pub tipo: u16,
    pub desde: u64,
    pub hasta: u64,
    /// Fecha de autorización (AAAA-MM-DD).
    pub fecha: String,
    /// Nodo `<CAF>` tal cual, para incluirlo en el timbre.
    pub node: El,
    key: PKey<Private>,
}

impl Caf {
    /// Lee el archivo CAF (XML en ISO-8859-1 o UTF-8).
    pub fn parse(bytes: &[u8]) -> DteResult<Self> {
        let text = match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => from_latin1(bytes),
        };
        // roxmltree no acepta la declaración con otra codificación: se quita.
        let body = match text.find("?>") {
            Some(i) if text.trim_start().starts_with("<?xml") => text[i + 2..].to_string(),
            _ => text,
        };
        let doc = roxmltree::Document::parse(&body)
            .map_err(|e| DteError::Caf(format!("el archivo no es un CAF válido: {e}")))?;
        let root = doc.root_element();
        let caf_node = root
            .children()
            .find(|n| n.has_tag_name("CAF"))
            .ok_or_else(|| DteError::Caf("el archivo no trae el nodo CAF".into()))?;
        let mut node = from_rox(caf_node);
        node.strip_ws();
        let da = node
            .find("DA")
            .ok_or_else(|| DteError::Caf("el CAF no trae DA".into()))?;
        let t = |e: &El, n: &str| {
            e.find(n)
                .map(|x| x.text_content().trim().to_string())
                .unwrap_or_default()
        };
        let rng = da
            .find("RNG")
            .ok_or_else(|| DteError::Caf("el CAF no trae el rango".into()))?;
        let num = |s: String, what: &str| {
            s.parse::<u64>()
                .map_err(|_| DteError::Caf(format!("{what} no válido en el CAF")))
        };
        let sk = root
            .children()
            .find(|n| n.has_tag_name("RSASK"))
            .and_then(|n| n.text())
            .ok_or_else(|| DteError::Caf("el CAF no trae la llave privada (RSASK)".into()))?;
        let rsa = Rsa::private_key_from_pem(sk.trim().as_bytes())
            .map_err(|_| DteError::Caf("la llave privada del CAF no es válida".into()))?;
        Ok(Self {
            rut: t(da, "RE"),
            razon_social: t(da, "RS"),
            tipo: t(da, "TD")
                .parse()
                .map_err(|_| DteError::Caf("tipo de documento no válido en el CAF".into()))?,
            desde: num(t(rng, "D"), "folio inicial")?,
            hasta: num(t(rng, "H"), "folio final")?,
            fecha: t(da, "FA"),
            node,
            key: PKey::from_rsa(rsa)?,
        })
    }

    pub fn includes(&self, folio: u64) -> bool {
        (self.desde..=self.hasta).contains(&folio)
    }

    /// Firma del timbre (FRMT): RSA-SHA1 del nodo DD aplanado, en ISO-8859-1.
    pub fn sign_dd(&self, dd_latin1: &[u8]) -> DteResult<String> {
        Ok(BASE64.encode(&crate::crypto::rsa_sha1(&self.key, dd_latin1)?))
    }
}
