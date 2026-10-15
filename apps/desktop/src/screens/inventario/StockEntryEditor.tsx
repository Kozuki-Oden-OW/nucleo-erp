// Agregar stock: la mercadería que llegó (cantidad, costo, fecha, bodega y, si quieres, proveedor y
// documento de respaldo). Suma al stock y recalcula el costo promedio. Buscar producto → Enter → cantidad → costo.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FilePlus2, PackagePlus, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type Product, type Supplier, type Warehouse } from "../../data";
import { formatMoney, formatQty, parseMoney, parseQty, todayIso } from "../../lib/format";
import { goBack, navigate, useRoute } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, Card, Checkbox, Field, IconButton, Notice, PageHeader, Select, Spinner, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { SupplierFormDrawer } from "../compras/common";
import { ProductPicker, SupplierPicker, type ProductPickerHandle } from "../ventas/pickers";

/** Stock y costo promedio del producto en la bodega elegida (null mientras carga). */
interface Current { qty: number; avg_e4: number }
interface Row { key: number; product: Product; qty: string; cost: string; current: Current | null }
let seq = 0;
const IVA = 1.19;

export function StockEntryEditor() {
  const backend = useBackend();
  const toast = useToast();
  const route = useRoute();
  const { can } = useSession();
  const costs = can("costos.ver");
  const [whs, setWhs] = useState<Warehouse[] | null>(null);
  const [wh, setWh] = useState("");
  const [date, setDate] = useState(todayIso());
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [withIva, setWithIva] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<ProductPickerHandle>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => { if (focus === null) return; const el = inputs.current.get(focus); if (el) { el.focus(); el.select(); setFocus(null); } }, [focus, rows]);

  useEffect(() => {
    backend.warehouses().then((w) => {
      const active = w.filter((x) => !x.archived);
      setWhs(active);
      setWh((active.find((x) => x.is_default) ?? active[0])?.uid ?? "");
    }).catch((e) => setErr(errorMessage(e)));
  }, [backend]);

  // Desde la ficha de un producto: «Agregar stock» llega con ?producto=uid ya cargado.
  const preset = route.query.get("producto");
  useEffect(() => {
    if (!preset) return;
    backend.productInventory(preset).then((d) => add(d.product)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, preset]);

  // Stock y costo actuales en la bodega elegida (para mostrar en qué queda el promedio).
  useEffect(() => {
    if (!wh) return;
    let alive = true;
    Promise.all(rows.map((r) => backend.productInventory(r.product.uid).then((d) => {
      const b = d.by_warehouse.find((x) => x.warehouse_uid === wh);
      return { qty: b?.on_hand_milli ?? 0, avg_e4: b?.avg_cost_e4 ?? d.product.cost_e4 };
    }).catch(() => null)))
      .then((cur) => alive && setRows((rs) => rs.map((r, i) => ({ ...r, current: cur[i] ?? r.current }))));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, wh, rows.length]);

  function add(p: Product | null) {
    if (!p) { toast("info", "Elige un producto de la lista. Si es nuevo, créalo primero en Productos."); return; }
    if (p.kind !== "producto") { toast("info", `${p.name} es un servicio: no lleva stock.`); return; }
    const same = rows.find((r) => r.product.uid === p.uid);
    if (same) { setFocus(`q${same.key}`); return; }
    const row: Row = { key: ++seq, product: p, qty: "", cost: "", current: null };
    setRows((rs) => (rs.some((r) => r.product.uid === p.uid) ? rs : [...rs, row]));
    setFocus(`q${row.key}`);
  }
  const patch = (key: number, x: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...x } : r)));

  /** Costo neto por unidad (pesos) escrito en la fila, o null si quedó vacío (usa el promedio). */
  const netCost = (r: Row): number | null => {
    const v = parseMoney(r.cost);
    if (v === null) return null;
    return withIva ? Math.round(v / IVA) : v;
  };
  const lineCost = (r: Row) => netCost(r) ?? (r.current ? Math.round(r.current.avg_e4 / 10_000) : Math.round(r.product.cost_e4 / 10_000));
  const total = rows.reduce((a, r) => a + Math.round(((parseQty(r.qty) ?? 0) * lineCost(r)) / 1000), 0);

  async function save() {
    setErr(null);
    for (const r of rows) {
      const q = parseQty(r.qty);
      if (q === null || q <= 0) { setErr(`Escribe cuántas unidades de ${r.product.name} llegaron.`); setFocus(`q${r.key}`); return; }
      if (r.cost.trim() && parseMoney(r.cost) === null) { setErr(`Revisa el costo de ${r.product.name}: escribe solo números.`); setFocus(`c${r.key}`); return; }
    }
    setBusy(true);
    try {
      const done = await backend.addStock({
        warehouse_uid: wh, date,
        supplier_uid: supplier?.uid, reference: reference.trim() || undefined, notes: notes.trim() || undefined,
        lines: rows.map((r) => ({ product_uid: r.product.uid, qty_milli: parseQty(r.qty)!, unit_cost_minor: costs ? netCost(r) : null })),
      });
      toast("success", `${done.number} registrado: ${done.moved_lines} ${done.moved_lines === 1 ? "producto con stock agregado" : "productos con stock agregado"}.`);
      if (preset && rows.length === 1) navigate(`/inventario/producto/${preset}`, { replace: true });
      else navigate("/inventario?tab=movimientos", { replace: true });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!whs) return err ? <Notice tone="danger">{err}</Notice> : <Spinner />;
  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/inventario")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Inventario</button>}
        title="Agregar stock"
        subtitle="Ingresa la mercadería que llegó: se suma al stock y recalcula el costo promedio. Queda en el kárdex y en la auditoría."
        actions={<Button icon={PackagePlus} onClick={save} disabled={busy || rows.length === 0 || !wh}>{busy ? "Guardando…" : "Agregar stock"}</Button>}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)]">
            <Select label="Bodega" value={wh} onChange={(e) => setWh(e.target.value)} options={whs.map((w) => ({ value: w.uid, label: w.name }))} />
            <Field label="Fecha de llegada" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Field label="Documento de respaldo" optional value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej. factura 1234, guía 88" maxLength={80} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {can("proveedores.ver") && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Proveedor <span className="font-normal text-faint">(opcional)</span></span>
                <SupplierPicker value={supplier} onChange={setSupplier} onCreate={(name) => setNewSupplier(name)} />
              </div>
            )}
            <TextArea label="Notas" optional value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. llegó con la caja dañada, reposición de temporada" rows={1} maxLength={500} />
          </div>
        </Card>

        <Card title="Productos que llegaron" padded={false}
          actions={costs && <Checkbox label="Los costos incluyen IVA" checked={withIva} onChange={setWithIva} />}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Producto</th><th className="w-28 px-2 text-right">En bodega</th>
              <th className="w-32 px-2 text-right">Cantidad</th>
              {costs && <><th className="w-48 px-2 text-right">Costo unitario{withIva ? " (con IVA)" : " (neto)"}</th><th className="w-28 px-2 text-right">Subtotal</th></>}
              <th className="w-10" />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const q = parseQty(r.qty);
                const c = lineCost(r);
                const avg = r.current ? Math.round(r.current.avg_e4 / 10_000) : null;
                const after = r.current && q && q > 0
                  ? r.current.qty > 0 ? Math.round((r.current.qty * (r.current.avg_e4 / 10_000) + q * c) / (r.current.qty + q)) : c
                  : null;
                return (
                  <tr key={r.key} className="border-b border-line align-top">
                    <td className="px-4 py-2.5 text-ink">{r.product.name}<span className="ml-2 font-mono text-xs text-muted">{r.product.sku}</span></td>
                    <td className="num px-2 py-2.5 text-right text-muted">{r.current === null ? "…" : `${formatQty(r.current.qty)} ${r.product.unit}`}</td>
                    <td className="px-2 py-1.5">
                      <input ref={(el) => { if (el) inputs.current.set(`q${r.key}`, el); else inputs.current.delete(`q${r.key}`); }} aria-label={`Cantidad que llegó de ${r.product.name}`} inputMode="decimal" value={r.qty} placeholder="0"
                        onChange={(e) => patch(r.key, { qty: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (costs) setFocus(`c${r.key}`); else picker.current?.focus(); } }}
                        className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" />
                      {q !== null && q > 0 && r.current && <div className="mt-1 text-right text-xs text-muted">queda en {formatQty(r.current.qty + q)}</div>}
                    </td>
                    {costs && (
                      <>
                        <td className="px-2 py-1.5">
                          <input ref={(el) => { if (el) inputs.current.set(`c${r.key}`, el); else inputs.current.delete(`c${r.key}`); }} aria-label={`Costo unitario de ${r.product.name}`} inputMode="decimal" value={r.cost}
                            placeholder={avg !== null ? `${formatMoney(avg)} (actual)` : ""}
                            onChange={(e) => patch(r.key, { cost: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); picker.current?.focus(); } }}
                            className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right placeholder:text-faint focus:border-accent focus:outline-none" />
                          <div className="mt-1 text-right text-xs text-muted">
                            {withIva && netCost(r) !== null ? `${formatMoney(netCost(r)!)} neto · ` : ""}
                            {after !== null && avg !== null && after !== avg ? `promedio ${formatMoney(avg)} → ${formatMoney(after)}` : r.cost.trim() ? "" : "vacío: usa el costo actual"}
                          </div>
                        </td>
                        <td className="num px-2 py-2.5 text-right">{q ? formatMoney(Math.round((q * c) / 1000)) : "—"}</td>
                      </>
                    )}
                    <td className="py-1.5 pr-2"><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /></td>
                  </tr>
                );
              })}
            </tbody>
            {costs && rows.length > 0 && (
              <tfoot><tr>
                <td colSpan={4} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted">Total neto que ingresa</td>
                <td className="num px-2 py-3 text-right font-semibold text-ink">{formatMoney(total)}</td><td />
              </tr></tfoot>
            )}
          </table>
          <div className="p-4"><ProductPicker ref={picker} onPick={(p) => add(p)} /></div>
        </Card>

        <Notice tone="info" title="¿Tienes la factura del proveedor?"
          actions={can("compras.crear") && <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => navigate(supplier ? `/compras/doc/nueva?proveedor=${supplier.uid}` : "/compras/doc/nueva")}>Registrar compra</Button>}>
          Agregar stock solo mueve el inventario: no registra lo que le debes al proveedor ni el IVA crédito. Si la mercadería viene con factura, regístrala como compra (también ingresa el stock), así no la cuentas dos veces.
        </Notice>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
      <SupplierFormDrawer open={newSupplier !== null} initialName={newSupplier ?? ""} onClose={() => setNewSupplier(null)} onSaved={(s) => { setSupplier(s); setNewSupplier(null); }} />
    </div>
  );
}
