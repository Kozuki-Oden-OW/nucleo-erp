// Piezas compartidas de NÚCLEO COMEX: etapas, transporte, campos de tasa y tipo de cambio.
import { useEffect, useState } from "react";
import { Package2, Plane, Ship, Shuffle, Truck, type LucideIcon } from "lucide-react";
import type { ImportStage, TransportMode } from "../../data";
import { STAGE_LABEL } from "../../data/comex";
import { parsePercent } from "../../lib/format";
import { Badge, Field, type Tone } from "../../ui/kit";

/** Etapas en orden (la línea de tiempo de la carpeta). */
export const STAGES: ImportStage[] = [
  "cotizacion", "ordenada", "pagada", "produccion", "lista_despacho", "embarcada", "en_transito",
  "arribada", "internacion", "transporte_local", "recibida", "cerrada",
];
/** Etapas que se eligen a mano (recibida y cerrada tienen su propia acción). */
export const MANUAL_STAGES = STAGES.slice(0, 10);

export const STAGE_HINT: Record<ImportStage, string> = {
  cotizacion: "Evaluando: aún no cuenta como stock por llegar",
  ordenada: "Pedido confirmado al proveedor",
  pagada: "Pagaste la mercadería al proveedor",
  produccion: "El proveedor está fabricando",
  lista_despacho: "Lista para salir del origen",
  embarcada: "Salió del puerto o aeropuerto de origen",
  en_transito: "Viajando a Chile",
  arribada: "Llegó a Chile",
  internacion: "En trámite de aduana",
  transporte_local: "Camino a tu bodega",
  recibida: "Ingresó a tu bodega",
  cerrada: "Costo final fijado",
  anulada: "No se concretó",
};

export function stageTone(s: ImportStage): Tone {
  if (s === "cotizacion") return "neutral";
  if (s === "anulada") return "neutral";
  if (s === "cerrada" || s === "recibida") return "success";
  if (s === "arribada" || s === "internacion" || s === "transporte_local") return "accent";
  return "info";
}

export function StageBadge({ stage }: { stage: ImportStage }) {
  return <Badge tone={stageTone(stage)}>{STAGE_LABEL[stage]}</Badge>;
}

export const TRANSPORT: Record<TransportMode, { label: string; icon: LucideIcon }> = {
  maritimo: { label: "Marítimo", icon: Ship },
  aereo: { label: "Aéreo", icon: Plane },
  terrestre: { label: "Terrestre", icon: Truck },
  courier: { label: "Courier", icon: Package2 },
  multimodal: { label: "Multimodal", icon: Shuffle },
};

/** Porcentaje con coma decimal ↔ partes por millón. Vacío = null (no se sabe). */
export function PercentField({ label, ppm, onPpm, hint, optional, placeholder, ariaLabel }: {
  label: string; ppm: number | null; onPpm: (v: number | null) => void; hint?: string; optional?: boolean; placeholder?: string; ariaLabel?: string;
}) {
  const show = (v: number | null) => (v === null ? "" : String(v / 10_000).replace(".", ","));
  const [text, setText] = useState(show(ppm));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(show(ppm)); }, [ppm, focused]);
  return (
    <Field label={label || undefined} aria-label={ariaLabel ?? (label || undefined)} hint={hint} optional={optional} suffix="%" inputMode="decimal" value={text} placeholder={placeholder} inputClassName="text-right num"
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(e) => { setText(e.target.value); if (!e.target.value.trim()) onPpm(null); else { const v = parsePercent(e.target.value); if (v !== null) onPpm(v); } }} />
  );
}

/** Tipo de cambio: pesos por 1 unidad de la moneda (ej. 951,2) ↔ × 1.000.000. */
export function RateField({ label, rate, onRate, currency, hint }: { label?: string; rate: number | null; onRate: (v: number | null) => void; currency: string; hint?: string }) {
  const show = (v: number | null) => (v === null ? "" : String(v / 1_000_000).replace(".", ","));
  const [text, setText] = useState(show(rate));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(show(rate)); }, [rate, focused]);
  return (
    <Field label={label ?? `Tipo de cambio (CLP por ${currency})`} hint={hint} inputMode="decimal" value={text} inputClassName="text-right num"
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const clean = e.target.value.trim().replace(/\./g, "").replace(",", ".");
        if (!clean) { onRate(null); return; }
        const v = Number(clean);
        if (Number.isFinite(v) && v > 0) onRate(Math.round(v * 1_000_000));
      }} />
  );
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(rate / 1_000_000);
}
