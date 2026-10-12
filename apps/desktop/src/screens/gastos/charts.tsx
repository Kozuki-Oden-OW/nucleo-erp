// Gráficos simples del módulo Gastos: barras agrupadas por mes y proyección de utilidad.
// Cada gráfico tiene leyenda, etiquetas en tono de texto y su tabla equivalente.
import { useEffect, useRef, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { formatMoney, formatMoneyShort } from "../../lib/format";
import { IconButton } from "../../ui/kit";

function nice(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export interface BarSeries { label: string; color: string; values: number[] }

/** Barras agrupadas (dos o tres series) con eje en cero; los negativos bajan del cero. */
export function GroupedBars({ labels, series, caption, height = 220 }: { labels: string[]; series: BarSeries[]; caption: string; height?: number }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  // El dibujo usa el ancho real del contenedor: así el texto queda siempre en 11 px.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e!.contentRect.width); if (w > 0) setW(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const all = series.flatMap((s) => s.values);
  const hi = Math.max(0, ...all), lo = Math.min(0, ...all);
  const step = nice((hi - lo) / 4 || 1);
  const top = Math.ceil(hi / step) * step, bottom = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + 1e-6; t += step) ticks.push(t);
  const H = height, padL = 64, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB, span = top - bottom || 1;
  const y = (v: number) => padT + ((top - v) / span) * plotH;
  const band = plotW / Math.max(1, labels.length);
  const barW = Math.min(22, (band * 0.7) / series.length);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          {series.map((s) => <span key={s.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}</span>)}
        </div>
        <IconButton icon={table ? BarChart3 : Table2} label={table ? "Ver como gráfico" : "Ver como tabla"} size={16} onClick={() => setTable((t) => !t)} />
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Mes</th>{series.map((s) => <th key={s.label} className="text-right">{s.label}</th>)}</tr></thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l} className="border-t border-line">
                  <td className="py-1.5">{l}</td>
                  {series.map((s) => <td key={s.label} className={`num text-right ${s.values[i]! < 0 ? "text-danger" : ""}`}>{formatMoney(s.values[i]!)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={caption}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.25 : 1} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{formatMoneyShort(t)}</text>
              </g>
            ))}
            {labels.map((l, i) => {
              const x0 = padL + band * i + (band - barW * series.length - 2 * (series.length - 1)) / 2;
              return (
                <g key={l} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={padL + band * i} y={padT} width={band} height={plotH} fill={hover === i ? "var(--surface-2)" : "transparent"} />
                  {series.map((s, k) => {
                    const v = s.values[i]!;
                    const yy = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
                    return <rect key={s.label} x={x0 + k * (barW + 2)} y={yy} width={barW} height={h} rx={3} fill={v < 0 ? "var(--danger)" : s.color} />;
                  })}
                  <text x={padL + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{l}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card"
              style={{ left: `${Math.min(70, ((padL + band * hover + band / 2) / W) * 100)}%` }}>
              <div className="mb-1 font-semibold text-ink">{labels[hover]}</div>
              {series.map((s) => <div key={s.label} className="flex justify-between gap-4"><span className="text-muted">{s.label}</span><span className="num text-ink">{formatMoney(s.values[hover]!)}</span></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Barra de avance (gastado vs presupuesto, venta vs meta). */
export function Meter({ value, max, label, goal = false }: { value: number; max: number; label: string; goal?: boolean }) {
  const pct = max > 0 ? value / max : 0;
  // Presupuesto: pasarse es malo. Meta: llegar es bueno.
  const tone = goal ? (pct >= 1 ? "var(--success)" : pct >= 0.8 ? "var(--warning)" : "var(--danger)")
    : pct > 1 ? "var(--danger)" : pct > 0.9 ? "var(--warning)" : "var(--chart-1)";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: tone }} />
    </div>
  );
}
