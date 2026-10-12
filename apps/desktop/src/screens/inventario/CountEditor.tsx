// Realizar inventario: aparecen todos los productos de la bodega; se anota lo que hay y se actualiza
// el stock producto por producto o todo junto al final. Cada cambio queda en el kárdex y la auditoría.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Copy, Eraser, RefreshCw, Search } from "lucide-react";
import { useBackend, errorMessage, type Warehouse, type WarehouseStockRow } from "../../data";
import { formatDate, formatQty, parseQty, todayIso } from "../../lib/format";
import { goBack } from "../../lib/router";
import { Badge, Button, Card, Field, Notice, PageHeader, Select, Spinner, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

interface Row { stock: WarehouseStockRow; text: string; done: boolean }
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function CountEditor() {
  const backend = useBackend();
  const toast = useToast();
  const [whs, setWhs] = useState<Warehouse[] | null>(null);
  const [wh, setWh] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    backend.warehouses().then((w) => {
      const active = w.filter((x) => !x.archived);
      setWhs(active);
      setWh((active.find((x) => x.is_default) ?? active[0])?.uid ?? "");
    }).catch((e) => setErr(errorMessage(e)));
  }, [backend]);
  useEffect(() => {
    if (!wh) return;
    setRows(null);
    backend.warehouseStock(wh).then((r) => setRows(r.map((stock) => ({ stock, text: "", done: false })))).catch((e) => setErr(errorMessage(e)));
  }, [backend, wh]);

  const shown = useMemo(() => {
    const q = norm(query.trim());
    return (rows ?? []).filter((r) => !q || norm(`${r.stock.product.name} ${r.stock.product.sku} ${r.stock.product.category ?? ""}`).includes(q));
  }, [rows, query]);
  const counted = (r: Row) => (r.text.trim() ? parseQty(r.text) : null);
  const diffOf = (r: Row) => { const v = counted(r); return v === null ? null : v - r.stock.on_hand_milli; };
  const stats = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      counted: all.filter((r) => counted(r) !== null).length,
      changed: all.filter((r) => { const d = diffOf(r); return d !== null && d !== 0; }).length,
      invalid: all.filter((r) => r.text.trim() && parseQty(r.text) === null).length,
    };
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const motive = () => reason.trim() || `Inventario del ${formatDate(date)}`;
  const setText = (uid: string, text: string) => setRows((rs) => rs!.map((r) => (r.stock.product.uid === uid ? { ...r, text, done: false } : r)));

  /** Aplica los conteos; devuelve los productos actualizados. */
  async function apply(list: Row[]): Promise<boolean> {
    const lines = list.map((r) => ({ product_uid: r.stock.product.uid, qty_milli: counted(r)! }));
    const done = await backend.adjustStock({ warehouse_uid: wh, date, kind: "conteo", reason: motive(), lines });
    const map = new Map(lines.map((l) => [l.product_uid, l.qty_milli]));
    setRows((rs) => rs!.map((r) => map.has(r.stock.product.uid) ? { ...r, stock: { ...r.stock, on_hand_milli: map.get(r.stock.product.uid)! }, done: true } : r));
    toast("success", `${done.number}: ${done.moved_lines} ${done.moved_lines === 1 ? "producto actualizado" : "productos actualizados"}.`);
    return true;
  }
  async function updateOne(r: Row) {
    setErr(null); setBusy(r.stock.product.uid);
    try { await apply([r]); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  }
  async function updateAll() {
    setErr(null);
    if (stats.invalid) { setErr("Hay cantidades con letras o símbolos: escribe solo números (ej. 12 o 2,5)."); return; }
    const list = (rows ?? []).filter((r) => { const d = diffOf(r); return d !== null && d !== 0; });
    if (!list.length) {
      toast("success", stats.counted ? "Todo coincide con el sistema: no hubo nada que actualizar." : "Anota primero el inventario de al menos un producto.");
      return;
    }
    setBusy("todo");
    try { await apply(list); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  }
  function copyAll() {
    setRows((rs) => rs!.map((r) => (r.text.trim() ? r : { ...r, text: formatQty(Math.max(0, r.stock.on_hand_milli)), done: false })));
    toast("info", "Copiamos el stock del sistema en «Inventario». Cambia solo lo que no calce con lo que contaste.");
  }
  function focusNext(uid: string) {
    const i = shown.findIndex((r) => r.stock.product.uid === uid);
    const next = shown[i + 1];
    if (next) { const el = inputs.current.get(next.stock.product.uid); el?.focus(); el?.select(); }
  }

  if (!whs) return err ? <Notice tone="danger">{err}</Notice> : <Spinner />;
  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/inventario")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Inventario</button>}
        title="Realizar inventario"
        subtitle="Anota lo que hay en bodega. Lo que cambie queda en el kárdex y en la auditoría. Nada se borra."
      />
      <div className="flex flex-col gap-6">
        <Card>
          <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_10rem]">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">Tipo</span>
              <span className="inline-flex h-10 items-center"><Badge tone="accent" icon={ClipboardCheck}>Inventario actual</Badge></span>
            </div>
            <Select label="Bodega" value={wh} onChange={(e) => setWh(e.target.value)} options={whs.map((w) => ({ value: w.uid, label: w.name }))} />
            <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="mt-4">
            <TextArea label="Motivo" optional value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder={`Si lo dejas vacío: «Inventario del ${formatDate(date)}». Ej. conteo mensual, producto dañado, merma`} />
          </div>
        </Card>

        <Card title="Productos" subtitle={rows ? `${stats.counted} de ${stats.total} contados · ${stats.changed} con diferencias` : undefined} padded={false}
          actions={rows && rows.length > 0 && (
            <>
              <Button size="sm" variant="ghost" icon={Eraser} onClick={() => setRows((rs) => rs!.map((r) => ({ ...r, text: "", done: false })))}>Limpiar</Button>
              <Button size="sm" variant="secondary" icon={Copy} onClick={copyAll} title="Pone el stock del sistema en la columna Inventario para que solo corrijas lo distinto">Copiar stock actual</Button>
            </>
          )}>
          <div className="border-b border-line px-4 py-3">
            <Field aria-label="Buscar en el inventario" leading={<Search size={15} />} placeholder="Buscar por nombre, código o categoría" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" />
          </div>
          {!rows ? <div className="p-6"><Spinner /></div> : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted">No hay productos con stock en esta bodega. Crea productos en «Productos y servicios».</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Producto</th>
                  <th className="w-32 px-2 text-right">En bodega</th>
                  <th className="w-36 px-2 text-right">Inventario</th>
                  <th className="w-40 px-2 text-right">Stock actual</th>
                  <th className="w-52 px-4" />
                </tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const p = r.stock.product;
                    const v = counted(r);
                    const d = diffOf(r);
                    const bad = !!r.text.trim() && v === null;
                    return (
                      <tr key={p.uid} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">
                          <span className="font-medium text-ink">{p.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted">{p.sku}</span>
                        </td>
                        <td className="num px-2 text-right text-muted">{formatQty(r.stock.on_hand_milli)} {p.unit}</td>
                        <td className="px-2 py-1.5">
                          <input ref={(el) => { if (el) inputs.current.set(p.uid, el); else inputs.current.delete(p.uid); }}
                            aria-label={`Inventario de ${p.name}`} inputMode="decimal" value={r.text} placeholder="—"
                            onChange={(e) => setText(p.uid, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNext(p.uid); } }}
                            className={`num h-8 w-full rounded-md border bg-surface px-2 text-right focus:outline-none ${bad ? "border-danger" : "border-line focus:border-accent"}`} />
                        </td>
                        <td className="num px-2 text-right">
                          {v === null ? <span className="text-faint">—</span> : (
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-medium text-ink">{formatQty(v)} {p.unit}</span>
                              {d === 0 ? <span className="text-xs text-muted">coincide</span>
                                : <span className={`text-xs font-medium ${d! > 0 ? "text-success" : "text-danger"}`}>{d! > 0 ? "+" : "−"}{formatQty(Math.abs(d!))}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          {r.done && d === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 size={14} aria-hidden /> Actualizado</span>
                          ) : d === null || d === 0 ? (
                            <span className="text-xs text-faint">{d === 0 ? "Sin cambios" : "—"}</span>
                          ) : (
                            <Button size="sm" icon={RefreshCw} className="whitespace-nowrap" disabled={busy !== null} onClick={() => updateOne(r)}>
                              {busy === p.uid ? "Guardando…" : "Actualizar stock"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted">Sin coincidencias.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {err && <Notice tone="danger">{err}</Notice>}
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-4">
            <p className="text-sm text-muted">
              {stats.changed
                ? <>Se actualizarán <strong className="text-ink">{stats.changed}</strong> {stats.changed === 1 ? "producto" : "productos"} con diferencias.</>
                : "Anota el inventario o usa «Copiar stock actual» y corrige solo lo distinto."}
              {stats.total - stats.counted > 0 && stats.counted > 0 && ` ${stats.total - stats.counted} sin anotar no se modifican.`}
            </p>
            <Button icon={ClipboardCheck} onClick={updateAll} disabled={busy !== null}>{busy === "todo" ? "Actualizando…" : "Actualizar inventario completo"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
