//! Navegador de NÚCLEO: una ventana propia, con perfil separado del navegador de la persona, para
//! los sitios donde el negocio revisa cosas (el SII, el banco con usuario de consulta, marketplaces).
//!
//! Aquí vive lo que se puede probar sin ventana: los ajustes (carpeta de descargas y sitios
//! permitidos), el **permiso de ingreso por el día** y las comprobaciones de dominio y de nombre de
//! archivo. La ventana misma está en la capa de escritorio (`browser.rs`).
//!
//! Reglas (docs/DECISIONS.md, D-NAV-01…04):
//! - El navegador solo abre sitios de la lista: los de los accesos guardados y los que la persona
//!   agregue. Lo demás se bloquea y se informa.
//! - La clave la rellena NÚCLEO, nunca el asistente, y solo si la persona autorizó **hoy** ese acceso
//!   («Autorizar por hoy»). El permiso vence solo al cambiar el día. Autorizar, quitar el permiso y
//!   cambiar los ajustes son acciones de la persona: se rechazan si vienen del asistente.
//! - La clave solo se entrega a una página del mismo sitio que la dirección guardada en el acceso.
//! - Lo que se guarda desde una página va a la carpeta de descargas, con un nombre de archivo sano y
//!   una extensión de documento (nunca programas).

use crate::company::CompanySession;
use crate::sales_ops::{local_today, log};
use crate::{AppError, AppResult};
use nucleo_db::core as dbcore;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const SETTING: &str = "navegador";
const GRANTS: &str = "navegador.permisos";

/// Sitios con que parte la lista: el SII (se entra con certificado digital, sin clave guardada).
pub const DEFAULT_SITES: [&str; 1] = ["sii.cl"];

/// Extensiones que se pueden guardar desde una página.
pub const FILE_EXTENSIONS: [&str; 10] = [
    "pdf", "xml", "csv", "xlsx", "xls", "txt", "json", "png", "jpg", "jpeg",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct BrowserSettings {
    /// Carpeta donde se guardan las descargas. Vacía: «Documentos\NUCLEO ERP Descargas».
    pub download_dir: String,
    /// Sitios permitidos además de los de los accesos guardados (dominios, sin «https://»).
    pub sites: Vec<String>,
}

impl Default for BrowserSettings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            sites: DEFAULT_SITES.iter().map(|s| s.to_string()).collect(),
        }
    }
}

/// Un acceso guardado, visto desde el navegador (sin la clave).
#[derive(Debug, Clone, Serialize)]
pub struct BrowserAccess {
    pub uid: String,
    pub name: String,
    pub login_url: String,
    pub username: String,
    pub has_password: bool,
    /// La persona autorizó hoy que NÚCLEO inicie sesión con este acceso.
    pub granted_today: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserInfo {
    pub settings: BrowserSettings,
    pub accesses: Vec<BrowserAccess>,
    /// Todos los sitios que el navegador abre (ajustes + accesos).
    pub allowed: Vec<String>,
    pub today: String,
}

/// Lo que NÚCLEO necesita para rellenar un ingreso. No se serializa: no sale de Rust.
pub struct LoginData {
    pub name: String,
    pub login_url: String,
    pub host: String,
    pub username: String,
    pub secret: String,
}

/// Sin la clave ni el usuario: lo que se llegue a imprimir no los lleva.
impl std::fmt::Debug for LoginData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LoginData({} · {})", self.name, self.host)
    }
}

/// El host de una dirección `https://…`, en minúsculas y sin puerto. `None` si no es https.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    // Sin usuario incrustado («https://banco.cl@malo.com»): se toma lo que va después de la arroba.
    let host = authority.rsplit('@').next()?;
    let host = host.split(':').next()?.trim_end_matches('.').to_lowercase();
    let ok = !host.is_empty()
        && host.contains('.')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !host.starts_with(['.', '-'])
        && !host.contains("..");
    ok.then_some(host)
}

/// El dominio que se registra («www1.sii.cl» → «sii.cl», «tienda.empresa.com.ar» → «empresa.com.ar»).
pub fn site_of(host: &str) -> String {
    const SECOND: [&str; 9] = ["com", "co", "gob", "gov", "org", "net", "edu", "mil", "ac"];
    let labels: Vec<&str> = host.split('.').collect();
    let n = labels.len();
    let keep = if n >= 3 && labels[n - 1].len() == 2 && SECOND.contains(&labels[n - 2]) {
        3
    } else {
        2
    };
    labels[n.saturating_sub(keep)..].join(".")
}

