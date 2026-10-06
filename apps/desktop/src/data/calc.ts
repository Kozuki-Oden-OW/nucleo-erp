// Vista previa de totales mientras se digita. El valor oficial lo calcula y guarda el backend
// (nucleo-domain::pricing, en Rust); esta función replica su regla por documento con redondeo
// "mitad hacia arriba" solo para mostrar el resultado al instante.
import type { Line, LineInput, Totals } from "./types";

const roundHalfUp = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

export function lineAmounts(l: LineInput): { gross: number; discount: number; net: number } {
  const gross = roundHalfUp((l.qty_milli * l.unit_price_minor) / 1000);
  const discount = roundHalfUp((gross * l.discount_ppm) / 1_000_000);
  return { gross, discount, net: gross - discount };
}

export function computeLines(lines: LineInput[]): Line[] {
  return lines.map((l, i) => {
    const a = lineAmounts(l);
    return { ...l, line_no: i + 1, net_minor: a.net, discount_minor: a.discount, unit_cost_e4: null };
  });
}

/** taxRatePpm = null → el negocio no calcula impuesto (perfil sin IVA). */
export function computeTotals(lines: LineInput[], taxRatePpm: number | null): Totals {
  let net = 0, exempt = 0, discount = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    discount += a.discount;
    if (l.taxable && taxRatePpm !== null) net += a.net;
    else exempt += a.net;
  }
  const tax = taxRatePpm === null ? 0 : roundHalfUp((net * taxRatePpm) / 1_000_000);
  return { net_minor: net, exempt_minor: exempt, discount_minor: discount, tax_minor: tax, total_minor: net + exempt + tax };
}

export function lineIsValid(l: LineInput): boolean {
  return l.description.trim().length > 0 && l.qty_milli > 0 && l.unit_price_minor >= 0 && l.discount_ppm >= 0 && l.discount_ppm <= 1_000_000;
}
