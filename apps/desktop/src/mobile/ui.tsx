// Piezas de la interfaz móvil: botones grandes, filas táctiles, hojas que suben desde abajo.
import { useEffect, type ReactNode } from "react";
import { ChevronLeft, Minus, Plus, X, type LucideIcon } from "lucide-react";
import { cx } from "../ui/kit";
import { formatMoney } from "../lib/format";

export function TopBar({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3">
        {onBack ? (
          <button onClick={onBack} aria-label="Volver" className="m-press -ml-1 grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-surface-2"><ChevronLeft size={24} /></button>
        ) : <span className="w-1" />}
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold text-ink">{title}</h1>
        {right}
      </div>
    </header>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("px-4", className)}>
      {(title || action) && (
        <div className="mb-2 mt-5 flex items-center justify-between">
          {title && <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("overflow-hidden rounded-2xl border border-line bg-surface shadow-card", className)}>{children}</div>;
}

export function Row({ icon: Icon, title, sub, right, onClick, tone }: {
  icon?: LucideIcon; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; tone?: "danger" | "warning" | "success" | "accent";
}) {
  const toneCls = tone === "danger" ? "bg-danger-soft text-danger" : tone === "warning" ? "bg-warning-soft text-warning" : tone === "success" ? "bg-success-soft text-success" : "bg-accent-soft text-accent";
  const body = (
    <>
      {Icon && <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", toneCls)}><Icon size={20} /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-right">{right}</span>}
    </>
  );
  const cls = "flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0";
  return onClick ? <button onClick={onClick} className={cx(cls, "m-press active:bg-surface-2")}>{body}</button> : <div className={cls}>{body}</div>;
}

export function BigButton({ children, onClick, disabled, variant = "primary", icon: Icon, type = "button" }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger"; icon?: LucideIcon; type?: "button" | "submit";
}) {
  const v = variant === "primary" ? "bg-accent text-accent-contrast" : variant === "danger" ? "bg-danger text-white" : "border border-line-strong bg-surface text-ink";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cx("m-press flex h-13 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-semibold disabled:opacity-40", v)} style={{ height: 52 }}>
      {Icon && <Icon size={20} />}{children}
    </button>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cx("m-press shrink-0 rounded-full border px-3.5 py-2 text-[14px] font-medium",
      active ? "border-accent bg-accent text-accent-contrast" : "border-line bg-surface text-ink")}>{children}</button>
  );
}

export function Stepper({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface">
      <button aria-label="Quitar uno" onClick={() => onChange(Math.max(min, value - 1))} className="m-press grid h-9 w-9 place-items-center text-ink"><Minus size={16} /></button>
      <span className="num w-8 text-center text-[15px] font-semibold">{value}</span>
      <button aria-label="Agregar uno" onClick={() => onChange(value + 1)} className="m-press grid h-9 w-9 place-items-center text-ink"><Plus size={16} /></button>
    </span>
  );
}

export function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-medium text-ink">{label}</span>
      <input {...props} className={cx("h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[16px] text-ink placeholder:text-faint focus:border-accent focus:outline-none", props.className)} />
    </label>
  );
}

/** Campo de monto en pesos: muestra $ 12.500 mientras se escribe solo con números. */
export function MoneyInput({ label, value, onValue, autoFocus }: { label: string; value: number | null; onValue: (v: number | null) => void; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-medium text-ink">{label}</span>
      <input inputMode="numeric" autoFocus={autoFocus} value={value === null ? "" : formatMoney(value)} placeholder="$ 0"
        onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); onValue(d ? Number(d) : null); }}
        className="num h-14 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[24px] font-semibold text-ink placeholder:text-faint focus:border-accent focus:outline-none" />
    </label>
  );
}

/** Hoja que sube desde abajo (detalle de un producto, un cliente…). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <button aria-label="Cerrar" className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div className="m-sheet pb-safe relative max-h-[88vh] overflow-hidden rounded-t-3xl bg-surface shadow-pop">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line-strong" />
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="m-press grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted"><X size={18} /></button>
        </div>
        <div className="m-scroll max-h-[calc(88vh-64px)] px-4 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function Money({ minor, className }: { minor: number; className?: string }) {
  return <span className={cx("num", className)}>{formatMoney(minor)}</span>;
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-muted"><Icon size={26} /></span>
      <p className="mt-3 text-[16px] font-semibold text-ink">{title}</p>
      {children && <p className="mt-1 text-[14px] text-muted">{children}</p>}
    </div>
  );
}