/// ¿Este host pertenece a alguno de los sitios? (el sitio mismo o un subdominio suyo).
pub fn host_allowed(host: &str, sites: &[String]) -> bool {
    sites
        .iter()
        .any(|s| host == s || host.ends_with(&format!(".{s}")))
}

/// Deja un sitio como dominio limpio o explica por qué no sirve.
pub fn clean_site(raw: &str) -> AppResult<String> {
    let t = raw.trim().to_lowercase();
    let t = t
        .strip_prefix("https://")
        .or_else(|| t.strip_prefix("http://"))
        .unwrap_or(&t);
    let t = t.split(['/', '?', '#']).next().unwrap_or_default();
    let t = t.strip_prefix("www.").unwrap_or(t);
    let host = host_of(&format!("https://{t}")).ok_or_else(|| {
        AppError::Validation(format!(
            "«{raw}» no es un sitio: escribe el dominio, por ejemplo banco.cl"
        ))
    })?;
    if site_of(&host).split('.').count() < 2 || host.len() > 100 {
        return Err(AppError::Validation(format!("«{raw}» no es un sitio")));
    }
    Ok(host)
}

/// Nombre de archivo para guardar en la carpeta de descargas: sin rutas, sin caracteres que Windows
/// rechaza y con extensión de documento.
pub fn safe_file_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    let bad = |m: &str| AppError::Validation(format!("nombre de archivo: {m}"));
    if name.is_empty() || name.chars().count() > 120 {
        return Err(bad("entre 1 y 120 caracteres"));
    }
    if name
        .chars()
        .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
    {
        return Err(bad("sin rutas ni los caracteres / \\ : * ? \" < > |"));
    }
    if name.starts_with('.') || name.ends_with(['.', ' ']) {
        return Err(bad("no puede empezar ni terminar con punto"));
    }
    let (stem, ext) = name
        .rsplit_once('.')
        .ok_or_else(|| bad("falta la extensión (por ejemplo .pdf)"))?;
    if !FILE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
        return Err(bad(&format!(
            "solo se guardan documentos ({})",
            FILE_EXTENSIONS.join(", ")
        )));
    }
    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let first = stem.split('.').next().unwrap_or_default().to_lowercase();
    if stem.trim().is_empty() || reserved.contains(&first.as_str()) {
        return Err(bad("ese nombre está reservado por Windows"));
    }
    Ok(name.to_string())
}

