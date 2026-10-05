//! Numeración interna de NÚCLEO (COT-000001, VEN-000001, FV-000001…).
//! No corresponde a folios tributarios ni pretende reemplazarlos (ADR-003).

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum NumberingError {
    #[error("el prefijo debe tener entre 1 y 6 letras mayúsculas o dígitos")]
    InvalidPrefix,
    #[error("el correlativo debe ser mayor que cero")]
    InvalidNumber,
}

/// Ancho por defecto del correlativo (6 dígitos), configurable por tipo de documento.
pub const DEFAULT_WIDTH: usize = 6;

pub fn validate_prefix(prefix: &str) -> Result<(), NumberingError> {
    let ok = (1..=6).contains(&prefix.len())
        && prefix
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(NumberingError::InvalidPrefix)
    }
}

/// `format_number("COT", 147, 6)` → `"COT-000147"`.
pub fn format_number(prefix: &str, number: u64, width: usize) -> Result<String, NumberingError> {
    validate_prefix(prefix)?;
    if number == 0 {
        return Err(NumberingError::InvalidNumber);
    }
    Ok(format!("{prefix}-{number:0width$}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatos_de_la_vision() {
        assert_eq!(
            format_number("COT", 147, DEFAULT_WIDTH).unwrap(),
            "COT-000147"
        );
        assert_eq!(
            format_number("VEN", 89, DEFAULT_WIDTH).unwrap(),
            "VEN-000089"
        );
        assert_eq!(format_number("FV", 1, DEFAULT_WIDTH).unwrap(), "FV-000001");
    }

    #[test]
    fn crece_mas_alla_del_ancho() {
        assert_eq!(format_number("VEN", 1_234_567, 6).unwrap(), "VEN-1234567");
    }

    #[test]
    fn valida_prefijo() {
        assert_eq!(
            format_number("cot", 1, 6),
            Err(NumberingError::InvalidPrefix)
        );
        assert_eq!(format_number("", 1, 6), Err(NumberingError::InvalidPrefix));
        assert_eq!(
            format_number("COT", 0, 6),
            Err(NumberingError::InvalidNumber)
        );
    }
}
