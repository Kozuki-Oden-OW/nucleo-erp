// Calculadora de costo de importación (landed cost) — vista previa de la Fase 3.
// En la Fase 9 este cálculo se mueve a Rust (nucleo-domain) con casos golden revisados por un contador.
// Ningún porcentaje está escrito aquí: arancel e IVA de importación los ingresa el usuario o vienen
// de un paquete normativo con fuente.

export interface ComexItem { description: string; qty: number; fob_unit_cents: number }

export interface ComexScenario {
  name: string;
  transport: "maritimo" | "aereo" | "courier" | "terrestre";
  transit_days: number;
  /** CLP por 1 USD × 1.000.000 */
  rate_e6: number;
  freight_cents: number;
  /** Seguro como monto en USD; si es null se usa insurance_ppm sobre FOB + flete. */
  insurance_cents: number | null;
  insurance_ppm: number;
  duty_ppm: number;
  vat_ppm: number;
  /** Si el IVA de importación se recupera como crédito, no se suma al costo. */
  vat_recoverable: boolean;
  /** Gastos locales en CLP. */
  agent_clp: number;
  port_clp: number;
  inland_clp: number;
  bank_clp: number;
  other_clp: number;
}

export interface ComexItemResult { description: string; qty: number; share_ppm: number; landed_total_clp: number; landed_unit_clp: number }
export interface ComexResult {
  fob_cents: number;
  insurance_cents: number;
  cif_cents: number;
  cif_clp: number;
  duty_clp: number;
  vat_clp: number;
  local_clp: number;
  landed_clp: number;
  items: ComexItemResult[];
}

const r = (x: number) => Math.round(x);

export function computeLanded(items: ComexItem[], s: ComexScenario): ComexResult {
  const fob = items.reduce((a, i) => a + i.qty * i.fob_unit_cents, 0);
  const insurance = s.insurance_cents ?? r(((fob + s.freight_cents) * s.insurance_ppm) / 1_000_000);
  const cif = fob + s.freight_cents + insurance;
  const toClp = (cents: number) => r((cents / 100) * (s.rate_e6 / 1_000_000));
  const cifClp = toClp(cif);
  const duty = r((cifClp * s.duty_ppm) / 1_000_000);
  const vat = r(((cifClp + duty) * s.vat_ppm) / 1_000_000);
  const local = s.agent_clp + s.port_clp + s.inland_clp + s.bank_clp + s.other_clp;
  const landed = cifClp + duty + local + (s.vat_recoverable ? 0 : vat);
  // Prorrateo por valor FOB; el redondeo restante se asigna al último ítem para que la suma cuadre.
  let assigned = 0;
  const res: ComexItemResult[] = items.map((it, idx) => {
    const value = it.qty * it.fob_unit_cents;
    const share = fob > 0 ? value / fob : 0;
    const total = idx === items.length - 1 ? landed - assigned : r(landed * share);
    assigned += total;
    return { description: it.description, qty: it.qty, share_ppm: r(share * 1_000_000), landed_total_clp: total, landed_unit_clp: it.qty > 0 ? r(total / it.qty) : 0 };
  });
  return { fob_cents: fob, insurance_cents: insurance, cif_cents: cif, cif_clp: cifClp, duty_clp: duty, vat_clp: vat, local_clp: local, landed_clp: landed, items: res };
}

/** Precio neto sugerido para lograr un margen sobre el precio de venta. */
export function priceForMargin(unitCost: number, marginPpm: number): number {
  if (marginPpm >= 1_000_000) return 0;
  return r(unitCost / (1 - marginPpm / 1_000_000));
}
