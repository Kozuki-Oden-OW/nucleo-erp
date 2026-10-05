//! Utilidades compartidas por las herramientas de desarrollo.

/// Generador pseudoaleatorio determinista (xorshift64*), suficiente para datos de prueba.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Entero en [lo, hi).
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next_u64() % (hi - lo) as u64) as i64
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.range(0, items.len() as i64) as usize]
    }
    pub fn chance(&mut self, pct: i64) -> bool {
        self.range(0, 100) < pct
    }
}

/// Fecha 'AAAA-MM-DD' a `days` días antes de 2026-10-05 (fecha fija para resultados reproducibles).
pub fn date_back(days: i64) -> String {
    // Días desde el epoch civil (algoritmo de Howard Hinnant).
    fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }
    fn civil_from_days(z: i64) -> (i64, i64, i64) {
        let z = z + 719468;
        let era = if z >= 0 { z } else { z - 146096 } / 146097;
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        (if m <= 2 { y + 1 } else { y }, m, d)
    }
    let (y, m, d) = civil_from_days(days_from_civil(2026, 10, 5) - days);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fechas_hacia_atras() {
        assert_eq!(date_back(0), "2026-10-05");
        assert_eq!(date_back(5), "2026-09-30");
        assert_eq!(date_back(365), "2025-10-05");
        assert_eq!(date_back(279), "2025-12-30");
    }
}
