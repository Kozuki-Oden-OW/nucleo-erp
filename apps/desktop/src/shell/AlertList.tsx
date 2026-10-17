// «Requiere tu atención»: lista de alertas con su explicación, ejemplos concretos y la acción.
// La usan el Inicio (completa) y la campana de la barra superior (compacta).
import { useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { AlertItem } from "../data";
import { navigate } from "../lib/router";
import { cx } from "../ui/kit";

const ICON = { alta: CircleAlert, media: TriangleAlert, info: Info } as const;
const TONE = { alta: "text-danger", media: "text-warning", info: "text-info" } as const;

export function AlertList({ alerts, compact = false, onNavigate }: { alerts: AlertItem[]; compact?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const go = (href: string) => { onNavigate?.(); navigate(href); };
  if (alerts.length === 0) return <p className="text-sm text-muted">Nada urgente. ¡Buen trabajo!</p>;
  return (
    <ul className={cx("flex flex-col", compact ? "gap-0.5" : "divide-y divide-line")}>
      {alerts.map((a) => {
        const Icon = ICON[a.severity];
        const expanded = open === a.kind;
        if (compact) {
          return (
            <li key={a.kind}>
              <button onClick={() => go(a.href)} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2">
                <Icon size={16} className={cx("mt-0.5 shrink-0", TONE[a.severity])} aria-hidden />
                <span className="min-w-0 flex-1 text-ink">{a.title}</span>
              </button>
            </li>
          );
        }
        return (
          <li key={a.kind} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <Icon size={18} className={cx("mt-0.5 shrink-0", TONE[a.severity])} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{a.title}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted">{a.detail}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button className="text-[13px] font-medium text-accent hover:underline" onClick={() => go(a.href)}>{a.action}</button>
                  {a.lines.length > 0 && (
                    <button className="inline-flex items-center gap-0.5 text-[13px] text-muted hover:text-ink" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : a.kind)}>
                      {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                      {expanded ? "Ocultar detalle" : `Ver detalle${a.count > a.lines.length ? ` (${a.lines.length} de ${a.count})` : ""}`}
                    </button>
                  )}
                </div>
                {expanded && (
                  <ul className="mt-2 flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                    {a.lines.map((l, i) => (
                      <li key={i} className="flex items-baseline gap-3">
                        {l.href
                          ? <button className="min-w-0 flex-1 truncate text-left text-ink hover:text-accent hover:underline" onClick={() => go(l.href!)}>{l.label}</button>
                          : <span className="min-w-0 flex-1 truncate text-ink">{l.label}</span>}
                        <span className="num shrink-0 text-muted">{l.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
