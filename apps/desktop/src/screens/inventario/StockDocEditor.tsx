// Ajuste o conteo de inventario y transferencia entre bodegas. Buscar producto → Enter → cantidad.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowLeftRight, ClipboardCheck, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type Product, type Warehouse } from "../../data";
import { formatQty, parseQty, todayIso } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { Button, Card, Field, IconButton, Notice, PageHeader, Segmented, Select, Spinner, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { ProductPicker, type ProductPickerHandle } from "../ventas/pickers";

interface Row { key: number; product: Product; text: string; current: number | null }
let seq = 0;

export function StockDocEditor({ mode }: { mode: "ajuste" | "transferencia" }) {
  const backend = useBackend();
  const toast = useToast();
  const [whs, setWhs] = useState<Warehouse[] | null>(null);
  const [kind, setKind] = useState<"conteo" | "ajuste">("conteo");
  const [wh, setWh] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<ProductPickerHandle>(null);
  const qtyRefs = useRef(new Map<number, HTMLInputElement>());
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => { if (focusRow === null) return; const el = qtyRefs.current.get(focusRow); if (el) { el.focus(); el.select(); setFocusRow(null); } }, [focusRow, rows]);
  useEffect(() => {
    backend.warehouses().then((w) => {
      const active = w.filter((x) => !x.archived);
      setWhs(active);
      const def = active.find((x) => x.is_default) ?? active[0];
      setWh(def?.uid ?? "");
      setTo(active.find((x) => x.uid !== def?.uid)?.uid ?? "");
    }).catch((e) => setErr(errorMessage(e)));
  }, [backend]);

  // Stock actual de cada producto en la bodega elegida (para mostrar la diferencia del conteo).
  useEffect(() => {
    if (!wh) return;
    let alive = true;
    Promise.all(rows.map((r) => backend.productInventory(r.product.uid).then((d) => d.by_warehouse.find((b) => b.warehouse_uid === wh)?.on_hand_milli ?? 0).catch(() => null)))
      .then((cur) => alive && setRows((rs) => rs.map((r, i) => ({ ...r, current: cur[i] ?? r.current }))));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, wh, rows.length]);

  function add(p: Product | null) {
    if (!p) { toast("info", "Elige un producto de la lista: los ajustes solo aplican a productos con stock."); return; }
    if (p.kind !== "producto") { toast("info", `${p.name} es un servicio: no lleva stock.`); return; }
    const same = rows.find((r) => r.product.uid === p.uid);
    if (same) { setFocusRow(same.key); return; }
    const row: Row = { key: ++seq, product: p, text: mode === "transferencia" ? "1" : "", current: null };
    setRows((rs) => [...rs, row]);
    setFocusRow(row.key);
  }

  async function save() {
    setErr(null);
    const lines = rows.map((r) => {
      const t = r.text.trim();
      const neg = mode === "ajuste" && kind === "ajuste" && t.startsWith("-");
      const v = parseQty(t.replace(/^[-+]/, ""));
      return { product_uid: r.product.uid, qty_milli: v === null ? NaN : neg ? -v : v };
    });
    if (lines.some((l) => Number.isNaN(l.qty_milli))) { setErr("Revisa las cantidades: escribe solo números."); return; }
    setBusy(true);
    try {
      const done = mode === "transferencia"
        ? await backend.transferStock({ from_uid: wh, to_uid: to, date, notes: reason || undefined, lines })
        : await backend.adjustStock({ warehouse_uid: wh, date, kind, reason, lines });
      toast("success", `${done.number} registrado: ${done.moved_lines} ${done.moved_lines === 1 ? "producto actualizado" : "productos actualizados"}.`);
      navigate("/inventario?tab=movimientos", { replace: true });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!whs) return err ? <Notice tone="danger">{err}</Notice> : <Spinner />;
  const transfer = mode === "transferencia";
  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/inventario")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Inventario</button>}
        title={transfer ? "Transferir entre bodegas" : "Ajuste o conteo de inventario"}
        subtitle={transfer ? "Mueve stock de una bodega a otra al costo promedio de origen." : "Corrige el stock con un motivo: queda en el kárdex y en la auditoría. Nada se borra."}
        actions={<Button icon={transfer ? ArrowLeftRight : ClipboardCheck} onClick={save} disabled={busy || rows.length === 0 || (!transfer && !reason.trim())}>{busy ? "Guardando…" : transfer ? "Transferir" : "Registrar ajuste"}</Button>}
      />
      {transfer && whs.length < 2 && <div className="mb-4"><Notice tone="info" title="Necesitas al menos dos bodegas">Créalas en Inventario → Bodegas.</Notice></div>}
      <div className="flex flex-col gap-6">
        <Card>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
            {transfer ? (
              <>
                <Select label="Desde" value={wh} onChange={(e) => setWh(e.target.value)} options={whs.map((w) => ({ value: w.uid, label: w.name }))} />
                <Select label="Hacia" value={to} onChange={(e) => setTo(e.target.value)} options={whs.filter((w) => w.uid !== wh).map((w) => ({ value: w.uid, label: w.name }))} />
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink">Tipo</span>
                  <Segmented label="Tipo de ajuste" value={kind} onChange={setKind} options={[{ value: "conteo", label: "Conteo (lo que hay)" }, { value: "ajuste", label: "Diferencia (+/−)" }]} />
                </div>
                <Select label="Bodega" value={wh} onChange={(e) => setWh(e.target.value)} options={whs.map((w) => ({ value: w.uid, label: w.name }))} />
              </>
            )}
            <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="mt-4">
            <TextArea label={transfer ? "Notas" : "Motivo"} optional={transfer} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={transfer ? "Ej. reposición de la sala de ventas" : "Ej. conteo mensual, producto dañado, merma, error de digitación"} rows={2} />
          </div>
        </Card>
        <Card title="Productos" padded={false}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Producto</th><th className="w-32 px-2 text-right">En bodega</th>
              <th className="w-36 px-2 text-right">{transfer ? "Cantidad a mover" : kind === "conteo" ? "Cantidad contada" : "Diferencia (+/−)"}</th>
              {!transfer && kind === "conteo" && <th className="w-28 px-2 text-right">Ajuste</th>}<th className="w-10" />
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const v = parseQty(r.text.replace(/^[-+]/, ""));
                const diff = kind === "conteo" && v !== null && r.current !== null ? v - r.current : null;
                return (
                  <tr key={r.key} className="border-b border-line">
                    <td className="px-4 py-2 text-ink">{r.product.name}<span className="ml-2 font-mono text-xs text-muted">{r.product.sku}</span></td>
                    <td className="num px-2 text-right text-muted">{r.current === null ? "…" : `${formatQty(r.current)} ${r.product.unit}`}</td>
                    <td className="px-2 py-1.5"><input ref={(el) => { if (el) qtyRefs.current.set(r.key, el); else qtyRefs.current.delete(r.key); }} aria-label={`Cantidad de ${r.product.name}`} inputMode="decimal" value={r.text}
                      onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); picker.current?.focus(); } }}
                      className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                    {!transfer && kind === "conteo" && <td className={`num px-2 text-right font-medium ${diff === null || diff === 0 ? "text-muted" : diff > 0 ? "text-success" : "text-danger"}`}>{diff === null ? "—" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatQty(Math.abs(diff))}`}</td>}
                    <td className="pr-2"><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="p-4"><ProductPicker ref={picker} onPick={(p) => add(p)} /></div>
        </Card>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </div>
  );
}
