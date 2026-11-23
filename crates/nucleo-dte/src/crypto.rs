//! Certificado digital (PKCS#12, .pfx/.p12), firma RSA-SHA1 y firma XML (XMLDSig) como la pide el SII.

use crate::xml::El;
use crate::{DteError, DteResult};
use data_encoding::BASE64;
use openssl::hash::{MessageDigest, hash};
use openssl::pkcs12::Pkcs12;
use openssl::pkey::{PKey, Private};
use openssl::rsa::Rsa;
use openssl::sign::{Signer, Verifier};
use openssl::x509::X509;
use std::collections::BTreeMap;

pub const NS_DSIG: &str = "http://www.w3.org/2000/09/xmldsig#";
pub const C14N: &str = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
pub const RSA_SHA1: &str = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
pub const SHA1: &str = "http://www.w3.org/2000/09/xmldsig#sha1";
pub const ENVELOPED: &str = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/// Carga (una vez) el proveedor «legacy» de OpenSSL junto al predeterminado, para leer .pfx cifrados
/// con RC2-40 o 3DES (formato antiguo, muy usado por los proveedores y por Windows).
pub fn load_legacy() {
    static LEGACY: std::sync::OnceLock<Option<openssl::provider::Provider>> =
        std::sync::OnceLock::new();
    LEGACY.get_or_init(|| openssl::provider::Provider::try_load(None, "legacy", true).ok());
}

/// Certificado del firmante con su llave privada.
pub struct Certificate {
    key: PKey<Private>,
    cert: X509,
}

impl Certificate {
    /// Lee un archivo .pfx/.p12 con su clave.
    pub fn from_pkcs12(der: &[u8], password: &str) -> DteResult<Self> {
        let p = Pkcs12::from_der(der)
            .map_err(|_| {
                DteError::Certificate("el archivo no es un certificado .pfx/.p12 válido".into())
            })?
            .parse2(password)
            .map_err(|_| DteError::Certificate("la clave del certificado no es correcta".into()))?;
        let key = p.pkey.ok_or_else(|| {
            DteError::Certificate("el certificado no trae la llave privada".into())
        })?;
        let cert = p
            .cert
            .ok_or_else(|| DteError::Certificate("el archivo no trae el certificado".into()))?;
        if key.rsa().is_err() {
            return Err(DteError::Certificate("el certificado no es RSA".into()));
        }
        Ok(Self { key, cert })
    }

    /// Para pruebas: llave y certificado ya cargados.
    pub fn from_parts(key: PKey<Private>, cert: X509) -> Self {
        Self { key, cert }
    }

    /// Certificado en Base64 (DER), para `<X509Certificate>`.
    pub fn cert_b64(&self) -> DteResult<String> {
        Ok(BASE64.encode(&self.cert.to_der()?))
    }

    /// Nombre del titular (CN) y RUT si viene en el certificado (serialNumber o en el CN).
    pub fn subject(&self) -> (Option<String>, Option<String>) {
        let mut cn = None;
        let mut serial = None;
        for e in self.cert.subject_name().entries() {
            let v = e.data().to_string().ok();
            match e.object().nid().short_name().unwrap_or("") {
                "CN" => cn = v,
                "serialNumber" => serial = v,
                _ => {}
            }
        }
        (cn, serial)
    }

    /// Fecha de vencimiento del certificado (texto de OpenSSL, ej. «Nov 22 12:00:00 2027 GMT»).
    pub fn not_after(&self) -> String {
        self.cert.not_after().to_string()
    }

    /// Firma RSA-SHA1 en Base64.
    pub fn sign_sha1_b64(&self, data: &[u8]) -> DteResult<String> {
        Ok(BASE64.encode(&rsa_sha1(&self.key, data)?))
    }

    fn rsa_key_value(&self) -> DteResult<El> {
        let rsa = self.key.rsa()?;
        Ok(El::new("KeyValue").child(
            El::new("RSAKeyValue")
                .child(El::text(
                    "Modulus",
                    wrap64(&BASE64.encode(&rsa.n().to_vec())),
                ))
                .child(El::text("Exponent", BASE64.encode(&rsa.e().to_vec()))),
        ))
    }

