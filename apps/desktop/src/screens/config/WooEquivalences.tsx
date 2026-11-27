// Equivalencias entre los productos de la tienda WooCommerce y los de NÚCLEO. La tienda puede no usar
// SKU, o vender combos y packs: aquí se dice «este producto de la tienda = estos productos de NÚCLEO»
// para que cada pedido descuente el stock correcto.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, useBackend, type Product, type WooCatalogItem, type WooComponent } from "../../data";
import { formatCLP, parseQty } from "../../lib/format";
import { Badge, Button, Checkbox, IconButton, Notice, Spinner } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

const keyOf = (c: { product_id: string; variation_id: string }) => `${c.product_id}:${c.variation_id}`;
const qtyText = (m: number) => String(m / 1000).replace(".", ",");
interface Draft { product_uid: string; qty: string }

export function WooEquivalences({ open, onClose, editable }: { open: boolean; onClose: () => void; editable: boolean }) {
  const backend = useBackend();
  const toast = useToast();
  const [rows, setRows] = useState<WooCatalogItem[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const [editing, setEditing] = useState<{ key: string; items: Draft[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [cat, prods] = await Promise.all([backend.wooCatalog(), backend.searchProducts("")]);
      setRows(cat);
      setProducts(prods.slice().sort((a, b) => a.name.localeCompare(b.name, "es")));
    } catch (e) { setErr(errorMessage(e)); }
  }, [backend]);
  useEffect(() => { if (open) { setRows(null); setEditing(null); void load(); } }, [open, load]);

  const counts = useMemo(() => ({
    sku: rows?.filter((r) => r.matched_by === "sku").length ?? 0,
    map: rows?.filter((r) => r.matched_by === "equivalencia").length ?? 0,
    none: rows?.filter((r) => !r.matched_by).length ?? 0,
  }), [rows]);
  const shown = (rows ?? []).filter((r) => !onlyPending || !r.matched_by);

  function start(r: WooCatalogItem) {
    const base = r.components.length ? r.components : r.suggestion ? [r.suggestion] : [];
    setEditing({ key: keyOf(r), items: base.length ? base.map((c) => ({ product_uid: c.product_uid, qty: qtyText(c.qty_milli) })) : [{ product_uid: "", qty: "1" }] });
  }
  async function save(r: WooCatalogItem, items: WooComponent[]) {
    setBusy(true);
    try {
      await backend.wooSaveEquivalence({ product_id: r.product_id, variation_id: r.variation_id, name: r.name, items });
      toast("success", items.length ? `«${r.name}» quedó enlazado.` : `Se quitó la equivalencia de «${r.name}».`);
      setEditing(null);
      await load();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  function confirm(r: WooCatalogItem) {
    if (!editing) return;
    const items: WooComponent[] = [];
    for (const d of editing.items) {
      const q = parseQty(d.qty);
      if (!d.product_uid || !q || q <= 0) { toast("danger", "Elige el producto de NÚCLEO y una cantidad mayor que cero en cada fila."); return; }
      items.push({ product_uid: d.product_uid, qty_milli: q });
    }
    void save(r, items);
  }
  const put = (i: number, patch: Partial<Draft>) => setEditing((e) => e && { ...e, items: e.items.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Equivalencias de productos"
      footer={<Button variant="ghost" onClick={onClose}>Cerrar</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          NÚCLEO reconoce los productos de la tienda por su código (SKU). Si la tienda no usa SKU, o vende combos y packs, indica aquí a qué producto de NÚCLEO
          equivale cada uno y cuántas unidades descuenta. Nada cambia en la tienda.
        </p>
        {err && <Notice tone="danger">{err}</Notice>}
        {!rows && !err && <Spinner />}
        {rows && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="success">{counts.sku} por SKU</Badge>
              <Badge tone="success">{counts.map} por equivalencia</Badge>
              <Badge tone={counts.none ? "warning" : "success"}>{counts.none} sin reconocer</Badge>
              <Checkbox label="Mostrar solo los que faltan" checked={onlyPending} onChange={setOnlyPending} />
            </div>
            {shown.length === 0 ? <p className="text-sm text-muted">{onlyPending ? "Todos los productos de la tienda están reconocidos." : "La tienda no tiene productos."}</p> : (
              <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {shown.map((r) => {
                  const k = keyOf(r);
                  const ed = editing?.key === k ? editing : null;
                  return (
                    <li key={k} className="flex flex-col gap-2 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 font-medium text-ink">{r.name}</span>
                        {r.price_minor !== null && <span className="num text-muted">{formatCLP(r.price_minor)}</span>}
                        {r.matched_by === "sku" && <Badge tone="success">SKU {r.sku}</Badge>}
                        {editable && r.matched_by !== "sku" && !ed && <Button size="sm" variant="secondary" onClick={() => start(r)}>{r.components.length ? "Cambiar" : "Enlazar"}</Button>}
                        {editable && r.matched_by === "equivalencia" && !ed && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(r, [])}>Quitar</Button>}
                      </div>
                      {!ed && r.components.length > 0 && (
                        <div className="text-muted">= {r.components.map((c) => `${qtyText(c.qty_milli)} × ${c.name}${c.sku ? ` (${c.sku})` : ""}`).join(" + ")}</div>
                      )}
                      {!ed && !r.matched_by && r.suggestion && <div className="text-xs text-muted">Se parece a: {r.suggestion.name}</div>}
                      {ed && (
                        <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-2.5">
                          {ed.items.map((d, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input aria-label="Cantidad" inputMode="decimal" value={d.qty} onChange={(e) => put(i, { qty: e.target.value })}
                                className="num h-9 w-16 rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" />
                              <span className="text-muted">×</span>
                              <select aria-label="Producto de NÚCLEO" value={d.product_uid} onChange={(e) => put(i, { product_uid: e.target.value })}
                                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-ink focus:border-accent focus:outline-none">
                                <option value="">Elige el producto de NÚCLEO…</option>
                                {products.map((p) => <option key={p.uid} value={p.uid}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</option>)}
                              </select>
                              {ed.items.length > 1 && <IconButton icon={Trash2} label="Quitar del combo" size={15} onClick={() => setEditing({ ...ed, items: ed.items.filter((_, j) => j !== i) })} />}
                            </div>
                          ))}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setEditing({ ...ed, items: [...ed.items, { product_uid: "", qty: "1" }] })}>Agregar otro producto (combo)</Button>
                            <span className="flex-1" />
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                            <Button size="sm" disabled={busy} onClick={() => confirm(r)}>Guardar</Button>
                          </div>
                          <p className="text-xs text-muted">La cantidad es por cada unidad vendida en la tienda: un pack «5 x …» lleva 5.</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
