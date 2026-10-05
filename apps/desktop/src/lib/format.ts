// Formatos chilenos para la interfaz. Los cálculos oficiales se hacen en Rust.

const clp = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export function formatCLP(minor: number): string {
  return clp.format(minor);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** "12345678-5" → "12.345.678-5" (solo presentación). */
export function formatRut(compact: string | null): string {
  if (!compact) return "—";
  const [body, dv] = compact.split("-");
  if (!body || !dv) return compact;
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

export const PROFILE_LABEL: Record<string, string> = {
  emprendedor: "Emprendedor",
  negocio: "Negocio",
  empresa: "Empresa",
};
