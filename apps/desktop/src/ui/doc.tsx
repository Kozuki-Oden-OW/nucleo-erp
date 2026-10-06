// Piezas de documentos comerciales: estados, cadena documental y entradas de dinero.
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { ChevronRight, CircleCheck, CircleDashed, Clock, FileCheck2, FileWarning, Ban, Wallet } from "lucide-react";
import type { DocLink, QuoteStatus, SaleSummary } from "../data/types";
import { navigate } from "../lib/router";
import { formatMoney, parseMoney } from "../lib/format";
import { Badge, cx, Field, type Tone } from "./kit";

/** Etiquetas de estado de una venta (Blueprint §7.2: "una sola etiqueta con el estado más relevante"). */
export function SaleStatus({ s, compact = false }: { s: Pick<SaleSummary, "commercial_state" | "payment_state" | "documentation_state" | "due_date">; compact?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  if (s.commercial_state === "anulada") return <Badge tone="neutral" icon={Ban}>Anulada</Badge>;
  if (s.commercial_state === "borrador" || s.commercial_state === "cotizada" || s.commercial_state === "aceptada")
    return <Badge tone="info" icon={CircleDashed}>Borrador</Badge>;
  const pay =
    s.payment_state === "pagada" ? <Badge tone="success" icon={CircleCheck}>Pagada</Badge>
      : s.due_date && s.due_date < today ? <Badge tone="danger" icon={Clock}>Atrasada</Badge>
      : s.payment_state === "abonada" ? <Badge tone="warning" icon={Wallet}>Abonada</Badge>
      : <Badge tone="warning" icon={Wallet}>Por cobrar</Badge>;
  const doc =
    s.documentation_state === "pendiente" ? <Badge tone="warning" icon={FileWarning}>{compact ? "Pend. doc." : "Pendiente de documentación"}</Badge>
      : s.documentation_state === "documentada" && !compact ? <Badge tone="neutral" icon={FileCheck2}>Documentada</Badge>
      : null;
  return <span className={cx("inline-flex items-center gap-1", compact ? "flex-nowrap" : "flex-wrap")}>{pay}{doc}</span>;
}

const QUOTE_TONE: Record<QuoteStatus, [Tone, string]> = {
  borrador: ["info", "Borrador"],
  enviada: ["accent", "Enviada"],
  aceptada: ["success", "Aceptada"],
  rechazada: ["neutral", "Rechazada"],
  vencida: ["neutral", "Vencida"],
  convertida: ["success", "Convertida en venta"],
  anulada: ["neutral", "Anulada"],
};
export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const [tone, label] = QUOTE_TONE[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Cadena documental navegable: COT-000147 → VEN-000089 → PAG-000340 → Factura Nº 563. */
export function DocChain({ chain, current }: { chain: DocLink[]; current: string }) {
  const href = (l: DocLink) => {
    if (!l.uid) return null;
    switch (l.kind) {
      case "COT": return `/cotizaciones/${l.uid}`;
      case "VEN": case "FV": return `/ventas/${l.uid}`;
      case "OC": return `/compras/oc/${l.uid}`;
      case "COM": return `/compras/doc/${l.uid}`;
      default: return null;
    }
  };
  return (
    <nav aria-label="Cadena documental" className="flex flex-wrap items-center gap-1.5 text-sm">
      {chain.map((l, i) => {
        const h = href(l);
        const isCurrent = l.number === current;
        return (
          <span key={`${l.number}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-faint" aria-hidden />}
            <button
              disabled={!h || isCurrent}
              onClick={() => h && navigate(h)}
              title={l.label}
              className={cx(
                "rounded-md border px-2 py-0.5 font-mono text-[12.5px]",
                isCurrent ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line bg-surface-2 text-ink",
                h && !isCurrent && "hover:border-accent hover:text-accent",
              )}
            >
              {l.number}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** Entrada de dinero: el usuario escribe "49990" o "49.990" y ve "$ 49.990" al salir. */
export const MoneyField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
    label?: string; hint?: string; value: number | null; onValue: (minor: number | null) => void; currency?: string; error?: string | null;
  }
>(function MoneyField({ value, onValue, currency = "CLP", label, hint, error, ...rest }, ref) {
  const [text, setText] = useState(value === null ? "" : formatMoney(value, currency));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value === null ? "" : formatMoney(value, currency)); }, [value, currency, focused]);
  return (
    <Field
      ref={ref}
      label={label}
      hint={hint}
      error={error}
      inputMode="decimal"
      value={text}
      onFocus={(e) => { setFocused(true); setText(value === null ? "" : String(currency === "CLP" ? value : value / 100).replace(".", ","));
        // Seleccionar después de que React cambie el texto: si no, el navegador pierde la selección y lo digitado se suma al final.
        const el = e.target; requestAnimationFrame(() => { if (document.activeElement === el) el.select(); }); }}
      onBlur={() => { setFocused(false); }}
      onChange={(e) => { setText(e.target.value); onValue(parseMoney(e.target.value, currency)); }}
      inputClassName="text-right num"
      {...rest}
    />
  );
});
