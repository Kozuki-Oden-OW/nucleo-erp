// Inventario: existencias con análisis (velocidad, cobertura, quiebre), ajustes y transferencias, bodegas.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardCheck, PackageX, Plus, Search, Star, Archive, Pencil, TrendingDown, Warehouse as WarehouseIcon } from "lucide-react";
import { useBackend, errorMessage, type InventoryOverview, type StockAnalysis, type StockDocRow, type StockStatus, type Warehouse } from "../../data";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Kpi, Notice, PageHeader, Spinner, Tabs, type Tone } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

export const STOCK_STATUS: Record<StockStatus, [Tone, string]> = {
  sin_stock: ["danger", "Sin stock"],
  riesgo_quiebre: ["warning", "Riesgo de quiebre"],
  bajo_minimo: ["warning", "Bajo el mínimo"],
  exceso: ["info", "Exceso"],
  sin_movimiento: ["neutral", "Sin movimiento"],
  ok: ["success", "Normal"],
};

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const [tone, label] = STOCK_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

type Tab = "existencias" | "movimientos" | "bodegas";
type Filter = "todos" | StockStatus;

export function Inventory({ route }: { route: Route }) {
  const { can } = useSession();
  const tab = (route.query.get("tab") as Tab) || "existencias";
  const setTab = (t: Tab) => navigate(t === "existencias" ? "/inventario" : `/inventario?tab=${t}`, { replace: true });
  return (
    <div className="anim-in">
      <PageHeader
        title="Inventario"
        subtitle="Cuánto tienes, dónde está, cuánto vendes por día y cuándo se te acaba. Cada movimiento queda en el kárdex."
        actions={can("inventario.ajustar") && (
          <>
            <Button variant="secondary" icon={ArrowLeftRight} onClick={() => navigate("/inventario/transferencia")}>Transferir</Button>
            <Button icon={ClipboardCheck} onClick={() => navigate("/inventario/ajuste")}>Ajuste o conteo</Button>
          </>
        )}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "existencias", label: "Existencias" }, { value: "movimientos", label: "Ajustes y transferencias" }, { value: "bodegas", label: "Bodegas" }]} />
      <div className="mt-4">
        {tab === "existencias" && <Stock route={route} />}
        {tab === "movimientos" && <Docs />}
        {tab === "bodegas" && <Warehouses />}
      </div>
    </div>
  );
}