    /// Firma XML (XMLDSig) del elemento con `ID = id`. `inherited` son los espacios de nombres que el
    /// elemento firmado hereda de sus ancestros y `sig_inherited` los que heredará la firma.
    /// `enveloped`: la firma va dentro de lo firmado (URI vacía, documento completo).
    pub fn xml_signature(
        &self,
        target: &El,
        uri: &str,
        inherited: &BTreeMap<String, String>,
        sig_inherited: &BTreeMap<String, String>,
        enveloped: bool,
    ) -> DteResult<El> {
        let digest = BASE64.encode(&hash(
            MessageDigest::sha1(),
            target.canonical(inherited).as_bytes(),
        )?);
        let mut reference = El::new("Reference").attr("URI", uri);
        if enveloped {
            reference.push(
                El::new("Transforms").child(El::new("Transform").attr("Algorithm", ENVELOPED)),
            );
        }
        let reference = reference
            .child(El::new("DigestMethod").attr("Algorithm", SHA1))
            .child(El::text("DigestValue", digest));
        let mut signed_info = El::new("SignedInfo")
            .child(El::new("CanonicalizationMethod").attr("Algorithm", C14N))
            .child(El::new("SignatureMethod").attr("Algorithm", RSA_SHA1))
            .child(reference);
        signed_info.break_lines(&[]);
        let mut si_scope = sig_inherited.clone();
        si_scope.insert(String::new(), NS_DSIG.into());
        let value = self.sign_sha1_b64(signed_info.canonical(&si_scope).as_bytes())?;
        let mut sig = El::new("Signature")
            .ns("", NS_DSIG)
            .child(signed_info)
            .child(El::text("SignatureValue", wrap64(&value)))
            .child(El::new("KeyInfo").child(self.rsa_key_value()?).child(
                El::new("X509Data").child(El::text("X509Certificate", wrap64(&self.cert_b64()?))),
            ));
        sig.break_lines(&[]);
        Ok(sig)
    }
}

/// Base64 en líneas de 76 caracteres (los espacios no cambian el valor en base64Binary).
fn wrap64(b64: &str) -> String {
    b64.as_bytes()
        .chunks(76)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn rsa_sha1(key: &PKey<Private>, data: &[u8]) -> DteResult<Vec<u8>> {
    let mut s = Signer::new(MessageDigest::sha1(), key)?;
    s.update(data)?;
    Ok(s.sign_to_vec()?)
}

/// Verifica una firma RSA-SHA1 con una llave pública RSA en PEM.
pub fn verify_sha1_pem(public_pem: &[u8], data: &[u8], sig: &[u8]) -> DteResult<bool> {
    let k = PKey::from_rsa(
        Rsa::public_key_from_pem(public_pem)
            .or_else(|_| Rsa::public_key_from_pem_pkcs1(public_pem))?,
    )?;
    let mut v = Verifier::new(MessageDigest::sha1(), &k)?;
    v.update(data)?;
    Ok(v.verify(sig)?)
}

/// Resultado de revisar una firma XML recibida.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FirmaEstado {
    Valida,
    /// El contenido no coincide con lo firmado o la firma no corresponde al certificado.
    Invalida,
    /// No se pudo revisar (firma con otro formato, sin certificado, etc.).
    SinVerificar,
}

/// Revisa la firma XML `sig` sobre `signed` (elemento con ID), dados los espacios de nombres que
/// `signed` hereda de sus ancestros. Usa el certificado (o la llave RSA) que trae la propia firma: dice
/// si el documento no fue alterado, no quién lo firmó.
pub fn verify_xml_signature(
    sig: &El,
    signed: &El,
    scope: &BTreeMap<String, String>,
) -> FirmaEstado {
    let limpio = |e: Option<&El>| -> Option<Vec<u8>> {
        let t: String = e?.text_content().split_whitespace().collect();
        BASE64.decode(t.as_bytes()).ok()
    };
    let Some(si) = sig.find("SignedInfo") else {
        return FirmaEstado::SinVerificar;
    };
    let Some(digest) = limpio(si.find("Reference").and_then(|r| r.find("DigestValue"))) else {
        return FirmaEstado::SinVerificar;
    };
    let Ok(real) = hash(MessageDigest::sha1(), signed.canonical(scope).as_bytes()) else {
        return FirmaEstado::SinVerificar;
    };
    if real.as_ref() != digest.as_slice() {
        return FirmaEstado::Invalida;
    }
    let Some(valor) = limpio(sig.find("SignatureValue")) else {
        return FirmaEstado::SinVerificar;
    };
    let ki = sig.find("KeyInfo");
    let llave = limpio(
        ki.and_then(|k| k.find("X509Data"))
            .and_then(|x| x.find("X509Certificate")),
    )
    .and_then(|der| X509::from_der(&der).ok())
    .and_then(|c| c.public_key().ok());
    let Some(llave) = llave else {
        return FirmaEstado::SinVerificar;
    };
    let mut si_scope = scope.clone();
    si_scope.insert(String::new(), NS_DSIG.into());
    let ok = Verifier::new(MessageDigest::sha1(), &llave)
        .and_then(|mut v| {
            v.update(si.canonical(&si_scope).as_bytes())?;
            v.verify(&valor)
        })
        .unwrap_or(false);
    if ok {
        FirmaEstado::Valida
    } else {
        FirmaEstado::Invalida
    }
}
