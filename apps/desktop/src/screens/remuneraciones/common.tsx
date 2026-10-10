// Piezas compartidas de Remuneraciones: campos con decimales fijos, editor de haberes y descuentos,
// etiquetas y el selector de mes.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { DeductionItem, EarningItem } from "../../data/payroll";
import type { ContractType, PayslipStatus } from "../../data";
import { todayIso } from "../../lib/format";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Checkbox, Field, IconButton, type Tone } from "../../ui/kit";
import { periodLabel, shiftPeriod } from "../impuestos/Impuestos";

export { periodLabel, shiftPeriod };

export const CONTRACT_LABEL: Record<ContractType, string> = {
  indefinido: "Contrato indefinido",
  plazo_fijo: "Plazo fijo u obra",
  sin_contrato: "Sin contrato (sueldo empresarial)",
};

export const STATUS: Record<PayslipStatus, { label: string; tone: Tone }> = {
  nueva: { label: "Por preparar", tone: "neutral" },
  borrador: { label: "Borrador", tone: "info" },
  emitida: { label: "Emitida", tone: "success" },
  anulada: { label: "Anulada", tone: "danger" },
};

export function SlipBadge({ status, complete = true }: { status: PayslipStatus; complete?: boolean }) {
  if (status !== "emitida" && status !== "anulada" && !complete) return <Badge tone="warning">Falta información</Badge>;
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

/** Número con decimales fijos guardado como entero escalado (UF × 100, UTM × 10.000…). */
export function ScaledField({ label, value, scale, onValue, hint, suffix, optional, ariaLabel, placeholder, fixed = false }: {
  label?: string; value: number | null | undefined; scale: number; onValue: (v: number | null) => void;
  hint?: string; suffix?: string; optional?: boolean; ariaLabel?: string; placeholder?: string;
  /** Mostrar siempre todos los decimales (UF: 41.057,20). */
  fixed?: boolean;
}) {
  const digits = Math.round(Math.log10(scale));
  const show = (v: number | null | undefined) =>
    v == null ? "" : new Intl.NumberFormat("es-CL", { minimumFractionDigits: fixed ? digits : 0, maximumFractionDigits: digits }).format(v / scale);
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(show(value)); }, [value, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label={label} aria-label={ariaLabel ?? label} hint={hint} optional={optional} suffix={suffix} inputMode="decimal" value={text} placeholder={placeholder}
      inputClassName="text-right num" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const clean = e.target.value.trim().replace(/\./g, "").replace(",", ".");
        if (!clean) { onValue(null); return; }
        if (/^\d+(\.\d+)?$/.test(clean)) onValue(Math.round(Number(clean) * scale));
      }} />
  );
}

const EARNING_PRESETS: EarningItem[] = [
  { label: "Colación", amount: 0, taxable: false, lre: 2301 },
  { label: "Movilización", amount: 0, taxable: false, lre: 2302 },
  { label: "Bono", amount: 0, taxable: true, lre: 2111 },
  { label: "Comisiones", amount: 0, taxable: true, lre: 2103 },
];
const DEDUCTION_PRESETS: DeductionItem[] = [
  { label: "Préstamo de la empresa", amount: 0, lre: 3188 },
  { label: "Cuota sindical", amount: 0, lre: 3171 },
  { label: "Otro descuento autorizado", amount: 0, lre: 3183 },
];

/** Lista editable de haberes (con "imponible") o de descuentos. */
export function ItemsEditor<T extends EarningItem | DeductionItem>({ kind, items, onChange, disabled }: {
  kind: "haber" | "descuento"; items: T[]; onChange: (v: T[]) => void; disabled?: boolean;
}) {
  const presets = (kind === "haber" ? EARNING_PRESETS : DEDUCTION_PRESETS) as T[];
  const set = (i: number, patch: Partial<T>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Field className="min-w-[10rem] flex-1" aria-label={kind === "haber" ? "Nombre del haber" : "Nombre del descuento"} value={it.label} disabled={disabled}
            onChange={(e) => set(i, { label: e.target.value } as Partial<T>)} />
          <MoneyField className="w-36" aria-label="Monto" value={it.amount || null} disabled={disabled} onValue={(v) => set(i, { amount: v ?? 0 } as Partial<T>)} />
          <div className="flex items-center gap-2">
            {kind === "haber" && (
              <Checkbox label={<span className="text-xs">Imponible</span>} checked={(it as EarningItem).taxable ?? true}
                onChange={(v) => set(i, { taxable: v } as unknown as Partial<T>)} />
            )}
            {!disabled && <IconButton icon={Trash2} label="Quitar" onClick={() => onChange(items.filter((_, j) => j !== i))} />}
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button key={p.label} size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...items, { ...p }])}>{p.label}</Button>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...items, { label: "", amount: 0, ...(kind === "haber" ? { taxable: true } : {}) } as T])}>Otro</Button>
        </div>
      )}
    </div>
  );
}

/** Selector de mes con flechas (hasta el mes siguiente al actual). */
export function MonthPicker({ period, onChange, label }: { period: string; onChange: (p: string) => void; label: string }) {
  const max = shiftPeriod(todayIso().slice(0, 7), 1);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => onChange(shiftPeriod(period, -1))} />
      <label className="sr-only" htmlFor="periodo-rem">Mes</label>
      <input id="periodo-rem" type="month" value={period} max={max} onChange={(e) => e.target.value && onChange(e.target.value)}
        className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none" />
      <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => onChange(shiftPeriod(period, 1))} disabled={period >= max} />
      <span className="ml-1 text-sm text-muted">{label} <strong className="font-medium capitalize text-ink">{periodLabel(period)}</strong></span>
    </div>
  );
}
