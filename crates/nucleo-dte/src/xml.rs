//! Árbol XML mínimo con dos salidas: el documento (ISO-8859-1) y la forma canónica C14N 1.0 inclusiva
//! (sin comentarios) de cualquier elemento, con los espacios de nombres heredados. La firma XML del SII
//! se calcula sobre la forma canónica, así que armamos y firmamos sobre el mismo árbol: lo que se firma
//! es exactamente lo que se escribe.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    El(El),
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct El {
    pub name: String,
    /// Declaraciones de espacio de nombres de este elemento: (prefijo, uri); prefijo vacío = por defecto.
    pub ns: Vec<(String, String)>,
    pub attrs: Vec<(String, String)>,
    pub kids: Vec<Node>,
}

impl El {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.into(),
            ..Default::default()
        }
    }
    pub fn ns(mut self, prefix: &str, uri: &str) -> Self {
        self.ns.push((prefix.into(), uri.into()));
        self
    }
    pub fn attr(mut self, k: &str, v: impl Into<String>) -> Self {
        self.attrs.push((k.into(), v.into()));
        self
    }
    pub fn child(mut self, e: El) -> Self {
        self.kids.push(Node::El(e));
        self
    }
    pub fn push(&mut self, e: El) {
        self.kids.push(Node::El(e));
    }
    /// Elemento con texto.
    pub fn text(name: &str, t: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kids: vec![Node::Text(t.into())],
            ..Default::default()
        }
    }
    /// Agrega `<name>texto</name>` si hay valor.
    pub fn opt(mut self, name: &str, t: Option<impl Into<String>>) -> Self {
        if let Some(t) = t {
            let t: String = t.into();
            if !t.is_empty() {
                self.kids.push(Node::El(El::text(name, t)));
            }
        }
        self
    }
    pub fn find(&self, name: &str) -> Option<&El> {
        self.kids.iter().find_map(|k| match k {
            Node::El(e) if e.name == name => Some(e),
            _ => None,
        })
    }
    pub fn find_mut(&mut self, name: &str) -> Option<&mut El> {
        self.kids.iter_mut().find_map(|k| match k {
            Node::El(e) if e.name == name => Some(e),
            _ => None,
        })
    }
    /// Quita los textos que son solo espacios entre elementos («aplana»), como pide el SII para el
    /// CAF dentro del timbre: el DD se firma sin saltos de línea entre etiquetas.
    pub fn strip_ws(&mut self) {
        let has_el = self.kids.iter().any(|k| matches!(k, Node::El(_)));
        if has_el {
            self.kids
                .retain(|k| !matches!(k, Node::Text(t) if t.trim().is_empty()));
        }
        for k in &mut self.kids {
            if let Node::El(e) = k {
                e.strip_ws();
            }
        }
    }

    /// Pone un salto de línea entre los elementos hijos (el SII rechaza archivos con líneas de más de
    /// 4090 caracteres: «CHR-00002: Line too long»). Se aplica antes de firmar, así la firma cubre los
    /// saltos; es idempotente. Los elementos en `skip` (el timbre) quedan tal cual.
    pub fn break_lines(&mut self, skip: &[&str]) {
        if skip.contains(&self.name.as_str()) || !self.kids.iter().any(|k| matches!(k, Node::El(_)))
        {
            return;
        }
        let kids = std::mem::take(&mut self.kids);
        self.kids.push(Node::Text("\n".into()));
        for k in kids {
            match k {
                Node::El(mut e) => {
                    e.break_lines(skip);
                    self.kids.push(Node::El(e));
                    self.kids.push(Node::Text("\n".into()));
                }
                Node::Text(t) if t.trim().is_empty() => {}
                t => self.kids.push(t),
            }
        }
    }

    pub fn text_content(&self) -> String {
        self.kids
            .iter()
            .map(|k| match k {
                Node::Text(t) => t.clone(),
                Node::El(e) => e.text_content(),
            })
            .collect()
    }

    /// Documento completo con la declaración XML, codificado en ISO-8859-1.
    pub fn to_document(&self) -> Vec<u8> {
        let mut s = String::from("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n");
        self.write_doc(&mut s);
        latin1(&s)
    }

    /// El elemento serializado tal como va en el documento (texto Unicode).
    pub fn to_xml(&self) -> String {
        let mut s = String::new();
        self.write_doc(&mut s);
        s
    }

    fn write_doc(&self, out: &mut String) {
        out.push('<');
        out.push_str(&self.name);
        for (p, u) in &self.ns {
            if p.is_empty() {
                out.push_str(&format!(" xmlns=\"{}\"", esc_attr(u)));
            } else {
                out.push_str(&format!(" xmlns:{p}=\"{}\"", esc_attr(u)));
            }
        }
        for (k, v) in &self.attrs {
            out.push_str(&format!(" {k}=\"{}\"", esc_attr(v)));
        }
        out.push('>');
        for k in &self.kids {
            match k {
                Node::Text(t) => out.push_str(&esc_text(t)),
                Node::El(e) => e.write_doc(out),
            }
        }
        out.push_str("</");
        out.push_str(&self.name);
        out.push('>');
    }

    /// Forma canónica (C14N 1.0 inclusiva) de este elemento, dados los espacios de nombres heredados
    /// de sus ancestros (prefijo → uri). Salida en UTF-8, como exige C14N.
    pub fn canonical(&self, inherited: &BTreeMap<String, String>) -> String {
        let mut out = String::new();
        // Contexto ya «emitido»: al ser el ápice, no se ha emitido nada.
        self.write_c14n(&mut out, inherited, &BTreeMap::new(), true);
        out
    }

    fn write_c14n(
        &self,
        out: &mut String,
        in_scope_parent: &BTreeMap<String, String>,
        rendered_parent: &BTreeMap<String, String>,
        apex: bool,
    ) {
        let mut in_scope = in_scope_parent.clone();
        for (p, u) in &self.ns {
            in_scope.insert(p.clone(), u.clone());
        }
        // Declaraciones a emitir: las que difieren de lo ya emitido por el ancestro de salida.
        let mut decls: Vec<(&String, &String)> = Vec::new();
        for (p, u) in &in_scope {
            let prev = rendered_parent.get(p);
            let needed = if apex {
                // En el ápice se emiten todas las del ámbito (salvo xmlns="" vacío).
                !(p.is_empty() && u.is_empty())
            } else {
                match prev {
                    Some(pu) => pu != u,
                    None => !(p.is_empty() && u.is_empty()),
                }
            };
            if needed {
                decls.push((p, u));
            }
        }
        decls.sort_by(|a, b| a.0.cmp(b.0));
        let mut rendered = rendered_parent.clone();
        for (p, u) in &decls {
            rendered.insert((*p).clone(), (*u).clone());
        }
        out.push('<');
        out.push_str(&self.name);
        for (p, u) in &decls {
            if p.is_empty() {
                out.push_str(&format!(" xmlns=\"{}\"", esc_c14n_attr(u)));
            } else {
                out.push_str(&format!(" xmlns:{p}=\"{}\"", esc_c14n_attr(u)));
            }
        }
        // Atributos ordenados por (uri del espacio de nombres, nombre local); sin prefijo = uri vacía.
        let mut attrs: Vec<(String, String, &String, &String)> = self
            .attrs
            .iter()
            .map(|(k, v)| match k.split_once(':') {
                Some((p, local)) => (
                    in_scope.get(p).cloned().unwrap_or_default(),
                    local.to_string(),
                    k,
                    v,
                ),
                None => (String::new(), k.clone(), k, v),
            })
            .collect();
        attrs.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
        for (_, _, qn, v) in &attrs {
            out.push_str(&format!(" {qn}=\"{}\"", esc_c14n_attr(v)));
        }
        out.push('>');
        for k in &self.kids {
            match k {
                Node::Text(t) => out.push_str(&esc_c14n_text(t)),
                Node::El(e) => e.write_c14n(out, &in_scope, &rendered, false),
            }
        }
        out.push_str("</");
        out.push_str(&self.name);
        out.push('>');
    }
}

