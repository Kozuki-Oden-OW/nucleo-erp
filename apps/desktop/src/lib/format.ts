// Formatos chilenos para la interfaz. Los cálculos oficiales se hacen en Rust (nucleo-domain).

const clp = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const dec = (digits: number) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** Decimales de la unidad mínima por moneda (CLP no tiene centavos). */
export const CURRENCY_DIGITS: Record<string, number> = { CLP: 0, USD: 2, EUR: 2, CNY: 2 };

export function formatCLP(minor: number): string {
  return clp.format(minor);
}

/** Monto en unidad mínima → texto con símbolo. */
export function formatMoney(minor: number, currency = "CLP"): string {
  if (currency === "CLP") return clp.format(minor);
  const d = CURRENCY_DIGITS[currency] ?? 2;
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(minor / 10 ** d);
}

/** Abreviado para gráficos y tarjetas: $ 1,2 M · $ 850 mil. */
export function formatMoneyShort(minor: number): string {
  const a = Math.abs(minor);
  const s = minor < 0 ? "−" : "";
  if (a >= 1_000_000_000) return `${s}$ ${dec(1).format(a / 1_000_000_000)} mil M`;
  if (a >= 1_000_000) return `${s}$ ${dec(1).format(a / 1_000_000)} M`;
  if (a >= 10_000) return `${s}$ ${int.format(Math.round(a / 1000))} mil`;
  return `${s}${clp.format(a)}`;
}

export function formatInt(n: number): string {
  return int.format(n);
}

/** Cantidad en milésimas → "2,5". */
export function formatQty(milli: number): string {
  return dec(3).format(milli / 1000);
}

/** Proporción en partes por millón → "12,5 %". */
export function formatPpm(ppm: number, digits = 1): string {
  return `${dec(digits).format(ppm / 10_000)} %`;
}

/** "2026-10-05" → "05-10-2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : iso;
}

/** "2026-10-05" → "5 oct". */
export function formatDayShort(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short" }).replace(".", "");
}

export function formatMonthShort(ym: string): string {
  const d = new Date(`${ym.slice(0, 7)}-15T12:00:00`);
  return d.toLocaleDateString("es-CL", { month: "short" }).replace(".", "");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** "12345678-5" → "12.345.678-5" (solo presentación). */
export function formatRut(compact: string | null | undefined): string {
  if (!compact) return "—";
  const [body, dv] = compact.split("-");
  if (!body || !dv) return compact;
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

/** Texto de un monto digitado ("49.990", "$ 1.200", "12,50") → unidad mínima. null si no es válido. */
export function parseMoney(text: string, currency = "CLP"): number | null {
  const d = CURRENCY_DIGITS[currency] ?? 2;
  const clean = text.replace(/[$\s]|[A-Z]{3}/g, "").replace(/\./g, "").replace(",", ".");
  if (clean === "" || !/^-?\d+(\.\d+)?$/.test(clean)) return null;
  return Math.round(Number(clean) * 10 ** d);
}

/** "2,5" → 2500 milésimas. */
export function parseQty(text: string): number | null {
  const clean = text.trim().replace(/\./g, "").replace(",", ".");
  if (clean === "" || !/^\d+(\.\d{1,3})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 1000);
}

/** "12,5" (%) → 125000 ppm. */
export function parsePercent(text: string): number | null {
  const clean = text.trim().replace("%", "").replace(",", ".");
  if (clean === "" || !/^\d+(\.\d+)?$/.test(clean)) return null;
  const v = Math.round(Number(clean) * 10_000);
  return v <= 1_000_000 ? v : null;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000);
}

export const PROFILE_LABEL: Record<string, string> = {
  emprendedor: "Emprendedor",
  negocio: "Negocio",
  empresa: "Empresa",
};
