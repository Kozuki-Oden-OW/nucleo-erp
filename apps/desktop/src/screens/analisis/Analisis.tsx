// Análisis y reportes (Fase 12): catálogo de reportes, período, indicadores, gráfico, tabla y
// exportación a Excel o CSV. Los reportes llegan como una tabla genérica desde el backend.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, ChevronRight, FileDown, FileSpreadsheet, Lock, Table2 } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type Report, type ReportCell, type ReportColumnKind, type ReportDef } from "../../data";
import { monthLabel, reportFileName, reportToCsv, reportToXlsx } from "../../lib/export";
import { formatDate, formatInt, formatMoney, formatMoneyShort, formatQty, formatRut, todayIso } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, Card, EmptyState, Field, IconButton, Kpi, Notice, PageHeader, Segmented, Select, Spinner, cx } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

const MAX_ROWS = 2000;

/* ───────────── Formatos ───────────── */

export function formatCell(v: ReportCell, kind: ReportColumnKind): string {
  if (v === null || v === "") return "—";
  if (typeof v === "string") {
    if (kind === "date") return formatDate(v);
    if (kind === "month") return monthLabel(v);
    if (kind === "rut") return formatRut(v);
    return v;
  }
  switch (kind) {
    case "money": return formatMoney(v);
    case "qty": return formatQty(v);
    case "pct": return `${(v / 10_000).toFixed(1).replace(".", ",")} %`;
    case "ratio": return (v / 100).toFixed(2).replace(".", ",");
    case "days": return `${formatInt(v)} d`;
    case "fx": return (v / 100).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default: return formatInt(v);
  }
}

const NUMERIC: ReportColumnKind[] = ["money", "qty", "pct", "int", "ratio", "days", "fx"];

/* ───────────── Período ───────────── */

type Preset = "mes" | "mes_anterior" | "3m" | "12m" | "anio" | "anio_anterior" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "mes", label: "Este mes" }, { value: "mes_anterior", label: "Mes anterior" }, { value: "3m", label: "Últimos 3 meses" },
  { value: "12m", label: "Últimos 12 meses" }, { value: "anio", label: "Este año" }, { value: "anio_anterior", label: "Año anterior" },
  { value: "custom", label: "Elegir fechas" },
];
function iso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.toISOString().slice(0, 10);
}
export function presetRange(p: Preset, today = todayIso()): [string, string] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  switch (p) {
    case "mes_anterior": return [iso(y, m - 1, 1), iso(y, m, 0)];
    case "3m": return [iso(y, m - 2, 1), today];
    case "12m": return [iso(y, m - 11, 1), today];
    case "anio": return [`${y}-01-01`, today];
    case "anio_anterior": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return [iso(y, m, 1), today];
  }
}

/* ───────────── Pantalla ───────────── */

export function Analisis({ route }: { route: Route }) {
  const id = route.query.get("r");
  return id ? <ReportScreen key={id} id={id} route={route} /> : <Catalog />;
}

