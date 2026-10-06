import { useEffect, useMemo, useState } from "react";
import { Package, PackagePlus, Pencil, Search } from "lucide-react";
import { useBackend, errorMessage, type PriceHistoryRow, type Product } from "../../data";
import { useSession } from "../../lib/session";
import { formatDate, formatMoney, formatQty, parseQty } from "../../lib/format";
import { UNITS } from "../../data/catalogs";
import { navigate, type Route } from "../../lib/router";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Checkbox, DefinitionList, EmptyState, Field, Notice, PageHeader, Segmented, Select, Tabs } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

type Filter = "todos" | "bajo" | "servicios";

export function Products({ route }: { route: Route }) {
  const backend = useBackend();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Product[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const filter = (route.query.get("filtro") as Filter) || "todos";
  const viewing = route.query.get("ver");
  const creating = route.query.get("nuevo") === "1";
  const editing = route.query.get("editar") === "1";
  const { can } = useSession();

  useEffect(() => {
    let alive = true;
    const tm = setTimeout(() => { backend.searchProducts(query).then((r) => alive && setRows(r)).catch((e) => setErr(errorMessage(e))); }, 90);
    return () => { alive = false; clearTimeout(tm); };
  }, [backend, query, version]);

  const shown = useMemo(() => rows.filter((p) => filter === "todos" || (filter === "servicios" ? p.kind === "servicio" : p.kind === "producto" && p.on_hand_milli <= p.min_milli)), [rows, filter]);
  const low = rows.filter((p) => p.kind === "producto" && p.on_hand_milli <= p.min_milli).length;
  const product = viewing ? rows.find((p) => p.uid === viewing) : undefined;

  const cols: Column<Product>[] = [
    { key: "s", header: "Código", width: "7rem", render: (p) => <span className="font-mono text-[12.5px] text-muted">{p.sku}</span> },
    { key: "n", header: "Nombre", render: (p) => <span className="font-medium text-ink">{p.name}</span> },
    { key: "k", header: "Stock", width: "9rem", align: "right", render: (p) => p.kind === "servicio" ? <Badge>Servicio</Badge> : (
      <span className={p.on_hand_milli <= p.min_milli ? "num font-medium text-danger" : "num"}>{formatQty(p.on_hand_milli)} {p.unit}</span>
    ) },
    { key: "p", header: "Precio", width: "8rem", align: "right", render: (p) => <span className="num">{formatMoney(p.price_minor)}</span> },
    { key: "c", header: "Costo", width: "8rem", align: "right", render: (p) => <span className="num text-muted">{p.cost_e4 ? formatMoney(Math.round(p.cost_e4 / 10_000)) : "—"}</span> },
    { key: "m", header: "Margen", width: "6rem", align: "right", render: (p) => {
      const cost = p.cost_e4 / 10_000;
      if (!cost || !p.price_minor) return <span className="text-faint">—</span>;
      const m = (p.price_minor - cost) / p.price_minor;
      return <span className={m < 0.15 ? "num text-warning" : "num text-success"}>{(m * 100).toFixed(0)} %</span>;
    } },
  ];

  return (
    <div className="anim-in">
      <PageHeader
        title="Productos y servicios"
        subtitle="Precio, costo promedio, margen y stock en un solo lugar."
        actions={<Button icon={PackagePlus} onClick={() => navigate(`/productos?nuevo=1`)}>Nuevo producto</Button>}
      />
      <Tabs
        value={filter}
        onChange={(f) => navigate(f === "todos" ? "/productos" : `/productos?filtro=${f}`, { replace: true })}
        tabs={[{ value: "todos", label: "Todos", count: rows.length }, { value: "bajo", label: "Poco stock", count: low }, { value: "servicios", label: "Servicios" }]}
      />
      <div className="my-4"><Field aria-label="Buscar productos" leading={<Search size={15} />} placeholder="Nombre o código (ej. taladro 18v)" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" /></div>
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable label="Productos" columns={cols} rows={shown} rowKey={(p) => p.uid} onOpen={(p) => navigate(`/productos?ver=${p.uid}${filter !== "todos" ? `&filtro=${filter}` : ""}`, { replace: true })} empty={<EmptyState icon={Package} title="Sin productos en esta vista" />} />

      <NewProductDrawer open={creating} onClose={() => navigate("/productos", { replace: true })} onCreated={() => { setVersion((v) => v + 1); navigate("/productos", { replace: true }); }} />
      {product && editing && (
        <EditProductDrawer product={product} onClose={() => navigate(`/productos?ver=${product.uid}`, { replace: true })}
          onSaved={() => { setVersion((v) => v + 1); navigate(`/productos?ver=${product.uid}`, { replace: true }); }} />
      )}
      <Drawer open={!!product && !editing} onClose={() => navigate(filter !== "todos" ? `/productos?filtro=${filter}` : "/productos", { replace: true })} title={product?.name ?? ""} subtitle={product?.sku}
        footer={product && can("productos.editar") ? <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/productos?ver=${product.uid}&editar=1`, { replace: true })}>Editar</Button> : undefined}>
        {product && (
          <div className="flex flex-col gap-6">
            <DefinitionList items={[
              { label: "Tipo", value: product.kind === "servicio" ? "Servicio" : "Producto" },
              { label: "Unidad", value: product.unit },
              { label: "Precio de venta", value: <span className="num">{formatMoney(product.price_minor)}</span> },
              { label: "Costo promedio", value: <span className="num">{formatMoney(Math.round(product.cost_e4 / 10_000))}</span> },
              ...(product.kind === "producto" ? [
                { label: "Stock disponible", value: <span className="num">{formatQty(product.on_hand_milli)} {product.unit}</span> },
                { label: "Stock mínimo", value: <span className="num">{formatQty(product.min_milli)} {product.unit}</span> },
              ] : []),
            ]} />
            {can("compras.ver") && <PriceHistory productUid={product.uid} />}
            <Notice tone="info">Stock real y proyectado, kárdex, ajustes, velocidad de venta y punto de reorden llegan en la Fase 7 (Inventario).</Notice>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function NewProductDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Product) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [kind, setKind] = useState<"producto" | "servicio">("producto");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("un");
  const [price, setPrice] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [stock, setStock] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(""); setSku(""); setPrice(null); setCost(null); setStock(""); setErr(null); } }, [open]);
  useEffect(() => { setUnit(kind === "servicio" ? "sv" : "un"); }, [kind]);
  const margin = price && cost ? (price - cost) / price : null;
  async function save() {
    const stockMilli = kind === "producto" && stock.trim() ? parseQty(stock) : 0;
    if (stockMilli === null) { setErr("Revisa el stock inicial: escribe solo números (ej. 12 o 2,5)."); return; }
    try {
      const p = await backend.addProduct({ name, sku: sku || undefined, unit, kind, price_minor: price ?? 0, cost_minor: cost ?? 0, initial_stock_milli: stockMilli || undefined });
      toast("success", `${p.name} agregado.`);
      onCreated(p);
    } catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Drawer open={open} onClose={onClose} title="Nuevo producto o servicio" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={!name.trim()}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Segmented label="Tipo" value={kind} onChange={setKind} options={[{ value: "producto", label: "Producto (lleva stock)" }, { value: "servicio", label: "Servicio" }]} />
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código" optional value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Se genera si lo dejas vacío" />
          <Select label="Unidad" value={unit} onChange={(e) => setUnit(e.target.value)} options={UNITS} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <MoneyField label="Precio de venta" value={price} onValue={setPrice} />
          <MoneyField label="Costo" value={cost} onValue={setCost} hint="Lo que te cuesta a ti" />
        </div>
        {kind === "producto" && (
          <Field label="Stock inicial" optional inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} suffix={unit}
            hint="Lo que tienes hoy en bodega. Después el stock se mueve solo con ventas y compras." className="max-w-[14rem]" inputClassName="text-right num" />
        )}
        {margin !== null && <Notice tone={margin < 0 ? "danger" : "info"}>Margen estimado: <strong>{(margin * 100).toFixed(1).replace(".", ",")} %</strong> ({formatMoney((price ?? 0) - (cost ?? 0))} por unidad).</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}

function EditProductDrawer({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const [unit, setUnit] = useState(product.unit);
  const [price, setPrice] = useState<number | null>(product.price_minor);
  const [taxable, setTaxable] = useState(product.taxable);
  const [min, setMin] = useState(product.min_milli ? formatQty(product.min_milli) : "");
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    const minMilli = min.trim() ? parseQty(min) : 0;
    if (minMilli === null) { setErr("Revisa el stock mínimo: escribe solo números."); return; }
    try {
      await backend.updateProduct(product.uid, { name, sku, unit, price_minor: price ?? 0, taxable, min_milli: minMilli });
      toast("success", "Producto actualizado.");
      onSaved();
    } catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Drawer open onClose={onClose} title="Editar producto" subtitle="El nuevo precio se usa en los documentos que crees desde ahora."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={!name.trim() || !sku.trim()}>Guardar cambios</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código" value={sku} onChange={(e) => setSku(e.target.value)} />
          <Select label="Unidad" value={unit} onChange={(e) => setUnit(e.target.value)} options={UNITS} />
        </div>
        <MoneyField label="Precio de venta" value={price} onValue={setPrice} />
        {product.kind === "producto" && (
          <Field label="Stock mínimo" optional inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} suffix={unit}
            hint="Bajo este nivel el producto aparece en “Poco stock”." className="max-w-[14rem]" inputClassName="text-right num" />
        )}
        <Checkbox label="Afecto a IVA" hint="Desmárcalo si el producto o servicio está exento." checked={taxable} onChange={setTaxable} />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}

function PriceHistory({ productUid }: { productUid: string }) {
  const backend = useBackend();
  const [rows, setRows] = useState<PriceHistoryRow[] | null>(null);
  useEffect(() => { backend.priceHistory(productUid).then(setRows).catch(() => setRows([])); }, [backend, productUid]);
  if (!rows) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">Precios de compra</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">Aún no hay compras de este producto.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {rows.slice(0, 8).map((r, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2">
              <span className="num w-[5.5rem] shrink-0 text-muted">{formatDate(r.date)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{r.supplier_name}</span>
              <span className="font-mono text-[12px] text-muted">{r.document}</span>
              <span className="num w-20 text-right font-medium">{formatMoney(r.unit_price_minor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
