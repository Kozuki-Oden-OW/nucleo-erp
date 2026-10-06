// Proyección semanal del saldo: columnas del saldo al cierre de cada semana, con el cero marcado.
// Saldo positivo en el color de datos; negativo en rojo (estado), con etiqueta y tabla equivalente.
import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import type { WeekFlow } from "../../data";
import { formatDayShort, formatMoney, formatMoneyShort } from "../../lib/format";
import { IconButton } from "../../ui/kit";

function nice(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function FlowChart({ weeks }: { weeks: WeekFlow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const values = weeks.map((w) => w.closing_minor);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  // Escala común para positivos y negativos: el cero queda donde corresponde.
  const step = nice((hi - lo) / 4 || 1);
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + 1e-6; t += step) ticks.push(t);
  const W = 720, H = 240, padL = 68, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const span = top - bottom || 1;
  const y = (v: number) => padT + ((top - v) / span) * plotH;
  const band = plotW / Math.max(1, weeks.length);
  const barW = Math.min(26, band * 0.56);
  const zero = y(0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-1)]" aria-hidden />Saldo al cierre de la semana</span>
          {lo < 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--danger)]" aria-hidden />Saldo negativo</span>}
        </div>
        <IconButton icon={table ? BarChart3 : Table2} label={table ? "Ver como gráfico" : "Ver como tabla"} size={16} onClick={() => setTable((t) => !t)} />
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Proyección de caja por semana</caption>
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Semana</th><th className="text-right">Saldo inicial</th><th className="text-right">Entra</th><th className="text-right">Sale</th><th className="text-right">Saldo final</th></tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start} className="border-t border-line">
                  <td className="num py-1.5">{formatDayShort(w.start)} – {formatDayShort(w.end)}</td>
                  <td className="num text-right text-muted">{formatMoney(w.opening_minor)}</td>
                  <td className="num text-right text-success">{w.inflow_minor ? `+${formatMoney(w.inflow_minor)}` : "—"}</td>
                  <td className="num text-right">{w.outflow_minor ? `−${formatMoney(w.outflow_minor)}` : "—"}</td>
                  <td className={`num text-right font-medium ${w.closing_minor < 0 ? "text-danger" : ""}`}>{formatMoney(w.closing_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Proyección del saldo de caja para las próximas 13 semanas" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-faint)">{formatMoneyShort(t)}</text>
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={zero} y2={zero} stroke="var(--text-faint)" strokeWidth={1} />
            {weeks.map((w, i) => {
              const cx = padL + band * i + band / 2;
              const v = w.closing_minor;
              const yv = y(v);
              const h = Math.abs(zero - yv);
              const r = Math.min(4, h);
              const x0 = cx - barW / 2, x1 = cx + barW / 2;
              // Extremo redondeado lejos del cero; base recta sobre el cero.
              const path = h <= 0 ? "" : v >= 0
                ? `M${x0},${zero} L${x0},${yv + r} Q${x0},${yv} ${x0 + r},${yv} L${x1 - r},${yv} Q${x1},${yv} ${x1},${yv + r} L${x1},${zero} Z`
                : `M${x0},${zero} L${x0},${yv - r} Q${x0},${yv} ${x0 + r},${yv} L${x1 - r},${yv} Q${x1},${yv} ${x1},${yv - r} L${x1},${zero} Z`;
              const showLabel = i % 2 === 0 || weeks.length <= 8;
              return (
                <g key={w.start}>
                  <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent" tabIndex={0}
                    aria-label={`Semana del ${formatDayShort(w.start)}: saldo ${formatMoney(v)}`}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                  <path d={path} fill={v < 0 ? "var(--danger)" : "var(--chart-1)"} opacity={hover === null || hover === i ? 1 : 0.45} pointerEvents="none" />
                  {showLabel && <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={hover === i ? "var(--text)" : "var(--text-faint)"}>{formatDayShort(w.start)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && weeks[hover] && (() => {
            const w = weeks[hover]!;
            const left = ((padL + band * hover + band / 2) / W) * 100;
            return (
              <div className="pointer-events-none absolute z-10 w-56 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop"
                style={{ left: `${left}%`, top: 0, transform: `translateX(${left > 70 ? "-100%" : left < 30 ? "0" : "-50%"})` }}>
                <div className="text-muted">Semana {formatDayShort(w.start)} – {formatDayShort(w.end)}</div>
                <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                  <dt className="text-muted">Inicia con</dt><dd className="num text-right">{formatMoney(w.opening_minor)}</dd>
                  <dt className="text-muted">Entra</dt><dd className="num text-right text-success">+{formatMoney(w.inflow_minor)}</dd>
                  <dt className="text-muted">Sale</dt><dd className="num text-right">−{formatMoney(w.outflow_minor)}</dd>
                  <dt className="font-medium text-ink">Termina con</dt><dd className={`num text-right font-semibold ${w.closing_minor < 0 ? "text-danger" : "text-ink"}`}>{formatMoney(w.closing_minor)}</dd>
                </dl>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