function Catalog() {
  const backend = useBackend();
  const [defs, setDefs] = useState<ReportDef[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { backend.reportCatalog().then(setDefs).catch((e) => setErr(errorMessage(e))); }, [backend]);
  const groups = useMemo(() => {
    const m = new Map<string, ReportDef[]>();
    for (const d of defs ?? []) m.set(d.group, [...(m.get(d.group) ?? []), d]);
    return [...m.entries()];
  }, [defs]);
  return (
    <div className="anim-in">
      <PageHeader title="Análisis y reportes" subtitle="Respuestas claras sobre tu negocio. Elige un reporte, ajusta el período y expórtalo a Excel si lo necesitas." />
      {err && <Notice tone="danger">{err}</Notice>}
      {!defs && !err && <Spinner />}
      <div className="flex flex-col gap-7">
        {groups.map(([g, list]) => (
          <section key={g}>
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((d) => (
                <button key={d.id} type="button" disabled={!d.available} onClick={() => navigate(`/analisis?r=${d.id}`)}
                  className={cx("group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-colors",
                    d.available ? "hover:border-accent/50 hover:bg-surface-2/40" : "cursor-not-allowed opacity-60")}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{d.title}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-muted">{d.description}</span>
                    {!d.available && <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted"><Lock size={12} aria-hidden /> Requiere un permiso que tu usuario no tiene</span>}
                  </span>
                  {d.available && <ChevronRight size={18} className="mt-0.5 shrink-0 text-faint group-hover:text-accent" aria-hidden />}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ReportScreen({ id, route }: { id: string; route: Route }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [defs, setDefs] = useState<ReportDef[]>([]);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const preset = (route.query.get("periodo") as Preset) || "mes";
  const [defFrom, defTo] = presetRange(preset === "custom" ? "mes" : preset);
  const from = route.query.get("desde") ?? defFrom;
  const to = route.query.get("hasta") ?? defTo;
  const group = route.query.get("grupo") ?? "mes";
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"tabla" | "grafico">("grafico");
  const def = defs.find((d) => d.id === id);

  useEffect(() => { backend.reportCatalog().then(setDefs).catch(() => setDefs([])); backend.business().then(setBiz).catch(() => setBiz(null)); }, [backend]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    backend.report({ id, from, to, group }).then((r) => { if (alive) { setRep(r); setErr(null); } })
      .catch((e) => { if (alive) setErr(errorMessage(e)); }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [backend, id, from, to, group]);

  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(route.query);
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    navigate(`/analisis?${q.toString()}`, { replace: true });
  };
  function pickPreset(p: Preset) {
    if (p === "custom") { go({ periodo: "custom", desde: from, hasta: to }); return; }
    go({ periodo: p === "mes" ? null : p, desde: null, hasta: null });
  }
  async function exportAs(ext: "xlsx" | "csv") {
    if (!rep) return;
    try {
      const bytes = ext === "xlsx" ? reportToXlsx(rep, biz?.legal_name || biz?.name || "") : reportToCsv(rep);
      const ok = await backend.saveReportFile(rep.id, reportFileName(rep, ext), bytes);
      if (ok) toast("success", ext === "xlsx" ? "Reporte exportado a Excel." : "Reporte exportado a CSV.");
    } catch (e) { toast("danger", errorMessage(e)); }
  }

  const usesPeriod = rep?.uses_period ?? def?.uses_period ?? true;
  const canExport = can("reportes.exportar");
  return (
    <div className="anim-in">
      <button type="button" onClick={() => navigate("/analisis")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Todos los reportes
      </button>
      <PageHeader title={rep?.title ?? def?.title ?? "Reporte"} subtitle={rep?.description ?? def?.description}
        actions={canExport && rep ? <>
          <Button variant="secondary" icon={FileDown} onClick={() => exportAs("csv")}>CSV</Button>
          <Button icon={FileSpreadsheet} onClick={() => exportAs("xlsx")}>Exportar a Excel</Button>
        </> : undefined} />

      <div className="mb-5 flex flex-wrap items-end gap-3">
        {usesPeriod ? (
          <>
            <Select label="Período" className="w-48" value={preset} onChange={(e) => pickPreset(e.target.value as Preset)} options={PRESETS} />
            {preset === "custom" ? (
              <>
                <Field label="Desde" type="date" value={from} max={to} onChange={(e) => e.target.value && go({ desde: e.target.value })} className="w-44" />
                <Field label="Hasta" type="date" value={to} min={from} onChange={(e) => e.target.value && go({ hasta: e.target.value })} className="w-44" />
              </>
            ) : <span className="pb-2 text-sm text-muted">{formatDate(from)} al {formatDate(to)}</span>}
            {def && def.groupings.length > 0 && (
              <Segmented label="Agrupar" value={group} onChange={(v) => go({ grupo: v === "mes" ? null : v })} options={def.groupings.map(([value, label]) => ({ value, label }))} />
            )}
          </>
        ) : <span className="text-sm text-muted">Situación al día de hoy ({formatDate(rep?.to ?? todayIso())}).</span>}
        {loading && <span className="pb-2 text-xs text-muted">Calculando…</span>}
      </div>

      {err && <Notice tone="danger">{err}</Notice>}
      {!rep && !err && <Spinner />}
      {rep && (
        <div className="flex flex-col gap-5">
          {rep.kpis.length > 0 && (
            <div className={cx("grid gap-3", rep.kpis.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3")}>
              {rep.kpis.map((k) => <Kpi key={k.label} label={k.label} value={formatCell(k.value, k.kind)} tone={k.tone ?? undefined} />)}
            </div>
          )}
          {rep.chart && rep.rows.length > 1 && (
            <Card title="Gráfico" actions={<IconButton icon={view === "grafico" ? Table2 : BarChart3} label={view === "grafico" ? "Ocultar gráfico" : "Ver gráfico"} onClick={() => setView(view === "grafico" ? "tabla" : "grafico")} />}>
              {view === "grafico" ? <ReportChart rep={rep} /> : (
                <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => setView("grafico")}>Ver el gráfico de {rep.columns[rep.chart.series[0]!]!.label.toLowerCase()}{rep.chart.series.length > 1 ? ` y ${rep.columns[rep.chart.series[1]!]!.label.toLowerCase()}` : ""}</button>
              )}
            </Card>
          )}
          {rep.rows.length === 0 ? (
            <EmptyState icon={Table2} title="No hay datos en este período">Prueba con un período más amplio.</EmptyState>
          ) : <ReportTable rep={rep} />}
          {rep.notes.map((n) => <Notice key={n} tone="info">{n}</Notice>)}
        </div>
      )}
    </div>
  );
}

function ReportTable({ rep }: { rep: Report }) {
  const shown = rep.rows.slice(0, MAX_ROWS);
  const align = (k: ReportColumnKind) => (NUMERIC.includes(k) ? "text-right" : "text-left");
  return (
    <div>
      <div className="overflow-auto rounded-xl border border-line bg-surface shadow-card" style={{ maxHeight: "calc(100vh - 220px)" }}>
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-[1] bg-surface-2/95 backdrop-blur">
            <tr>{rep.columns.map((c) => <th key={c.key} scope="col" className={cx("border-b border-line px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted", align(c.kind))}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const link = rep.links[i];
              return (
                <tr key={i} onClick={link ? () => navigate(link) : undefined} className={cx("border-b border-line last:border-b-0", link ? "cursor-pointer hover:bg-surface-2/70" : "")}>
                  {row.map((v, j) => {
                    const c = rep.columns[j]!;
                    const neg = typeof v === "number" && v < 0 && c.kind === "money";
                    return <td key={j} className={cx("max-w-[22rem] truncate px-3 py-2", align(c.kind), NUMERIC.includes(c.kind) && "num", neg && "text-danger", j === 0 && "font-medium text-ink")}>{formatCell(v, c.kind)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
          {rep.totals && (
            <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur">
              <tr>{rep.totals.map((v, j) => {
                const c = rep.columns[j]!;
                return <td key={j} className={cx("border-t border-line-strong px-3 py-2.5 font-semibold text-ink", align(c.kind), NUMERIC.includes(c.kind) && "num")}>{v === null ? "" : formatCell(v, c.kind)}</td>;
              })}</tr>
            </tfoot>
          )}
        </table>
      </div>
      {rep.rows.length > MAX_ROWS && <p className="mt-2 text-xs text-muted">Se muestran {formatInt(MAX_ROWS)} de {formatInt(rep.rows.length)} filas. Exporta a Excel para verlas todas.</p>}
    </div>
  );
}

/** Columnas agrupadas (1 o 2 series) con línea de cero; acepta valores negativos. */
function ReportChart({ rep }: { rep: Report }) {
  const ch = rep.chart!;
  const rows = rep.rows.slice(0, 40);
  const series = ch.series.slice(0, 2);
  const values = rows.flatMap((r) => series.map((s) => (typeof r[s] === "number" ? (r[s] as number) : 0)));
  const nice = (v: number) => { if (v <= 0) return 0; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  const max = nice(Math.max(0, ...values)), min = -nice(-Math.min(0, ...values));
  const span = max - min || 1;
  const W = 760, H = 260, padL = 70, padR = 10, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const y = (v: number) => padT + ((max - v) / span) * plotH;
  const band = plotW / Math.max(1, rows.length);
  const barW = Math.min(22, (band * 0.7) / series.length);
  const colors = ["var(--chart-1)", "var(--chart-2)"];
  const ticks = [max, max / 2, 0, min / 2, min].filter((v, i, a) => a.indexOf(v) === i && (v !== 0 || i === 2));
  const kind = rep.columns[series[0]!]!.kind;
  const lblKind = rep.columns[ch.label]!.kind;
  const [hover, setHover] = useState<number | null>(null);
  const step = Math.ceil(rows.length / 14);
  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s, i) => <span key={s} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />{rep.columns[s]!.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Gráfico: ${rep.title}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-faint)">{kind === "money" ? formatMoneyShort(t) : formatCell(Math.round(t), kind)}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--text-faint)" strokeWidth={1} />
        {rows.map((r, i) => {
          const cx0 = padL + band * i + band / 2;
          return (
            <g key={i}>
              <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              {series.map((s, k) => {
                const v = typeof r[s] === "number" ? (r[s] as number) : 0;
                const top = Math.min(y(v), y(0)), h = Math.abs(y(v) - y(0));
                const x = cx0 - (barW * series.length) / 2 + k * (barW + 2);
                return <rect key={s} x={x} y={top} width={barW} height={Math.max(h, v === 0 ? 0 : 1)} rx={Math.min(3, h / 2)} fill={colors[k]} opacity={hover === null || hover === i ? 1 : 0.45} pointerEvents="none" />;
              })}
              {i % step === 0 && <text x={cx0} y={H - 12} textAnchor="middle" fontSize={11} fill={hover === i ? "var(--text)" : "var(--text-faint)"}>{String(formatCell(r[ch.label] ?? null, lblKind)).slice(0, 14)}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop" style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%`, top: 20 }}>
          <div className="text-muted">{formatCell(rows[hover]![ch.label] ?? null, lblKind)}</div>
          {series.map((s, k) => <div key={s} className="num font-semibold text-ink"><span style={{ color: colors[k] }}>■</span> {rep.columns[s]!.label}: {formatCell(rows[hover]![s] ?? null, rep.columns[s]!.kind)}</div>)}
        </div>
      )}
      {rep.rows.length > 40 && <p className="mt-1 text-xs text-muted">El gráfico muestra las primeras 40 filas.</p>}
    </div>
  );
}
