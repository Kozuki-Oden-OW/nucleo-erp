// Paneles laterales, diálogos y avisos efímeros.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from "lucide-react";
import { cx, IconButton } from "./kit";

function useEscape(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, active]);
}

/** Mantiene el foco dentro del contenedor mientras está abierto y lo devuelve al cerrar. */
function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button:not([data-close])");
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")];
      if (f.length === 0) return;
      const a = f[0]!, z = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    el?.addEventListener("keydown", onKey);
    return () => { el?.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open]);
  return ref;
}

/** Panel lateral derecho: muestra detalle sin perder la lista (Blueprint §4.3). */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "w-[min(560px,100vw)]",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEscape(onClose, open);
  const ref = useFocusTrap(open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx("anim-slide relative flex h-full flex-col border-l border-line bg-surface shadow-pop outline-none", width)}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Cerrar (Esc)" onClick={onClose} data-close />
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEscape(onClose, open);
  const ref = useFocusTrap(open);
  if (!open) return null;
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]">
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} className={cx("anim-in relative w-full rounded-xl border border-line bg-surface shadow-pop outline-none", w)}>
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
          <IconButton icon={X} label="Cerrar (Esc)" onClick={onClose} data-close />
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ───────────── Avisos efímeros (toasts) ───────────── */

type ToastTone = "success" | "danger" | "info" | "warning";
interface ToastItem { id: number; tone: ToastTone; text: ReactNode }
const ToastCtx = createContext<(tone: ToastTone, text: ReactNode) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastTone, text: ReactNode) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "danger" ? 7000 : 4000);
  }, []);
  const icon = { success: CheckCircle2, danger: XCircle, info: Info, warning: AlertTriangle };
  const color = { success: "text-success", danger: "text-danger", info: "text-info", warning: "text-warning" };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
          {items.map((t) => {
            const I = icon[t.tone];
            return (
              <div key={t.id} className="anim-in pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-pop">
                <I size={18} className={cx("mt-px shrink-0", color[t.tone])} aria-hidden />
                <div className="min-w-0 flex-1 text-ink">{t.text}</div>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
