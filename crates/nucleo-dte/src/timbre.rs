//! Código de barras PDF417 del timbre electrónico (TED) para la representación impresa del DTE.
//!
//! El SII pide PDF417 con nivel de corrección de errores 5 y los bytes del TED tal como se firmaron
//! (ISO-8859-1, «aplanado»), en modo binario. El tamaño impreso recomendado es de unos 9 × 3 cm, así
//! que se eligen las columnas que dejan el símbolo lo más cerca posible de esa proporción.

use crate::pdf417_tabla::PATRONES;
use crate::{DteError, DteResult};

/// Nivel de corrección de errores que exige el SII (64 palabras de corrección).
const NIVEL: usize = 5;
const CORRECCION: usize = 1 << (NIVEL + 1);
/// Alto de cada fila, en módulos (mínimo que recomienda la norma del PDF417).
pub const ALTO_FILA: usize = 3;
const MAX_PALABRAS: usize = 928;
/// Patrones de inicio (17 módulos) y de término (18 módulos) de cada fila.
const INICIO: u32 = 0b1_1111_1110_1010_1000;
const TERMINO: u32 = 0b11_1111_1010_0010_1001;
/// Palabras de control: cambio a modo binario (largo múltiplo de 6 o no) y relleno.
const BINARIO_6: u16 = 924;
const BINARIO: u16 = 901;
const RELLENO: u16 = 900;

/// Símbolo PDF417 como matriz de módulos (true = negro), una fila de la matriz por fila del símbolo.
#[derive(Debug, Clone)]
pub struct Pdf417 {
    pub ancho: usize,
    pub filas: usize,
    pub modulos: Vec<bool>,
}

/// Datos en modo binario: cada 6 bytes son 5 palabras en base 900; los bytes que sobran van uno por
/// palabra.
fn palabras_binarias(datos: &[u8]) -> Vec<u16> {
    let mut out = vec![if datos.len().is_multiple_of(6) {
        BINARIO_6
    } else {
        BINARIO
    }];
    let mut grupos = datos.chunks_exact(6);
    for g in &mut grupos {
        let mut v = g.iter().fold(0u64, |a, b| (a << 8) | *b as u64);
        let mut cinco = [0u16; 5];
        for c in cinco.iter_mut().rev() {
            *c = (v % 900) as u16;
            v /= 900;
        }
        out.extend_from_slice(&cinco);
    }
    out.extend(grupos.remainder().iter().map(|b| *b as u16));
    out
}

/// Coeficientes del polinomio generador de Reed-Solomon sobre GF(929): ∏ (x − 3^j), j = 1..k.
fn generador(k: usize) -> Vec<u32> {
    let mut g = vec![0u32; k + 1];
    g[0] = 1;
    let mut a = 1u32;
    for j in 1..=k {
        a = a * 3 % 929;
        for i in (1..=j).rev() {
            g[i] = (g[i - 1] + 929 - a * g[i] % 929) % 929;
        }
        g[0] = (929 - a * g[0] % 929) % 929;
    }
    g.truncate(k);
    g
}

/// Palabras de corrección de errores para `datos` (incluye el indicador de largo).
fn correccion(datos: &[u16], k: usize) -> Vec<u16> {
    let g = generador(k);
    let mut e = vec![0u32; k];
    for d in datos {
        let t = (*d as u32 + e[k - 1]) % 929;
        for j in (1..k).rev() {
            e[j] = (e[j - 1] + 929 - t * g[j] % 929) % 929;
        }
        e[0] = (929 - t * g[0] % 929) % 929;
    }
    e.iter().rev().map(|x| ((929 - x) % 929) as u16).collect()
}

