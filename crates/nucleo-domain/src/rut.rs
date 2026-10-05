//! RUT chileno: validación por módulo 11 y formateo.
//! El RUT es opcional en negocios sin datos tributarios (perfil Emprendedor).

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Rut {
    body: u32,
    dv: char,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RutError {
    #[error("el RUT está vacío")]
    Empty,
    #[error("el RUT tiene caracteres no válidos")]
    InvalidCharacters,
    #[error("el número del RUT no es válido")]
    InvalidBody,
    #[error("el dígito verificador no corresponde (debería ser {expected})")]
    WrongCheckDigit { expected: char },
}

impl Rut {
    /// Calcula el dígito verificador (módulo 11).
    pub fn check_digit(body: u32) -> char {
        let mut sum: u32 = 0;
        let mut factor = 2;
        let mut n = body;
        while n > 0 {
            sum += (n % 10) * factor;
            n /= 10;
            factor = if factor == 7 { 2 } else { factor + 1 };
        }
        match 11 - (sum % 11) {
            11 => '0',
            10 => 'K',
            d => char::from_digit(d, 10).unwrap_or('?'),
        }
    }

    /// Acepta "12.345.678-5", "12345678-5", "123456785" y "k" minúscula.
    pub fn parse(input: &str) -> Result<Self, RutError> {
        let clean: String = input
            .chars()
            .filter(|c| !matches!(c, '.' | '-' | ' '))
            .map(|c| c.to_ascii_uppercase())
            .collect();
        if clean.is_empty() {
            return Err(RutError::Empty);
        }
        if clean.len() < 2 {
            return Err(RutError::InvalidBody);
        }
        let (body_str, dv_str) = clean.split_at(clean.len() - 1);
        if !body_str.chars().all(|c| c.is_ascii_digit()) {
            return Err(RutError::InvalidCharacters);
        }
        let dv = dv_str.chars().next().ok_or(RutError::Empty)?;
        if !(dv.is_ascii_digit() || dv == 'K') {
            return Err(RutError::InvalidCharacters);
        }
        let body: u32 = body_str.parse().map_err(|_| RutError::InvalidBody)?;
        if body == 0 {
            return Err(RutError::InvalidBody);
        }
        let expected = Self::check_digit(body);
        if expected != dv {
            return Err(RutError::WrongCheckDigit { expected });
        }
        Ok(Self { body, dv })
    }

    pub fn body(&self) -> u32 {
        self.body
    }
    pub fn dv(&self) -> char {
        self.dv
    }

    /// Forma compacta para guardar y buscar: "12345678-5".
    pub fn compact(&self) -> String {
        format!("{}-{}", self.body, self.dv)
    }
}

impl fmt::Display for Rut {
    /// Forma para mostrar: "12.345.678-5".
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let digits = self.body.to_string();
        let mut out = String::new();
        for (i, c) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i).is_multiple_of(3) {
                out.push('.');
            }
            out.push(c);
        }
        write!(f, "{}-{}", out, self.dv)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digito_verificador_conocido() {
        assert_eq!(Rut::check_digit(12_345_678), '5');
        assert_eq!(Rut::check_digit(11_111_111), '1');
    }

    #[test]
    fn acepta_formatos_comunes() {
        for s in [
            "12.345.678-5",
            "12345678-5",
            "123456785",
            " 12.345.678 - 5 ",
        ] {
            let r = Rut::parse(s).unwrap();
            assert_eq!(r.compact(), "12345678-5");
            assert_eq!(r.to_string(), "12.345.678-5");
        }
    }

    #[test]
    fn rechaza_digito_incorrecto() {
        assert_eq!(
            Rut::parse("12.345.678-9"),
            Err(RutError::WrongCheckDigit { expected: '5' })
        );
    }

    #[test]
    fn rechaza_basura() {
        assert_eq!(Rut::parse(""), Err(RutError::Empty));
        assert_eq!(Rut::parse("ABC-1"), Err(RutError::InvalidCharacters));
        assert_eq!(Rut::parse("0-0"), Err(RutError::InvalidBody));
    }

    #[test]
    fn digito_k_y_cero() {
        // Busca cuerpos cuyo DV sea K y 0, y comprueba que parse los acepta.
        let k = (1..100_000u32)
            .find(|b| Rut::check_digit(*b) == 'K')
            .unwrap();
        let z = (1..100_000u32)
            .find(|b| Rut::check_digit(*b) == '0')
            .unwrap();
        assert!(Rut::parse(&format!("{k}-k")).is_ok());
        assert!(Rut::parse(&format!("{z}-0")).is_ok());
    }

    #[test]
    fn formato_con_puntos() {
        let r = Rut::parse(&format!("1000000-{}", Rut::check_digit(1_000_000))).unwrap();
        assert!(r.to_string().starts_with("1.000.000-"));
    }
}
