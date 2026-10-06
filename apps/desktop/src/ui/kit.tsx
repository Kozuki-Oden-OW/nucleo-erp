// Componentes base del sistema de diseño NÚCLEO (Fase 3). Ver docs/UX.md.
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { LucideIcon } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ───────────── Botones ───────────── */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  subtle: "bg-accent-soft text-accent hover:brightness-95",
  danger: "bg-danger text-white hover:brightness-110",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-ctl px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon; kbd?: string }
>(function Button({ variant = "primary", size = "md", icon: Icon, kbd, className, children, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={size === "sm" ? 15 : 17} strokeWidth={2} aria-hidden />}
      {children}
      {kbd && <Kbd className="ml-1 opacity-70">{kbd}</Kbd>}
    </button>
  );
});

export function IconButton({
  icon: Icon,
  label,
  className,
  size = 18,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: number }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40", className)}
      {...props}
    >
      <Icon size={size} aria-hidden />
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("rounded border border-line bg-surface-2 px-1.5 py-px font-sans text-[11px] font-medium text-muted", className)}>
      {children}
    </kbd>
  );
}

/* ───────────── Formularios ───────────── */

const CONTROL =
  "h-ctl w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-surface-2 disabled:text-muted";

export function Label({ children, htmlFor, optional }: { children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
      {children}
      {optional && <span className="ml-1 font-normal text-faint">(opcional)</span>}
    </label>
  );
}

type FieldShell = { label?: string; hint?: ReactNode; error?: string | null; optional?: boolean; className?: string };

function Shell({ id, label, hint, error, optional, className, children }: FieldShell & { id?: string; children: ReactNode }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {label && <Label htmlFor={id} optional={optional}>{label}</Label>}
      {children}
      {error ? <span className="text-xs text-danger" role="alert">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

let autoId = 0;
const nextId = () => `f${++autoId}`;

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldShell & { suffix?: ReactNode; leading?: ReactNode; inputClassName?: string }>(
  function Field({ label, hint, error, optional, className, id, suffix, leading, inputClassName, ...props }, ref) {
    const fid = id ?? nextId();
    return (
      <Shell id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
        <div className="relative flex items-center">
          {leading && <span className="pointer-events-none absolute left-3 text-sm text-muted">{leading}</span>}
          <input
            ref={ref}
            id={fid}
            aria-invalid={!!error || undefined}
            className={cx(CONTROL, leading ? "pl-8" : "", suffix ? "pr-10" : "", error && "border-danger", inputClassName)}
            {...props}
          />
          {suffix && <span className="pointer-events-none absolute right-3 text-sm text-muted">{suffix}</span>}
        </div>
      </Shell>
    );
  },
);

export function Select({
  label,
  hint,
  error,
  optional,
  className,
  id,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldShell & { options: { value: string; label: string }[] }) {
  const fid = id ?? nextId();
  return (
    <Shell id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <select id={fid} className={cx(CONTROL, "pr-8")} {...props}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Shell>
  );
}

export function TextArea({ label, hint, error, optional, className, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShell) {
  const fid = id ?? nextId();
  return (
    <Shell id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea id={fid} className={cx(CONTROL, "h-auto min-h-20 py-2")} {...props} />
    </Shell>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Selector segmentado (2–4 opciones excluyentes). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {o.icon && <o.icon size={14} aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Superficies ───────────── */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface shadow-card", className)}>
      {(title || actions) && (
        <header className={cx("flex items-start justify-between gap-4", padded ? "px-5 pt-4" : "border-b border-line px-5 py-3")}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONE_SOFT[tone], className)}>
      {Icon && <Icon size={12} strokeWidth={2.25} aria-hidden />}
      {children}
    </span>
  );
}

/** Indicador del dashboard: una cifra con su etiqueta, en lenguaje de negocio. */
export function Kpi({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const valueColor = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cx(
        "flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-card",
        onClick && "transition-colors hover:border-accent/50 hover:bg-surface-2/40",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {Icon && <Icon size={14} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cx("num mt-2 text-[22px] font-semibold leading-tight", valueColor)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Tag>
  );
}

export function Notice({
  tone = "info",
  title,
  icon: Icon,
  children,
  actions,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const style = {
    info: "border-info/30 bg-info-soft",
    success: "border-success/30 bg-success-soft",
    warning: "border-warning/40 bg-warning-soft",
    danger: "border-danger/30 bg-danger-soft",
  }[tone];
  const color = { info: "text-info", success: "text-success", warning: "text-warning", danger: "text-danger" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-lg border px-4 py-3", style)}>
      {Icon && <Icon size={18} className={cx("mt-0.5 shrink-0", color)} aria-hidden />}
      <div className="min-w-0 flex-1 text-sm text-ink">
        {title && <div className={cx("font-semibold", color)}>{title}</div>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Icon size={22} aria-hidden />
        </div>
      )}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            value === t.value ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cx("num rounded-full px-1.5 text-[11px]", value === t.value ? "bg-accent-soft" : "bg-surface-2")}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Lista de pares etiqueta–valor (fichas y paneles laterales). */
export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{it.label}</dt>
          <dd className="min-w-0 break-words text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ label = "Cargando…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden />
      {label}
    </div>
  );
}
