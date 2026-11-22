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
                .child(El::text("Modulus", BASE64.encode(&rsa.n().to_vec())))
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
        let signed_info = El::new("SignedInfo")
            .child(El::new("CanonicalizationMethod").attr("Algorithm", C14N))
            .child(El::new("SignatureMethod").attr("Algorithm", RSA_SHA1))
            .child(reference);
        let mut si_scope = sig_inherited.clone();
        si_scope.insert(String::new(), NS_DSIG.into());
        let value = self.sign_sha1_b64(signed_info.canonical(&si_scope).as_bytes())?;
        Ok(El::new("Signature")
            .ns("", NS_DSIG)
            .child(signed_info)
            .child(El::text("SignatureValue", value))
            .child(
                El::new("KeyInfo").child(self.rsa_key_value()?).child(
                    El::new("X509Data").child(El::text("X509Certificate", self.cert_b64()?)),
                ),
            ))
    }
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