/// Codifica `datos` (los bytes del TED) en un PDF417 con corrección de errores nivel 5.
pub fn pdf417(datos: &[u8]) -> DteResult<Pdf417> {
    if datos.is_empty() {
        return Err(DteError::Validation("el timbre está vacío".into()));
    }
    let binarias = palabras_binarias(datos);
    // Indicador de largo + datos + corrección.
    let necesarias = 1 + binarias.len() + CORRECCION;
    if necesarias > MAX_PALABRAS {
        return Err(DteError::Validation(format!(
            "el timbre es demasiado grande para un PDF417 ({necesarias} palabras, máximo {MAX_PALABRAS})"
        )));
    }
    // Columnas que dejan el símbolo más cerca de 3:1 (ancho:alto), dentro de los límites del PDF417.
    let (cols, filas) = (6usize..=30)
        .filter_map(|c| {
            let f = necesarias.div_ceil(c).max(3);
            (f <= 90 && f * c <= MAX_PALABRAS).then_some((c, f))
        })
        .min_by_key(|(c, f)| {
            let ancho = (69 + 17 * c) as i64;
            let alto = (f * ALTO_FILA) as i64;
            (ancho - 3 * alto).abs()
        })
        .ok_or_else(|| DteError::Validation("el timbre no cabe en un PDF417".into()))?;
    let total_datos = cols * filas - CORRECCION;
    let mut palabras = Vec::with_capacity(cols * filas);
    palabras.push(total_datos as u16);
    palabras.extend_from_slice(&binarias);
    palabras.resize(total_datos, RELLENO);
    let ecc = correccion(&palabras, CORRECCION);
    palabras.extend_from_slice(&ecc);

    let ancho = 69 + 17 * cols;
    let mut modulos = Vec::with_capacity(ancho * filas);
    let mut bits = |valor: u32, n: u32| {
        for i in (0..n).rev() {
            modulos.push(valor >> i & 1 == 1);
        }
    };
    let patron = |grupo: usize, palabra: usize| 0x1_0000 | PATRONES[grupo * 929 + palabra] as u32;
    let (v_filas, v_cols) = ((filas - 1) / 3, cols - 1);
    let v_nivel = NIVEL * 3 + (filas - 1) % 3;
    for f in 0..filas {
        let grupo = f % 3;
        let base = (f / 3) * 30;
        let (izq, der) = match grupo {
            0 => (v_filas, v_cols),
            1 => (v_nivel, v_filas),
            _ => (v_cols, v_nivel),
        };
        bits(INICIO, 17);
        bits(patron(grupo, base + izq), 17);
        for c in 0..cols {
            bits(patron(grupo, palabras[f * cols + c] as usize), 17);
        }
        bits(patron(grupo, base + der), 17);
        bits(TERMINO, 18);
    }
    Ok(Pdf417 {
        ancho,
        filas,
        modulos,
    })
}

impl Pdf417 {
    /// SVG del símbolo (un módulo = 1 unidad; cada fila mide `ALTO_FILA`), con zona de silencio de 2
    /// módulos. Se escala con CSS al tamaño de impresión.
    pub fn svg(&self) -> String {
        const Q: usize = 2;
        let (w, h) = (self.ancho + 2 * Q, self.filas * ALTO_FILA + 2 * Q);
        let mut d = String::new();
        for f in 0..self.filas {
            let fila = &self.modulos[f * self.ancho..(f + 1) * self.ancho];
            let y = Q + f * ALTO_FILA;
            let mut x = 0;
            while x < self.ancho {
                if fila[x] {
                    let ini = x;
                    while x < self.ancho && fila[x] {
                        x += 1;
                    }
                    d.push_str(&format!(
                        "M{} {}h{}v{}h-{}z",
                        Q + ini,
                        y,
                        x - ini,
                        ALTO_FILA,
                        x - ini
                    ));
                } else {
                    x += 1;
                }
            }
        }
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"Timbre electrónico SII\"><rect width=\"{w}\" height=\"{h}\" fill=\"#fff\"/><path fill=\"#000\" d=\"{d}\"/></svg>"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timbre_tipico_cabe_y_queda_apaisado() {
        // Un TED real mide entre 700 y 900 bytes.
        let datos: Vec<u8> = (0..850u32).map(|i| (i * 7 % 251) as u8).collect();
        let p = pdf417(&datos).unwrap();
        assert_eq!(p.modulos.len(), p.ancho * p.filas);
        let razon = p.ancho as f64 / (p.filas * ALTO_FILA) as f64;
        assert!((2.5..3.6).contains(&razon), "proporción {razon}");
        // Cada fila empieza con el patrón de inicio (8 negros, 1 blanco…) y termina en negro.
        for f in 0..p.filas {
            let fila = &p.modulos[f * p.ancho..(f + 1) * p.ancho];
            assert!(fila[..8].iter().all(|m| *m) && !fila[8]);
            assert!(fila[p.ancho - 1]);
        }
        let svg = p.svg();
        assert!(svg.starts_with("<svg") && svg.contains("crispEdges"));
        // Demasiado grande: error claro, sin pánico.
        assert!(pdf417(&vec![1u8; 1200]).is_err());
        assert!(pdf417(b"").is_err());
    }

    #[test]
    fn reed_solomon_de_la_norma() {
        // Primeros y último coeficiente del nivel 5 según la tabla de la norma (orden inverso).
        let g = generador(64);
        assert_eq!(&g[..5], &[539, 422, 6, 93, 862]);
        assert_eq!(g[63], 543);
        // Ejemplo conocido de nivel 0 (2 palabras de corrección).
        let datos = [
            16u16, 902, 1, 278, 827, 900, 295, 902, 2, 326, 823, 544, 900, 149, 900, 900,
        ];
        assert_eq!(correccion(&datos, 2), vec![156, 765]);
    }

    #[test]
    fn modo_binario() {
        // «alcool» en binario: ejemplo de la norma (6 bytes → 5 palabras).
        assert_eq!(
            palabras_binarias(b"alcool"),
            vec![924, 163, 238, 432, 766, 244]
        );
        assert_eq!(palabras_binarias(b"ab"), vec![901, 97, 98]);
    }
}