function Stock({ route }: { route: Route }) {
  const backend = useBackend();
  const [o, setO] = useState<InventoryOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const filter = (route.query.get("filtro") as Filter) || "todos";
  const setFilter = (f: Filter) => navigate(f === "todos" ? "/inventario" : `/inventario?filtro=${f}`, { replace: true });
  useEffect(() => { backend.inventoryOverview().then(setO).catch((e) => setErr(errorMessage(e))); }, [backend]);
  const count = (s: StockStatus) => o?.rows.filter((r) => r.status === s).length ?? 0;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return (o?.rows ?? []).filter((r) => (filter === "todos" || r.status === filter) && (!q || `${r.name} ${r.sku}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)));
  }, [o, filter, query]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!o) return <Spinner label="Analizando el inventario…" />;

  const cols: Column<StockAnalysis>[] = [
    { key: "s", header: "Código", width: "7rem", render: (r) => <span className="font-mono text-[12.5px] text-muted">{r.sku}</span> },
    { key: "n", header: "Producto", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: "q", header: "Stock", width: "7.5rem", align: "right", render: (r) => <span className={`num ${r.on_hand_milli <= 0 ? "font-medium text-danger" : ""}`}>{formatQty(r.on_hand_milli)} {r.unit}</span> },
    { key: "f", header: "Por llegar", width: "7rem", align: "right", render: (r) => <span className="num text-muted">{r.in_purchase_milli ? formatQty(r.in_purchase_milli) : "—"}</span> },
    { key: "v", header: "Vende/día", width: "6.5rem", align: "right", render: (r) => <span className="num text-muted">{r.velocity_milli !== null ? formatQty(r.velocity_milli) : "—"}</span> },
    { key: "c", header: "Alcanza", width: "6.5rem", align: "right", render: (r) => <span className="num">{r.coverage_days !== null ? `${r.coverage_days} d` : "—"}</span> },
    { key: "e", header: "Estado", width: "10.5rem", render: (r) => <StockStatusBadge status={r.status} /> },
    { key: "a", header: "Sugerencia", width: "9rem", render: (r) => r.advice.kind === "comprar" && r.advice.quantity_milli ? <span className="text-accent">Comprar {formatQty(r.advice.quantity_milli)}</span> : <span className="text-faint">—</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Valor del inventario" value={formatMoney(o.total_value_minor)} hint={`${o.rows.filter((r) => r.on_hand_milli > 0).length} productos con stock`} icon={Boxes} onClick={() => setFilter("todos")} />
        <Kpi label="Sin stock" value={count("sin_stock")} tone={count("sin_stock") ? "danger" : undefined} icon={PackageX} onClick={() => setFilter("sin_stock")} />
        <Kpi label="Riesgo de quiebre" value={count("riesgo_quiebre")} tone={count("riesgo_quiebre") ? "warning" : undefined} hint="Se acaba antes de reponer" icon={AlertTriangle} onClick={() => setFilter("riesgo_quiebre")} />
        <Kpi label="Bajo el mínimo" value={count("bajo_minimo")} tone={count("bajo_minimo") ? "warning" : undefined} icon={TrendingDown} onClick={() => setFilter("bajo_minimo")} />
        <Kpi label="Sin movimiento" value={count("sin_movimiento")} hint={`${o.window_days} días sin vender`} icon={Archive} onClick={() => setFilter("sin_movimiento")} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Field aria-label="Buscar producto" leading={<Search size={15} />} placeholder="Nombre o código" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-sm" />
        {filter !== "todos" && <Button variant="ghost" size="sm" onClick={() => setFilter("todos")}>Ver todos ({o.rows.length})</Button>}
        <span className="text-xs text-muted">Velocidad calculada con los últimos {o.window_days} días, contando solo los días con stock.</span>
      </div>
      <DataTable label="Existencias" columns={cols} rows={rows} rowKey={(r) => r.uid} onOpen={(r) => navigate(`/inventario/producto/${r.uid}`)}
        empty={<EmptyState icon={Boxes} title={filter === "todos" ? "Aún no tienes productos con stock" : "Ningún producto en esta situación"} />} />
    </div>
  );
}

function Docs() {
  const backend = useBackend();
  const [rows, setRows] = useState<StockDocRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { backend.stockDocuments().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  const kind: Record<StockDocRow["kind"], [Tone, string]> = { ajuste: ["warning", "Ajuste"], conteo: ["info", "Conteo"], transferencia: ["accent", "Transferencia"] };
  const cols: Column<StockDocRow>[] = [
    { key: "n", header: "Número", width: "9rem", render: (d) => <span className="font-mono text-[13px] font-medium">{d.number}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (d) => <span className="num text-muted">{formatDate(d.date)}</span> },
    { key: "k", header: "Tipo", width: "8.5rem", render: (d) => <Badge tone={kind[d.kind][0]}>{kind[d.kind][1]}</Badge> },
    { key: "d", header: "Detalle", render: (d) => <span className="text-ink">{d.description}</span> },
    { key: "l", header: "Productos", width: "6.5rem", align: "right", render: (d) => <span className="num">{d.lines}</span> },
    { key: "u", header: "Por", width: "9rem", render: (d) => <span className="text-muted">{d.created_by ?? "—"}</span> },
  ];
  return <DataTable label="Ajustes y transferencias" columns={cols} rows={rows ?? []} rowKey={(d) => d.uid}
    empty={<EmptyState icon={ClipboardCheck} title="Sin ajustes ni transferencias">Los conteos y las correcciones de stock aparecen aquí, con su motivo.</EmptyState>} />;
}

function Warehouses() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [rows, setRows] = useState<Warehouse[] | null>(null);
  const [negative, setNegative] = useState<boolean | null>(null);
  const [edit, setEdit] = useState<{ uid: string | null; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    backend.warehouses().then(setRows).catch((e) => setErr(errorMessage(e)));
    backend.inventorySettings().then((s) => setNegative(s.allow_negative)).catch(() => {});
  }, [backend]);
  const run = async (f: () => Promise<Warehouse[]>, ok: string) => { try { setRows(await f()); toast("success", ok); } catch (e) { toast("danger", errorMessage(e)); } };
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;
  const editable = can("inventario.ajustar");
  return (
    <div className="flex flex-col gap-6">
      <Card title="Bodegas" subtitle="Las ventas descuentan y las compras ingresan en la bodega principal. Mueve stock entre bodegas con una transferencia."
        actions={editable && <Button size="sm" icon={Plus} onClick={() => setEdit({ uid: null, name: "" })}>Nueva bodega</Button>} padded={false}>
        <ul className="divide-y divide-line">
          {rows.map((w) => (
            <li key={w.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <WarehouseIcon size={18} className={w.is_default ? "text-accent" : "text-muted"} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium text-ink">{w.name} {w.is_default && <Badge tone="accent">Principal</Badge>} {w.archived && <Badge>Archivada</Badge>}</div>
                <div className="text-xs text-muted">{w.code} · {w.products_with_stock} productos con stock{w.stock_value_minor ? ` · ${formatMoney(w.stock_value_minor)}` : ""}</div>
              </div>
              {editable && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ uid: w.uid, name: w.name })}>Renombrar</Button>
                  {!w.is_default && <Button size="sm" variant="ghost" icon={Star} onClick={() => run(() => backend.setDefaultWarehouse(w.uid), `${w.name} es ahora la bodega principal.`)}>Hacer principal</Button>}
                  {!w.is_default && !w.archived && <Button size="sm" variant="ghost" icon={Archive} onClick={() => run(() => backend.archiveWarehouse(w.uid), "Bodega archivada.")}>Archivar</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {negative !== null && (
        <Card title="Reglas de stock">
          <Checkbox label="Permitir vender aunque no haya stock" checked={negative}
            hint="Si lo desactivas, NÚCLEO no deja efectuar una venta que deje la bodega principal con stock negativo."
            onChange={async (v) => {
              if (!can("config.editar")) { toast("danger", "Solo el dueño o un administrador cambia esta regla."); return; }
              try { setNegative((await backend.updateInventorySettings({ allow_negative: v })).allow_negative); toast("success", "Regla de stock guardada."); } catch (e) { toast("danger", errorMessage(e)); }
            }} />
        </Card>
      )}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit?.uid ? "Renombrar bodega" : "Nueva bodega"}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button disabled={!edit?.name.trim()} onClick={async () => {
          const e = edit!; setEdit(null);
          await run(() => (e.uid ? backend.renameWarehouse(e.uid, e.name) : backend.createWarehouse(e.name)), e.uid ? "Bodega renombrada." : "Bodega creada.");
        }}>Guardar</Button></>}>
        <Field label="Nombre" value={edit?.name ?? ""} onChange={(e) => setEdit((x) => (x ? { ...x, name: e.target.value } : x))} placeholder="Ej. Sala de ventas, Sucursal centro" autoFocus />
      </Dialog>
    </div>
  );
}