fn esc_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
fn esc_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('"', "&quot;")
}
fn esc_c14n_text(s: &str) -> String {
    esc_text(s).replace('\r', "&#xD;")
}
fn esc_c14n_attr(s: &str) -> String {
    esc_attr(s)
        .replace('\t', "&#x9;")
        .replace('\n', "&#xA;")
        .replace('\r', "&#xD;")
}

/// Texto Unicode → bytes ISO-8859-1 (los caracteres fuera de Latin-1 se cambian por «?»).
pub fn latin1(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| {
            if (c as u32) < 256 {
                c as u32 as u8
            } else {
                b'?'
            }
        })
        .collect()
}

/// Bytes ISO-8859-1 → texto Unicode.
pub fn from_latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

/// Documento leído (para quien no depende de `roxmltree` directamente).
pub type RoxDocument<'a> = roxmltree::Document<'a>;

pub fn parse(s: &str) -> Result<RoxDocument<'_>, roxmltree::Error> {
    roxmltree::Document::parse(s)
}

/// Convierte un nodo de `roxmltree` en nuestro árbol (para leer CAF, respuestas del SII o DTE guardados).
pub fn from_rox(n: roxmltree::Node<'_, '_>) -> El {
    let mut e = El::new(n.tag_name().name());
    for ns in n.namespaces() {
        // Solo las declaradas en este mismo elemento.
        let declared_here = match n.parent_element() {
            Some(p) => p.lookup_namespace_uri(ns.name()) != Some(ns.uri()),
            None => true,
        };
        if declared_here {
            e.ns.push((ns.name().unwrap_or("").to_string(), ns.uri().to_string()));
        }
    }
    for a in n.attributes() {
        let name = match a.namespace() {
            Some(uri) => match n.lookup_prefix(uri) {
                Some(p) if !p.is_empty() => format!("{p}:{}", a.name()),
                _ => a.name().to_string(),
            },
            None => a.name().to_string(),
        };
        e.attrs.push((name, a.value().to_string()));
    }
    for c in n.children() {
        if c.is_element() {
            e.kids.push(Node::El(from_rox(c)));
        } else if c.is_text() {
            // Se conservan también los saltos entre elementos: lo firmado debe leerse tal cual.
            let t = c.text().unwrap_or("");
            if !t.is_empty() {
                e.kids.push(Node::Text(t.to_string()));
            }
        }
    }
    e
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonica_hereda_espacios_de_nombres() {
        let doc = El::new("DTE")
            .ns("", "http://www.sii.cl/SiiDte")
            .attr("version", "1.0")
            .child(
                El::new("Documento")
                    .attr("ID", "F1T33")
                    .child(El::text("A", "x & <y>")),
            );
        let mut inh = BTreeMap::new();
        inh.insert(String::new(), "http://www.sii.cl/SiiDte".to_string());
        let d = doc.find("Documento").unwrap();
        assert_eq!(
            d.canonical(&inh),
            "<Documento xmlns=\"http://www.sii.cl/SiiDte\" ID=\"F1T33\"><A>x &amp; &lt;y&gt;</A></Documento>"
        );
        // Un hijo con el mismo espacio de nombres no lo repite; uno distinto sí.
        let s = El::new("Signature")
            .ns("", "http://www.w3.org/2000/09/xmldsig#")
            .child(El::new("SignedInfo"));
        let root = El::new("DTE").ns("", "http://www.sii.cl/SiiDte").child(s);
        assert_eq!(
            root.canonical(&BTreeMap::new()),
            "<DTE xmlns=\"http://www.sii.cl/SiiDte\"><Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\"><SignedInfo></SignedInfo></Signature></DTE>"
        );
    }

    #[test]
    fn documento_en_latin1() {
        let e = El::text("RznSoc", "Ñuñoa Ltda.");
        let b = e.to_document();
        assert!(b.windows(1).any(|w| w[0] == 0xD1));
        assert!(from_latin1(&b).contains("Ñuñoa"));
    }
}
