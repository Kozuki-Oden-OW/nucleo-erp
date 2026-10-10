import { useEffect, useMemo, useState } from "react";
import { Boxes, Package, PackagePlus, Pencil, Search, Tags } from "lucide-react";
import { useBackend, errorMessage, type PriceHistoryRow, type Product, type ProductCategory } from "../../data";
import { EMPTY_COST_SHEET, grossFromNet, type CostSheet } from "../../data/costing";
import { CategoriesDrawer, CategorySelect, CostInput, PriceInput, useTaxPpm } from "./parts";
import { useSession } from "../../lib/session";
import { formatDate, formatMoney, formatQty, parseQty } from "../../lib/format";
import { UNITS } from "../../data/catalogs";
import { navigate, type Route } from "../../lib/router";
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
  const catFilter = route.query.get("cat") ?? "";
  const managing = route.query.get("categorias") === "1";
  const { can } = useSession();
  const { taxPpm } = useTaxPpm();
  const [cats, setCats] = useState<ProductCategory[]>([]);
  useEffect(() => { backend.productCategories().then(setCats).catch(() => setCats([])); }, [backend, version]);
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(route.query);
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    const t = q.toString();
    navigate(t ? `/productos?${t}` : "/productos", { replace: true });
  };

  useEffect(() => {
    let alive = true;
    const tm = setTimeout(() => { backend.searchProducts(query).then((r) => alive && setRows(r)).catch((e) => setErr(errorMessage(e))); }, 90);
    return () => { alive = false; clearTimeout(tm); };
  }, [backend, query, version]);

  const shown = useMemo(() => rows.filter((p) => (filter === "todos" || (filter === "servicios" ? p.kind === "servicio" : p.kind === "producto" && p.on_hand_milli <= p.min_milli))
    && (!catFilter || (catFilter === "sin" ? !p.category_uid : p.category_uid === catFilter))), [rows, filter, catFilter]);
  const low = rows.filter((p) => p.kind === "producto" && p.on_hand_milli <= p.min_milli).length;
  const product = viewing ? rows.find((p) => p.uid === viewing) : undefined;

  const cols: Column<Product>[] = [
    { key: "s", header: "Código", width: "7rem", render: (p) => <span className="font-mono text-[12.5px] text-muted">{p.sku}</span> },
    { key: "n", header: "Nombre", render: (p) => (
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium text-ink">{p.name}</span>
        {p.category && <span className="truncate text-[11.5px] text-muted">{p.category}</span>}
      </span>
    ) },
    { key: "k", header: "Stock", width: "9rem", align: "right", render: (p) => p.kind === "servicio" ? <Badge>Servicio</Badge> : (
      <span className={p.on_hand_milli <= p.min_milli ? "num font-medium text-danger" : "num"}>{formatQty(p.on_hand_milli)} {p.unit}</span>
    ) },
    { key: "p", header: taxPpm !== null ? "Precio neto" : "Precio", width: "8rem", align: "right", render: (p) => <span className="num">{formatMoney(p.price_minor)}</span> },
    ...(taxPpm !== null ? [{ key: "g", header: "Con IVA", width: "8rem", align: "right" as const, render: (p: Product) => (
      <span className="num text-muted">{p.taxable ? formatMoney(grossFromNet(p.price_minor, taxPpm)) : <span title="Exento de IVA">{formatMoney(p.price_minor)} ·&nbsp;ex.</span>}</span>
    ) }] : []),
    { key: "c", header: "Costo", width: "8rem", align: "right", render: (p) => <span className="num text-muted">{p.cost_e4 ? formatMoney(Math.round(p.cost_e4 / 10_000)) : "—"}</span> },
    { key: "m", header: <span title="Margen sobre el precio neto, sin IVA: (precio neto − costo) ÷ precio neto">Margen</span>, width: "6rem", align: "right", render: (p) => {
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
        actions={<>
          <Button variant="secondary" icon={Tags} onClick={() => go({ categorias: "1" })}>Categorías</Button>
          <Button icon={PackagePlus} onClick={() => navigate(`/productos?nuevo=1`)}>Nuevo producto</Button>
        </>}
      />
      <Tabs
        value={filter}
        onChange={(f) => go({ filtro: f === "todos" ? null : f, ver: null })}
        tabs={[{ value: "todos", label: "Todos", count: rows.length }, { value: "bajo", label: "Poco stock", count: low }, { value: "servicios", label: "Servicios" }]}
      />
      <div className="my-4 flex flex-wrap items-end gap-3">
        <Field aria-label="Buscar productos" leading={<Search size={15} />} placeholder="Nombre, código o categoría (ej. taladro 18v)" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-md" />
        <Select aria-label="Filtrar por categoría" className="w-56" value={catFilter} onChange={(e) => go({ cat: e.target.value || null, ver: null })}
          options={[{ value: "", label: "Todas las categorías" }, ...cats.map((c) => ({ value: c.uid, label: `${c.name} (${c.product_count})` })), { value: "sin", label: "Sin categoría" }]} />
        {taxPpm !== null && <span className="pb-2 text-xs text-muted">El margen se calcula sobre el precio neto (sin IVA).</span>}
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable label="Productos" columns={cols} rows={shown} rowKey={(p) => p.uid} onOpen={(p) => go({ ver: p.uid })} empty={<EmptyState icon={Package} title="Sin productos en esta vista" />} />

      <NewProductDrawer open={creating} cats={cats} taxPpm={taxPpm} defaultCat={catFilter && catFilter !== "sin" ? catFilter : null}
        onManage={() => go({ categorias: "1" })} onClose={() => go({ nuevo: null })} onCreated={() => { setVersion((v) => v + 1); go({ nuevo: null }); }} />
      {product && editing && (
        <EditProductDrawer product={product} cats={cats} taxPpm={taxPpm} onClose={() => go({ editar: null })}
          onSaved={() => { setVersion((v) => v + 1); go({ editar: null }); }} />
      )}
      <CategoriesDrawer open={managing} onClose={() => go({ categorias: null })} categories={cats} products={rows}
        onChanged={(c) => { setCats(c); setVersion((v) => v + 1); }} />
      <Drawer open={!!product && !editing} onClose={() => go({ ver: null })} title={product?.name ?? ""} subtitle={product?.sku}
        footer={product && can("productos.editar") ? <Button variant="secondary" icon={Pencil} onClick={() => go({ editar: "1" })}>Editar</Button> : undefined}>
        {product && (
          <div className="flex flex-col gap-6">
            <DefinitionList items={[
              { label: "Tipo", value: product.kind === "servicio" ? "Servicio" : "Producto" },
              { label: "Categoría", value: product.category ?? <span className="text-muted">Sin categoría</span> },
              { label: "Unidad", value: product.unit },
              { label: taxPpm !== null ? "Precio de venta neto" : "Precio de venta", value: <span className="num">{formatMoney(product.price_minor)}</span> },
              ...(taxPpm !== null ? [{ label: "Precio con IVA", value: <span className="num">{product.taxable ? formatMoney(grossFromNet(product.price_minor, taxPpm)) : `${formatMoney(product.price_minor)} (exento)`}</span> }] : []),
              { label: "Costo promedio", value: <span className="num">{formatMoney(Math.round(product.cost_e4 / 10_000))}</span> },
              ...(product.cost_e4 > 0 && product.price_minor > 0 ? [{ label: "Margen (sobre el neto)", value: <span className="num">{(((product.price_minor - product.cost_e4 / 10_000) / product.price_minor) * 100).toFixed(1).replace(".", ",")} % · {formatMoney(Math.round(product.price_minor - product.cost_e4 / 10_000))} por {product.unit}</span> }] : []),
              ...(product.kind === "producto" ? [
                { label: "Stock disponible", value: <span className="num">{formatQty(product.on_hand_milli)} {product.unit}</span> },
                { label: "Stock mínimo", value: <span className="num">{formatQty(product.min_milli)} {product.unit}</span> },
              ] : []),
            ]} />
            {can("compras.ver") && <PriceHistory productUid={product.uid} />}
            {product.kind === "producto" && backend.features.has("inventario") && can("inventario.ver") && (
              <Button variant="secondary" icon={Boxes} onClick={() => navigate(`/inventario/producto/${product.uid}`)}>Ver kárdex, bodegas y reposición</Button>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function marginNotice(price: number | null, cost: number | null) {
  if (!price || !cost) return null;
  const m = (price - cost) / price;
  return <Notice tone={m < 0 ? "danger" : "info"}>Margen estimado sobre el precio neto: <strong>{(m * 100).toFixed(1).replace(".", ",")} %</strong> ({formatMoney(price - cost)} por unidad, sin IVA).</Notice>;
}

function NewProductDrawer({ open, onClose, onCreated, cats, taxPpm, defaultCat, onManage }: {
  open: boolean; onClose: () => void; onCreated: (p: Product) => void; cats: ProductCategory[]; taxPpm: number | null; defaultCat: string | null; onManage: () => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const [kind, setKind] = useState<"producto" | "servicio">("producto");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("un");
  const [cat, setCat] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [taxable, setTaxable] = useState(true);
  const [cost, setCost] = useState<number | null>(null);
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [stock, setStock] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(""); setSku(""); setPrice(null); setCost(null); setSheet(null); setStock(""); setErr(null); setTaxable(true); setCat(defaultCat); } }, [open, defaultCat]);
  useEffect(() => { setUnit(kind === "servicio" ? "sv" : "un"); }, [kind]);
  async function save() {
    const stockMilli = kind === "producto" && stock.trim() ? parseQty(stock) : 0;
    if (stockMilli === null) { setErr("Revisa el stock inicial: escribe solo números (ej. 12 o 2,5)."); return; }
    try {
      const p = await backend.addProduct({ name, sku: sku || undefined, unit, kind, price_minor: price ?? 0, cost_minor: cost ?? 0, taxable,
        initial_stock_milli: stockMilli || undefined, category_uid: cat, cost_sheet: sheet });
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
        <CategorySelect value={cat} onChange={setCat} categories={cats} onManage={onManage} />
        <PriceInput net={price} onNet={setPrice} taxPpm={taxPpm} taxable={taxable} />
        {taxPpm !== null && <Checkbox label="Afecto a IVA" hint="Desmárcalo si el producto o servicio está exento." checked={taxable} onChange={setTaxable} />}
        <CostInput cost={cost} onCost={setCost} sheet={sheet} onSheet={setSheet} taxPpm={taxPpm} unit={unit} />
        {kind === "producto" && (
          <Field label="Stock inicial" optional inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} suffix={unit}
            hint="Lo que tienes hoy en bodega. Después el stock se mueve solo con ventas y compras." className="max-w-[14rem]" inputClassName="text-right num" />
        )}
        {marginNotice(price, cost)}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}

function EditProductDrawer({ product, onClose, onSaved, cats, taxPpm }: { product: Product; onClose: () => void; onSaved: () => void; cats: ProductCategory[]; taxPpm: number | null }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const [unit, setUnit] = useState(product.unit);
  const [cat, setCat] = useState<string | null>(product.category_uid);
  const [price, setPrice] = useState<number | null>(product.price_minor);
  const [taxable, setTaxable] = useState(product.taxable);
  const [min, setMin] = useState(product.min_milli ? formatQty(product.min_milli) : "");
  const initialCost = Math.round(product.cost_e4 / 10_000);
  const [cost, setCost] = useState<number | null>(initialCost);
  const [sheet, setSheet] = useState<CostSheet | null>(product.cost_sheet);
  const [err, setErr] = useState<string | null>(null);
  const costs = can("costos.ver");
  const locked = product.has_movements;
  async function save() {
    const minMilli = min.trim() ? parseQty(min) : 0;
    if (minMilli === null) { setErr("Revisa el stock mínimo: escribe solo números."); return; }
    try {
      await backend.updateProduct(product.uid, {
        name, sku, unit, price_minor: price ?? 0, taxable, min_milli: minMilli, category_uid: cat,
        ...(costs ? { cost_sheet: sheet ?? (product.cost_sheet ? EMPTY_COST_SHEET : null), cost_minor: !locked && !sheet && cost !== initialCost ? cost ?? 0 : null } : {}),
      });
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
        <CategorySelect value={cat} onChange={setCat} categories={cats} />
        <PriceInput net={price} onNet={setPrice} taxPpm={taxPpm} taxable={taxable} />
        {taxPpm !== null && <Checkbox label="Afecto a IVA" hint="Desmárcalo si el producto o servicio está exento." checked={taxable} onChange={setTaxable} />}
        {costs && (locked ? (
          <div className="flex flex-col gap-2">
            <CostInput cost={initialCost} onCost={() => {}} sheet={null} onSheet={() => {}} taxPpm={taxPpm} unit={unit} disabled
              disabledText="Costo promedio actual. Ya tiene movimientos de stock: lo mueven las compras y los ajustes de inventario." />
            {product.cost_sheet && <p className="text-xs text-muted">Tiene una hoja de costo guardada como referencia.</p>}
          </div>
        ) : (
          <CostInput cost={cost} onCost={setCost} sheet={sheet} onSheet={setSheet} taxPpm={taxPpm} unit={unit} />
        ))}
        {product.kind === "producto" && (
          <Field label="Stock mínimo" optional inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} suffix={unit}
            hint="Bajo este nivel el producto aparece en “Poco stock”." className="max-w-[14rem]" inputClassName="text-right num" />
        )}
        {costs && marginNotice(price, locked ? initialCost : cost)}
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
