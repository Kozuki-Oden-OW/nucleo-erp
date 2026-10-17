// Análisis de productos y de clientes (Fase 12 C). Qué está pasando, por qué y qué revisar:
// cada clasificación muestra los datos que la justifican.
import { useEffect, useMemo, useState } from "react";
import { Boxes, Package, Search, ShoppingCart, TrendingDown, TrendingUp, UserRound, Users } from "lucide-react";
import {
  useBackend, errorMessage, type CustomerInsight, type CustomerInsights, type CustomerState, type ProductInsight,
  type ProductInsights, type ProductQuadrant, type TrendPoint,
} from "../../data";
import { formatDate, formatMoney, formatMoneyShort, formatMonthShort, formatQty, formatRut } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { BarChart } from "../../ui/BarChart";
import { Badge, Button, Card, DefinitionList, EmptyState, Field, Kpi, Notice, Segmented, Select, Spinner, cx, type Tone } from "../../ui/kit";
import { Drawer } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

const pct = (ppm: number | null) => (ppm === null ? "—" : `${(ppm / 10_000).toFixed(1).replace(".", ",")} %`);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtro">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-full border px-3 py-1 text-[13px] transition-colors", value === o.value ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface text-ink hover:border-accent/50")}>
          {o.label}{o.count !== undefined && <span className="num ml-1.5 text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

function AbcBadge({ v }: { v: string }) {
  if (!v) return <span className="text-faint">—</span>;
  return <Badge tone={v === "A" ? "accent" : v === "B" ? "info" : "neutral"}>{v}</Badge>;
}

/* ───────────────────────────── Productos ───────────────────────────── */

export const QUADRANT: Record<ProductQuadrant, [Tone, string, string]> = {
  estrella: ["success", "Estrella", "Vende mucho y deja buen margen: cuida su stock y su precio."],
  volumen: ["info", "Mueve volumen", "Vende mucho pero deja poco margen: revisa costo o precio."],
  oportunidad: ["accent", "Oportunidad", "Deja buen margen pero vende poco: vale la pena impulsarlo."],
  revisar: ["warning", "Revisar", "Vende poco y deja poco margen: evalúa si mantenerlo."],
  sin_ventas: ["neutral", "Sin ventas", "No se vendió en el período."],
  sin_datos: ["neutral", "—", "Se necesita ver costos para clasificarlo."],
};

type PFilter = "todos" | "estrella" | "volumen" | "oportunidad" | "revisar" | "creciendo" | "cayendo" | "margen_bajo" | "detenidos" | "sin_ventas";
type PSort = "venta" | "margen" | "margen_pct" | "variacion" | "detenido";

export function ProductsInsights({ route }: { route: Route }) {
  const backend = useBackend();
  const { can } = useSession();
  const [win, setWin] = useState<"30" | "90" | "180" | "365">("90");
  const [d, setD] = useState<ProductInsights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PSort>("venta");
  const [open, setOpen] = useState<ProductInsight | null>(null);
  const filter = (route.query.get("filtro") as PFilter) || "todos";
  const setFilter = (f: PFilter) => navigate(f === "todos" ? "/analisis?tab=productos" : `/analisis?tab=productos&filtro=${f}`, { replace: true });
  useEffect(() => { setD(null); backend.productInsights(Number(win)).then(setD).catch((e) => setErr(errorMessage(e))); }, [backend, win]);

  const match = (r: ProductInsight, f: PFilter) => {
    switch (f) {
      case "todos": return true;
      case "creciendo": return r.growing;
      case "cayendo": return r.falling;
      case "margen_bajo": return r.low_margin;
      case "detenidos": return r.idle;
      case "sin_ventas": return r.quadrant === "sin_ventas" && !r.is_service;
      default: return r.quadrant === f;
    }
  };
  const rows = useMemo(() => {
    const q = fold(query.trim());
    const list = (d?.rows ?? []).filter((r) => match(r, filter) && (!q || fold(`${r.name} ${r.sku} ${r.category ?? ""}`).includes(q)));
    const key: Record<PSort, (r: ProductInsight) => number> = {
      venta: (r) => r.net_minor, margen: (r) => r.margin_minor, margen_pct: (r) => r.margin_ppm ?? -1e12,
      variacion: (r) => r.growth_ppm ?? -1e12, detenido: (r) => (r.idle ? r.stock_value_minor : -1),
    };
    return [...list].sort((a, b) => key[sort](b) - key[sort](a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, filter, query, sort]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  const costs = d?.costs_visible ?? can("costos.ver");
  const n = (f: PFilter) => d?.rows.filter((r) => match(r, f)).length ?? 0;
  const aCount = d?.rows.filter((r) => r.abc === "A").length ?? 0;

  const cols: Column<ProductInsight>[] = [
    { key: "n", header: "Producto", width: "minmax(11rem,1fr)", render: (r) => <span className="block max-w-[15rem] truncate" title={r.name}><span className="font-medium text-ink">{r.name}</span>{r.sku && <span className="ml-2 font-mono text-xs text-muted">{r.sku}</span>}</span> },
    { key: "a", header: "ABC", width: "4rem", align: "center", render: (r) => <AbcBadge v={r.abc} /> },
    { key: "c", header: "Clasificación", width: "8rem", render: (r) => <Badge tone={QUADRANT[r.quadrant][0]}>{QUADRANT[r.quadrant][1]}</Badge> },
    { key: "q", header: "Vendido", width: "6rem", align: "right", render: (r) => <span className="num">{r.qty_milli ? `${formatQty(r.qty_milli)} ${r.unit}` : "—"}</span> },
    { key: "v", header: "Venta neta", width: "7.5rem", align: "right", render: (r) => <span className="num">{r.net_minor ? formatMoney(r.net_minor) : "—"}</span> },
    ...(costs ? [
      { key: "m", header: "Margen", width: "7.5rem", align: "right" as const, render: (r: ProductInsight) => <span className={cx("num", r.margin_minor < 0 && "text-danger")}>{r.net_minor ? formatMoney(r.margin_minor) : "—"}</span> },
      { key: "mp", header: "Margen %", width: "5.5rem", align: "right" as const, render: (r: ProductInsight) => <span className={cx("num", r.low_margin && "font-medium text-warning", (r.margin_ppm ?? 0) < 0 && "text-danger")}>{pct(r.margin_ppm)}</span> },
    ] : []),
    { key: "g", header: "Variación", width: "6.5rem", align: "right", render: (r) => r.growth_ppm === null ? <span className="text-faint">—</span> : <span className={cx("num", r.growing ? "text-success" : r.falling ? "text-danger" : "text-muted")}>{r.growth_ppm >= 0 ? "▲" : "▼"} {pct(Math.abs(r.growth_ppm))}</span> },
    { key: "l", header: "Última venta", width: "7rem", render: (r) => <span className={cx("num", r.idle ? "text-warning" : "text-muted")}>{r.days_since_sale === null ? "Nunca" : r.days_since_sale === 0 ? "Hoy" : `hace ${r.days_since_sale} d`}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Período" value={win} onChange={setWin} options={[{ value: "30", label: "30 días" }, { value: "90", label: "90 días" }, { value: "180", label: "180 días" }, { value: "365", label: "12 meses" }]} />
        {d && <span className="text-xs text-muted">Del {formatDate(d.from)} al {formatDate(d.to)}, comparado con los {d.window_days} días anteriores.</span>}
      </div>
      {!d ? <Spinner label="Analizando productos…" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={ShoppingCart} label="Venta neta del período" value={formatMoney(d.total_net_minor)} hint={`${d.rows.filter((r) => r.net_minor > 0).length} productos con ventas`} onClick={() => setFilter("todos")} />
            {costs && <Kpi icon={TrendingUp} label="Margen del período" value={formatMoney(d.total_margin_minor)} hint={d.total_net_minor ? `${pct(Math.round((d.total_margin_minor * 1e6) / d.total_net_minor))} sobre la venta` : undefined} />}
            <Kpi icon={Package} label="Productos A" value={aCount} hint={`Hacen el 80 % de ${costs ? "tu margen" : "tus ventas"}`} />
            {costs && <Kpi icon={Boxes} label="Capital detenido" value={formatMoney(d.idle_value_minor)} tone={d.idle_value_minor > 0 ? "warning" : undefined} hint={`${n("detenidos")} productos sin vender hace ${d.idle_days}+ días`} onClick={() => setFilter("detenidos")} />}
          </div>
          <Chips value={filter} onChange={setFilter} options={[
            { value: "todos", label: "Todos", count: d.rows.length },
            ...(costs ? (["estrella", "volumen", "oportunidad", "revisar"] as const).map((q) => ({ value: q as PFilter, label: QUADRANT[q][1], count: n(q) })) : []),
            { value: "creciendo", label: "Creciendo", count: n("creciendo") },
            { value: "cayendo", label: "Cayendo", count: n("cayendo") },
            ...(costs ? [{ value: "margen_bajo" as PFilter, label: `Margen bajo (< ${d.low_margin_pct} %)`, count: n("margen_bajo") }] : []),
            { value: "detenidos", label: "Detenidos", count: n("detenidos") },
            { value: "sin_ventas", label: "Sin ventas", count: n("sin_ventas") },
          ]} />
          {filter !== "todos" && QUADRANT[filter as ProductQuadrant] && <p className="text-sm text-muted">{QUADRANT[filter as ProductQuadrant][2]}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Field aria-label="Buscar producto" leading={<Search size={15} />} placeholder="Nombre, código o categoría" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-sm" />
            <Select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as PSort)} options={[
              { value: "venta", label: "Ordenar: más vendidos" }, ...(costs ? [{ value: "margen", label: "Ordenar: más margen ($)" }, { value: "margen_pct", label: "Ordenar: más margen (%)" }, { value: "detenido", label: "Ordenar: más capital detenido" }] : []),
              { value: "variacion", label: "Ordenar: más crecimiento" },
            ]} />
          </div>
          <DataTable label="Análisis de productos" columns={cols} rows={rows} rowKey={(r) => r.uid} onOpen={setOpen}
            empty={<EmptyState icon={Package} title="Ningún producto en esta situación" />} />
        </>
      )}
      <ProductDrawer p={open} costs={costs} onClose={() => setOpen(null)} />
    </div>
  );
}

function ProductDrawer({ p, costs, onClose }: { p: ProductInsight | null; costs: boolean; onClose: () => void }) {
  const backend = useBackend();
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [metric, setMetric] = useState<"net" | "qty" | "margin">("net");
  useEffect(() => { setTrend(null); if (p) backend.productTrend(p.uid).then(setTrend).catch(() => setTrend([])); }, [backend, p]);
  return (
    <Drawer open={p !== null} onClose={onClose} title={p?.name ?? ""} subtitle={p ? `${p.sku}${p.category ? ` · ${p.category}` : ""}` : undefined}
      footer={p && !p.is_service ? <Button variant="secondary" onClick={() => navigate(`/inventario/producto/${p.uid}`)}>Abrir ficha de inventario</Button> : undefined}>
      {p && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={QUADRANT[p.quadrant][0]}>{QUADRANT[p.quadrant][1]}</Badge>
            {p.abc && <Badge tone="accent">Clase {p.abc}</Badge>}
            {p.growing && <Badge tone="success"><TrendingUp size={12} className="mr-1 inline" aria-hidden />Creciendo</Badge>}
            {p.falling && <Badge tone="danger"><TrendingDown size={12} className="mr-1 inline" aria-hidden />Cayendo</Badge>}
            {p.low_margin && <Badge tone="warning">Margen bajo</Badge>}
            {p.idle && <Badge tone="warning">Detenido</Badge>}
          </div>
          <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink">
            <div className="font-medium">¿Por qué?</div>
            <p className="mt-0.5 text-muted">{p.explanation}</p>
            <p className="mt-1 text-muted">{QUADRANT[p.quadrant][2]}</p>
          </div>
          <DefinitionList items={[
            { label: "Vendido", value: p.qty_milli ? `${formatQty(p.qty_milli)} ${p.unit} en ${p.sales_count} ventas` : "—" },
            { label: "Venta neta", value: formatMoney(p.net_minor) },
            ...(costs ? [{ label: "Margen", value: `${formatMoney(p.margin_minor)} (${pct(p.margin_ppm)})` }] : []),
            { label: "Período anterior", value: formatMoney(p.prev_net_minor) },
            { label: "Última venta", value: p.last_sale ? formatDate(p.last_sale) : "Nunca" },
            ...(!p.is_service ? [{ label: "Stock", value: `${formatQty(p.on_hand_milli)} ${p.unit}${costs && p.stock_value_minor ? ` · ${formatMoney(p.stock_value_minor)} invertido` : ""}` }] : []),
          ]} />
          <Card title="Últimos 12 meses" actions={<Segmented label="Métrica" value={metric} onChange={setMetric} options={[{ value: "net", label: "Venta" }, { value: "qty", label: "Unidades" }, ...(costs ? [{ value: "margin" as const, label: "Margen" }] : [])]} />}>
            {!trend ? <Spinner /> : (
              <BarChart title={`Evolución de ${p.name}`} height={180}
                data={trend.map((t) => ({ key: t.month, label: formatMonthShort(t.month), value: metric === "net" ? t.net_minor : metric === "qty" ? t.qty_milli : t.net_minor - t.cost_minor }))}
                format={(v) => (metric === "qty" ? `${formatQty(v)} ${p.unit}` : formatMoney(v))} formatAxis={(v) => (metric === "qty" ? formatQty(v) : formatMoneyShort(v))} />
            )}
          </Card>
        </div>
      )}
    </Drawer>
  );
}

/* ───────────────────────────── Clientes ───────────────────────────── */

export const CUSTOMER_STATE: Record<CustomerState, [Tone, string]> = {
  activo: ["success", "Activo"], nuevo: ["accent", "Nuevo"], en_riesgo: ["warning", "En riesgo"],
  perdido: ["danger", "Perdido"], ocasional: ["info", "Ocasional"], sin_compras: ["neutral", "Sin compras"],
};
type CFilter = "todos" | CustomerState | "con_deuda";
type CSort = "venta" | "margen" | "ultima" | "deuda" | "compras";

export function CustomersInsights({ route }: { route: Route }) {
  const backend = useBackend();
  const [d, setD] = useState<CustomerInsights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CSort>("venta");
  const [open, setOpen] = useState<CustomerInsight | null>(null);
  const filter = (route.query.get("filtro") as CFilter) || "todos";
  const setFilter = (f: CFilter) => navigate(f === "todos" ? "/analisis?tab=clientes" : `/analisis?tab=clientes&filtro=${f}`, { replace: true });
  useEffect(() => { backend.customerInsights().then(setD).catch((e) => setErr(errorMessage(e))); }, [backend]);
  const match = (r: CustomerInsight, f: CFilter) => f === "todos" || (f === "con_deuda" ? r.pending_minor > 0 : r.state === f);
  const rows = useMemo(() => {
    const q = fold(query.trim());
    const list = (d?.rows ?? []).filter((r) => match(r, filter) && (!q || fold(`${r.name} ${r.rut ?? ""}`).includes(q)));
    const key: Record<CSort, (r: CustomerInsight) => number> = {
      venta: (r) => r.net_12m_minor, margen: (r) => r.margin_12m_minor, ultima: (r) => -(r.days_since ?? 1e9),
      deuda: (r) => r.pending_minor, compras: (r) => r.purchases_12m,
    };
    return [...list].sort((a, b) => key[sort](b) - key[sort](a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, filter, query, sort]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <Spinner label="Analizando clientes…" />;
  const n = (f: CFilter) => d.rows.filter((r) => match(r, f)).length;
  const costs = d.costs_visible;

  const cols: Column<CustomerInsight>[] = [
    { key: "n", header: "Cliente", width: "minmax(11rem,1fr)", render: (r) => <span className="block max-w-[15rem] truncate" title={r.name}><span className="font-medium text-ink">{r.name}</span>{r.rut && <span className="num ml-2 text-xs text-muted">{formatRut(r.rut)}</span>}</span> },
    { key: "a", header: "ABC", width: "3.5rem", align: "center", render: (r) => <AbcBadge v={r.abc} /> },
    { key: "e", header: "Estado", width: "6.5rem", render: (r) => <Badge tone={CUSTOMER_STATE[r.state][0]}>{CUSTOMER_STATE[r.state][1]}</Badge> },
    { key: "v", header: "Compró (12 m)", width: "7.5rem", align: "right", render: (r) => <span className="num">{r.net_12m_minor ? formatMoney(r.net_12m_minor) : "—"}</span> },
    ...(costs ? [{ key: "m", header: "Margen (12 m)", width: "7.5rem", align: "right" as const, render: (r: CustomerInsight) => <span className="num text-muted">{r.net_12m_minor ? formatMoney(r.margin_12m_minor) : "—"}</span> }] : []),
    { key: "c", header: "Compras", width: "5rem", align: "right", render: (r) => <span className="num">{r.purchases_12m || "—"}</span> },
    { key: "f", header: "Compra cada", width: "6rem", align: "right", render: (r) => <span className="num text-muted">{r.avg_interval_days ? `${r.avg_interval_days} d` : "—"}</span> },
    { key: "u", header: "Última compra", width: "6.5rem", render: (r) => <span className={cx("num", r.state === "en_riesgo" ? "text-warning" : r.state === "perdido" ? "text-danger" : "text-muted")}>{r.days_since === null ? "—" : r.days_since === 0 ? "Hoy" : `hace ${r.days_since} d`}</span> },
    { key: "d", header: "Te debe", width: "7rem", align: "right", render: (r) => <span className={cx("num", r.overdue_minor > 0 ? "font-medium text-danger" : "text-muted")}>{r.pending_minor ? formatMoney(r.pending_minor) : "—"}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Users} label="Clientes activos" value={n("activo") + n("nuevo")} hint={`${n("nuevo")} nuevos en los últimos 30 días`} onClick={() => setFilter("activo")} />
        <Kpi icon={UserRound} label="En riesgo" value={n("en_riesgo")} tone={n("en_riesgo") ? "warning" : undefined} hint="Pasó más del doble de su tiempo habitual" onClick={() => setFilter("en_riesgo")} />
        <Kpi icon={ShoppingCart} label="Venta a clientes (12 m)" value={formatMoney(d.total_net_12m_minor)} hint="Neto, clientes con ficha" />
        <Kpi icon={TrendingUp} label="Peso de los clientes A" value={pct(d.top_share_ppm)} hint={`${d.rows.filter((r) => r.abc === "A").length} clientes hacen esa parte de la venta`} onClick={() => setFilter("todos")} />
      </div>
      <Chips value={filter} onChange={setFilter} options={[
        { value: "todos", label: "Todos", count: d.rows.length },
        ...(["activo", "nuevo", "en_riesgo", "perdido", "ocasional"] as const).map((s) => ({ value: s as CFilter, label: CUSTOMER_STATE[s][1], count: n(s) })),
        { value: "con_deuda", label: "Con deuda", count: n("con_deuda") },
        { value: "sin_compras", label: "Sin compras", count: n("sin_compras") },
      ]} />
      <div className="flex flex-wrap items-center gap-3">
        <Field aria-label="Buscar cliente" leading={<Search size={15} />} placeholder="Nombre o RUT" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-sm" />
        <Select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as CSort)} options={[
          { value: "venta", label: "Ordenar: compran más" }, ...(costs ? [{ value: "margen", label: "Ordenar: dejan más margen" }] : []),
          { value: "compras", label: "Ordenar: compran más seguido" }, { value: "ultima", label: "Ordenar: compra más reciente" }, { value: "deuda", label: "Ordenar: deben más" },
        ]} />
        <span className="text-xs text-muted">Clientes ocasionales (sin ficha) no aparecen aquí.</span>
      </div>
      <DataTable label="Análisis de clientes" columns={cols} rows={rows} rowKey={(r) => r.uid} onOpen={setOpen}
        empty={<EmptyState icon={Users} title="Ningún cliente en esta situación" />} />
      <Drawer open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} subtitle={open?.rut ? formatRut(open.rut) : undefined}
        footer={open && <><Button variant="secondary" onClick={() => navigate(`/clientes/${open.uid}`)}>Abrir ficha</Button><Button onClick={() => navigate("/ventas/nueva")}>Nueva venta</Button></>}>
        {open && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone={CUSTOMER_STATE[open.state][0]}>{CUSTOMER_STATE[open.state][1]}</Badge>
              {open.abc && <Badge tone="accent">Clase {open.abc}</Badge>}
              {open.overdue_minor > 0 && <Badge tone="danger">Pago atrasado</Badge>}
            </div>
            <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
              <div className="font-medium text-ink">¿Por qué?</div>
              <p className="mt-0.5 text-muted">{open.explanation}</p>
              {open.state === "en_riesgo" && <p className="mt-1 text-muted">Un contacto a tiempo (un llamado, una oferta) suele recuperar a un cliente frecuente.</p>}
            </div>
            <DefinitionList items={[
              { label: "Compras totales", value: `${open.purchases}` },
              { label: "Primera compra", value: open.first_purchase ? formatDate(open.first_purchase) : "—" },
              { label: "Última compra", value: open.last_purchase ? formatDate(open.last_purchase) : "—" },
              { label: "Compró en 12 meses", value: `${formatMoney(open.net_12m_minor)} en ${open.purchases_12m} compras` },
              ...(costs ? [{ label: "Margen en 12 meses", value: formatMoney(open.margin_12m_minor) }] : []),
              { label: "Ticket promedio", value: formatMoney(open.avg_ticket_minor) },
              { label: "Te debe", value: open.pending_minor ? `${formatMoney(open.pending_minor)}${open.overdue_minor ? ` (${formatMoney(open.overdue_minor)} vencido)` : ""}` : "Nada" },
            ]} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
