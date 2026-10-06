// Gráfico de columnas de una serie (ventas por mes). Sin librerías: SVG + tokens de color.
// Especificaciones: columnas ≤ 24 px con extremo redondeado de 4 px, cuadrícula de 1 px recesiva,
// tooltip al pasar el mouse o con el teclado, y vista de tabla equivalente.
import { useMemo, useState } from "react";
import { Table2, BarChart3 } from "lucide-react";
import { IconButton } from "./kit";

export interface BarDatum { key: string; label: string; value: number }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function BarChart({
  data,
  format,
  formatAxis,
  title,
  height = 220,
}: {
  data: BarDatum[];
  format: (v: number) => string;
  formatAxis: (v: number) => string;
  title: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = useMemo(() => niceMax(Math.max(...data.map((d) => d.value), 0)), [data]);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const W = 720, H = height, padL = 64, padR = 8, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.56);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const last = data.length - 1;

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <IconButton icon={table ? BarChart3 : Table2} label={table ? "Ver como gráfico" : "Ver como tabla"} size={16} onClick={() => setTable((t) => !t)} />
      </div>
      {table ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-1.5">Mes</th><th className="text-right">Monto</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-line"><td className="py-1.5">{d.label}</td><td className="num text-right">{format(d.value)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-faint)">{formatAxis(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padL + band * i + band / 2;
              const top = y(d.value);
              const h = padT + plotH - top;
              const r = Math.min(4, h);
              const x0 = cx - barW / 2, x1 = cx + barW / 2, base = padT + plotH;
              const path = h <= 0 ? "" : `M${x0},${base} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x1 - r},${top} Q${x1},${top} ${x1},${top + r} L${x1},${base} Z`;
              return (
                <g key={d.key}>
                  <rect
                    x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent"
                    tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  />
                  <path d={path} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.45} pointerEvents="none" />
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={hover === i ? "var(--text)" : "var(--text-faint)"}>{d.label}</text>
                  {i === last && hover === null && d.value > 0 && (
                    <text x={cx} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">{formatAxis(d.value)}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop"
              style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%`, top: 0 }}
            >
              <div className="text-muted">{data[hover]!.label}</div>
              <div className="num text-sm font-semibold text-ink">{format(data[hover]!.value)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