impl CompanySession {
    fn browser_settings_raw(&self) -> AppResult<BrowserSettings> {
        Ok(dbcore::get_setting(self.db.conn(), SETTING)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    fn browser_grants(&self) -> AppResult<BTreeMap<String, String>> {
        Ok(dbcore::get_setting(self.db.conn(), GRANTS)?
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    /// Sitios que el navegador abre: los de los ajustes y los de los accesos guardados.
    pub fn browser_allowed_sites(&self) -> AppResult<Vec<String>> {
        let mut sites = self.browser_settings_raw()?.sites;
        let mut st = self
            .db
            .conn()
            .prepare("SELECT login_url FROM site_accesses")?;
        let urls = st.query_map([], |r| r.get::<_, String>(0))?;
        for u in urls {
            if let Some(h) = host_of(&u?) {
                sites.push(site_of(&h));
            }
        }
        sites.sort();
        sites.dedup();
        Ok(sites)
    }

    /// ¿Se puede abrir esta dirección? Devuelve el host, o el motivo del rechazo.
    pub fn browser_check_url(&self, url: &str) -> AppResult<String> {
        self.require("config.ver")?;
        let host = host_of(url).ok_or_else(|| {
            AppError::Validation("el navegador de NÚCLEO solo abre direcciones https://".into())
        })?;
        if !host_allowed(&host, &self.browser_allowed_sites()?) {
            return Err(AppError::Validation(format!(
                "{host} no está entre los sitios permitidos del navegador de NÚCLEO. La persona lo \
                 agrega en Configuración → Integraciones → Navegador."
            )));
        }
        Ok(host)
    }

    pub fn browser_info(&self) -> AppResult<BrowserInfo> {
        self.require("config.ver")?;
        let today = local_today(self.db.conn())?;
        let grants = self.browser_grants()?;
        let accesses = self
            .accesses()?
            .into_iter()
            .map(|a| BrowserAccess {
                granted_today: grants.get(&a.uid) == Some(&today),
                uid: a.uid,
                name: a.name,
                login_url: a.login_url,
                username: a.username,
                has_password: a.has_password,
            })
            .collect();
        Ok(BrowserInfo {
            settings: self.browser_settings_raw()?,
            accesses,
            allowed: self.browser_allowed_sites()?,
            today,
        })
    }

    /// Guarda la carpeta de descargas y los sitios. Solo la persona.
    pub fn browser_save_settings(&mut self, v: &BrowserSettings) -> AppResult<BrowserInfo> {
        let user = self.require("config.editar")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "los sitios y la carpeta del navegador los define la persona en Configuración → \
                 Integraciones → Navegador"
                    .into(),
            ));
        }
        let dir = v.download_dir.trim();
        if dir.chars().count() > 240 || dir.chars().any(|c| c.is_control()) {
            return Err(AppError::Validation(
                "la carpeta de descargas no es válida".into(),
            ));
        }
        let mut sites = Vec::new();
        for s in &v.sites {
            if !s.trim().is_empty() {
                sites.push(clean_site(s)?);
            }
        }
        sites.sort();
        sites.dedup();
        if sites.len() > 40 {
            return Err(AppError::Validation("hasta 40 sitios".into()));
        }
        let clean = BrowserSettings {
            download_dir: dir.to_string(),
            sites,
        };
        dbcore::set_setting(
            self.db.conn(),
            SETTING,
            &serde_json::to_value(&clean).map_err(|e| AppError::Validation(e.to_string()))?,
        )?;
        log(
            self.db.conn(),
            &user,
            "update",
            "navegador",
            "ajustes",
            &format!(
                "Ajustes del navegador de NÚCLEO: sitios {} · descargas en {}",
                if clean.sites.is_empty() {
                    "(solo los de los accesos)".to_string()
                } else {
                    clean.sites.join(", ")
                },
                if clean.download_dir.is_empty() {
                    "la carpeta por defecto"
                } else {
                    &clean.download_dir
                }
            ),
            None,
        )?;
        self.browser_info()
    }

    /// «Autorizar por hoy» (o quitar el permiso): NÚCLEO podrá iniciar sesión con este acceso hasta
    /// que cambie el día. Solo la persona.
    pub fn browser_grant(&mut self, uid: &str, on: bool) -> AppResult<BrowserInfo> {
        let user = self.require("config.editar")?.username.clone();
        if self.via_agent {
            return Err(AppError::Validation(
                "el ingreso con un acceso guardado lo autoriza la persona en Configuración → \
                 Integraciones → Navegador («Autorizar por hoy»)"
                    .into(),
            ));
        }
        let access = self
            .accesses()?
            .into_iter()
            .find(|a| a.uid == uid)
            .ok_or_else(|| AppError::NotFound("el acceso".into()))?;
        if on && !access.has_password {
            return Err(AppError::Validation(format!(
                "el acceso a {} no tiene clave guardada",
                access.name
            )));
        }
        let today = local_today(self.db.conn())?;
        let mut grants = self.browser_grants()?;
        // Los permisos de días anteriores ya vencieron: no se guardan.
        grants.retain(|_, d| *d == today);
        if on {
            grants.insert(uid.to_string(), today);
        } else {
            grants.remove(uid);
        }
        dbcore::set_setting(
            self.db.conn(),
            GRANTS,
            &serde_json::to_value(&grants).map_err(|e| AppError::Validation(e.to_string()))?,
        )?;
        log(
            self.db.conn(),
            &user,
            "update",
            "acceso",
            uid,
            &if on {
                format!(
                    "Autorizó por hoy que NÚCLEO inicie sesión en {} ({})",
                    access.name, access.username
                )
            } else {
                format!("Quitó el permiso de ingreso de hoy a {}", access.name)
            },
            None,
        )?;
        self.browser_info()
    }

    /// Busca un acceso por identificador o por nombre (sin distinguir mayúsculas).
    pub fn browser_find_access(&self, key: &str) -> AppResult<BrowserAccess> {
        let k = key.trim().to_lowercase();
        let all = self.browser_info()?.accesses;
        let exact: Vec<&BrowserAccess> = all
            .iter()
            .filter(|a| a.uid == key.trim() || a.name.to_lowercase() == k)
            .collect();
        let found = if exact.len() == 1 {
            exact
        } else {
            all.iter()
                .filter(|a| !k.is_empty() && a.name.to_lowercase().contains(&k))
                .collect()
        };
        match found.as_slice() {
            [a] => Ok((*a).clone()),
            [] => Err(AppError::NotFound(format!("un acceso llamado «{key}»"))),
            _ => Err(AppError::Validation(format!(
                "hay más de un acceso que calza con «{key}»: indica el nombre completo"
            ))),
        }
    }

    /// Dónde se puede escribir la clave de un acceso: en su sitio (`banco.cl` y subdominios) o, para
    /// e-Boleta, solo en ese servidor exacto (la Clave Tributaria no se entrega al resto del SII).
    pub fn login_scope(login_url: &str) -> Option<String> {
        let host = host_of(login_url)?;
        Some(if crate::access_ops::is_eboleta(login_url) {
            host
        } else {
            site_of(&host)
        })
    }

    /// Usuario y clave para que NÚCLEO rellene el ingreso. Exige el permiso de hoy y, si se indica
    /// la página que está abierta, que sea del mismo sitio que la dirección guardada. Deja registro.
    pub fn browser_login_data(
        &mut self,
        uid: &str,
        page_host: Option<&str>,
    ) -> AppResult<LoginData> {
        let access = self
            .browser_info()?
            .accesses
            .into_iter()
            .find(|a| a.uid == uid)
            .ok_or_else(|| AppError::NotFound("el acceso".into()))?;
        if !access.has_password {
            return Err(AppError::Validation(format!(
                "el acceso a {} no tiene clave guardada",
                access.name
            )));
        }
        if !access.granted_today {
            return Err(AppError::Validation(format!(
                "Falta el permiso de hoy para entrar a {}: la persona lo da en Configuración → \
                 Integraciones → Navegador, «Autorizar por hoy». Vence solo al cambiar el día.",
                access.name
            )));
        }
        let host = host_of(&access.login_url)
            .ok_or_else(|| AppError::Validation("la dirección del acceso no es https".into()))?;
        let scope = Self::login_scope(&access.login_url).unwrap_or_else(|| host.clone());
        if let Some(page) = page_host
            && page != scope
            && !page.ends_with(&format!(".{scope}"))
        {
            return Err(AppError::Validation(format!(
                "La página abierta es de {page} y el acceso guardado es de {host}: NÚCLEO no \
                 entrega la clave a otro sitio."
            )));
        }
        let (login_url, username, secret) =
            self.access_credentials(uid, "navegador de NÚCLEO, permiso del día")?;
        Ok(LoginData {
            name: access.name,
            login_url,
            host,
            username,
            secret,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_y_sitios() {
        assert_eq!(
            host_of("https://WWW1.sii.cl/cgi-bin/x?a=1").as_deref(),
            Some("www1.sii.cl")
        );
        assert_eq!(
            host_of("https://bel.bci.cl:443/a").as_deref(),
            Some("bel.bci.cl")
        );
        assert_eq!(
            host_of("https://banco.cl@malo.com/x").as_deref(),
            Some("malo.com")
        );
        assert_eq!(host_of("http://sii.cl/"), None);
        assert_eq!(host_of("https://localhost/"), None);
        assert_eq!(host_of("javascript:alert(1)"), None);
        assert_eq!(site_of("www1.sii.cl"), "sii.cl");
        assert_eq!(site_of("tienda.empresa.com.ar"), "empresa.com.ar");
        assert_eq!(site_of("bci.cl"), "bci.cl");
        let sites = vec!["sii.cl".to_string(), "bci.cl".to_string()];
        assert!(host_allowed("www4.sii.cl", &sites));
        assert!(host_allowed("bci.cl", &sites));
        assert!(!host_allowed("sii.cl.malo.com", &sites));
        assert!(!host_allowed("falsosii.cl", &sites));
        assert_eq!(
            clean_site(" https://www.BCI.cl/empresas ").unwrap(),
            "bci.cl"
        );
        assert!(clean_site("cl").is_err());
        assert!(clean_site("mi banco").is_err());
    }

    #[test]
    fn nombres_de_archivo() {
        assert_eq!(safe_file_name(" 536-DL.pdf ").unwrap(), "536-DL.pdf");
        assert!(safe_file_name("GD-36-DL.PDF").is_ok());
        for bad in [
            "",
            "..\\..\\Windows\\x.pdf",
            "a/b.pdf",
            "C:x.pdf",
            "factura",
            "virus.exe",
            "factura.pdf.exe",
            ".pdf",
            "con.pdf",
            "x.pdf.",
        ] {
            assert!(safe_file_name(bad).is_err(), "{bad}");
        }
    }
}
