// Números de serie y certificados de calibración: cada equipo con su serie, a quién se le vendió y
// cuándo vence su calibración.
import { useCallback, useEffect, useState } from "react";
import { Barcode, Pencil, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { useBackend, errorMessage, type Product, type SaleDetail, type Serial, type SerialFilter, type SerialInput, type SerialStatus } from "../../data";
import { formatDate } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { ProductPicker } from "../ventas/pickers";
import { Badge, Button, Card, EmptyState, Field, IconButton, Notice, Select, Spinner, TextArea, cx, type Tone } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";

const STATUS: Record<SerialStatus, [Tone, string]> = { en_stock: ["success", "En stock"], vendido: ["accent", "Vendido"], baja: ["neutral", "De baja"] };

export function dueText(s: Serial): { text: string; tone: Tone } | null {
  if (s.due_in_days === null || !s.certificate_due) return null;
  const d = s.due_in_days;
  if (d < 0) return { text: `Calibración vencida el ${formatDate(s.certificate_due)}`, tone: "danger" };
  if (d <= 30) return { text: `Calibración vence el ${formatDate(s.certificate_due)} (${d === 0 ? "hoy" : `en ${d} d`})`, tone: "warning" };
  return { text: `Calibración vigente hasta el ${formatDate(s.certificate_due)}`, tone: "neutral" };
}

export function SerialsTab({ route }: { route: Route }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const write = can("productos.editar");
  const due = route.query.get("vence");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SerialStatus | "">("");
  const [rows, setRows] = useState<Serial[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Serial | "nueva" | null>(null);
  const [bulk, setBulk] = useState(false);
  const load = useCallback(() => {
    const f: SerialFilter = { query: query || null, status: status || null, due_within_days: due ? Number(due) : null };
    backend.serials(f).then(setRows).catch((e) => setErr(errorMessage(e)));
  }, [backend, query, status, due]);
  useEffect(() => { const t = setTimeout(load, 120); return () => clearTimeout(t); }, [load]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  const setDue = (d: string) => navigate(d ? `/inventario?tab=series&vence=${d}` : "/inventario?tab=series", { replace: true });
  async function remove(s: Serial) {
    try { await backend.deleteSerial(s.uid); toast("success", `Serie ${s.serial} eliminada.`); load(); } catch (e) { toast("danger", errorMessage(e)); }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field aria-label="Buscar series" leading={<Search size={15} />} placeholder="Serie, producto, cliente o N° de certificado" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-sm" />
        <Select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as SerialStatus | "")} className="w-48"
          options={[{ value: "", label: "Todos los estados" }, { value: "en_stock", label: "En stock" }, { value: "vendido", label: "Vendidos" }, { value: "baja", label: "De baja" }]} />
        <Select aria-label="Calibración" value={due ?? ""} onChange={(e) => setDue(e.target.value)} className="w-56"
          options={[{ value: "", label: "Cualquier calibración" }, { value: "0", label: "Calibración vencida" }, { value: "30", label: "Vence en 30 días" }, { value: "60", label: "Vence en 60 días" }, { value: "90", label: "Vence en 90 días" }]} />
        {write && <div className="ml-auto flex gap-2"><Button variant="secondary" onClick={() => setBulk(true)}>Ingresar varias</Button><Button icon={Plus} onClick={() => setEditing("nueva")}>Nueva serie</Button></div>}
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon={Barcode} title={query || status || due ? "Ninguna serie con ese filtro" : "Aún no registras series"} action={write && !query && !status && !due && <Button icon={Plus} onClick={() => setEditing("nueva")}>Registrar la primera</Button>}>
          Anota la serie de cada equipo y su certificado de calibración. Al venderlo queda unido al cliente, y NÚCLEO te avisa cuando la calibración está por vencer.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
          {rows.map((s) => {
            const d = dueText(s);
            return (
              <li key={s.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13.5px] font-semibold text-ink">{s.serial}</span>
                    <button className="text-sm text-ink hover:text-accent" onClick={() => navigate(`/productos/${s.product_uid}`)}>{s.product_name}</button>
                    <Badge tone={STATUS[s.status][0]}>{STATUS[s.status][1]}</Badge>
                    {d && d.tone !== "neutral" && <Badge tone={d.tone}>{d.text}</Badge>}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {s.sale_uid && <><button className="text-accent hover:underline" onClick={() => navigate(`/ventas/${s.sale_uid}`)}>{s.sale_number}</button> · {s.customer_name ?? "cliente ocasional"} · {formatDate(s.sold_at)}{" · "}</>}
                    {s.certificate_number ? `Certificado ${s.certificate_number}${s.certificate_lab ? ` (${s.certificate_lab})` : ""}` : "Sin certificado anotado"}
                    {d && d.tone === "neutral" && ` · ${d.text}`}
                  </div>
                </div>
                {write && <><IconButton icon={Pencil} label={`Editar la serie ${s.serial}`} size={15} onClick={() => setEditing(s)} />{s.status !== "vendido" && <IconButton icon={Trash2} label={`Eliminar la serie ${s.serial}`} size={15} onClick={() => void remove(s)} />}</>}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <SerialDrawer editing={editing === "nueva" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {bulk && <BulkDialog onClose={() => setBulk(false)} onDone={() => { setBulk(false); load(); }} />}
    </div>
  );
}

function ProductChoice({ product, onChange }: { product: Pick<Product, "uid" | "name"> | null; onChange: (p: Pick<Product, "uid" | "name"> | null) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-ink">Producto</span>
      {product
        ? <div className="flex h-ctl items-center justify-between rounded-lg border border-line-strong bg-surface px-3 text-sm"><span className="truncate font-medium text-ink">{product.name}</span><button className="text-muted hover:text-ink" onClick={() => onChange(null)}>Cambiar</button></div>
        : <ProductPicker onPick={(p) => p && onChange(p)} />}
    </div>
  );
}

function SerialDrawer({ editing, onClose, onSaved }: { editing: Serial | null; onClose: () => void; onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [product, setProduct] = useState<Pick<Product, "uid" | "name"> | null>(editing ? { uid: editing.product_uid, name: editing.product_name } : null);
  const [f, setF] = useState<Omit<SerialInput, "product_uid">>(editing
    ? { serial: editing.serial, certificate_number: editing.certificate_number, certificate_date: editing.certificate_date, certificate_due: editing.certificate_due, certificate_lab: editing.certificate_lab, certificate_file: editing.certificate_file, notes: editing.notes, status: editing.status === "vendido" ? null : editing.status }
    : { serial: "", certificate_number: "", certificate_date: null, certificate_due: null, certificate_lab: "", certificate_file: "", notes: "", status: "en_stock" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!product) { setErr("Elige el producto de esa serie."); return; }
    setBusy(true); setErr(null);
    try { await backend.saveSerial({ ...f, product_uid: product.uid }, editing?.uid ?? null); toast("success", "Serie guardada."); onSaved(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  // Un año después de la fecha del certificado, si la próxima calibración está vacía.
  const suggestDue = (date: string | null) => { if (!date || f.certificate_due) return f.certificate_due ?? null; const d = new Date(`${date}T12:00:00`); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
  return (
    <Drawer open onClose={onClose} title={editing ? `Serie ${editing.serial}` : "Nueva serie"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy || !f.serial.trim()}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <ProductChoice product={product} onChange={setProduct} />
        <Field label="Número de serie" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} placeholder="Como viene en el equipo" data-autofocus />
        {editing?.status === "vendido"
          ? <Notice tone="info">Vendida en {editing.sale_number} a {editing.customer_name ?? "cliente ocasional"}. Para devolverla al stock, quítala desde la venta.</Notice>
          : <Select label="Estado" value={f.status ?? "en_stock"} onChange={(e) => setF({ ...f, status: e.target.value as "en_stock" | "baja" })} options={[{ value: "en_stock", label: "En stock" }, { value: "baja", label: "De baja (dañado, perdido…)" }]} />}
        <section className="rounded-lg border border-line p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Certificado de calibración</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="N° de certificado" optional value={f.certificate_number ?? ""} onChange={(e) => setF({ ...f, certificate_number: e.target.value })} />
            <Field label="Laboratorio" optional value={f.certificate_lab ?? ""} onChange={(e) => setF({ ...f, certificate_lab: e.target.value })} />
            <Field label="Fecha del certificado" optional type="date" value={f.certificate_date ?? ""} onChange={(e) => setF({ ...f, certificate_date: e.target.value || null, certificate_due: suggestDue(e.target.value || null) })} />
            <Field label="Próxima calibración" optional type="date" value={f.certificate_due ?? ""} onChange={(e) => setF({ ...f, certificate_due: e.target.value || null })} hint="NÚCLEO avisa 30 días antes." />
          </div>
          <div className="mt-4"><Field label="Dónde está el PDF" optional value={f.certificate_file ?? ""} onChange={(e) => setF({ ...f, certificate_file: e.target.value })} placeholder="D:\Certificados\CAL-2026-0456.pdf" hint="La ruta del archivo en este computador, para encontrarlo rápido." /></div>
        </section>
        <TextArea label="Notas" optional rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}

function BulkDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [product, setProduct] = useState<Pick<Product, "uid" | "name"> | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  async function save() {
    if (!product) return;
    setBusy(true);
    try {
      const r = await backend.addSerials(product.uid, list);
      toast(r.duplicates.length ? "warning" : "success", `${r.added} ${r.added === 1 ? "serie registrada" : "series registradas"}${r.duplicates.length ? `; ${r.duplicates.length} ya estaban (${r.duplicates.slice(0, 3).join(", ")}${r.duplicates.length > 3 ? "…" : ""})` : "."}`);
      onDone();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Ingresar varias series"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy || !product || list.length === 0}>{busy ? "Guardando…" : `Registrar ${list.length || ""}`}</Button></>}>
      <div className="flex flex-col gap-4">
        <ProductChoice product={product} onChange={setProduct} />
        <TextArea label="Series" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Una por línea (o pega la columna de una planilla)\nEF-724A-0011\nEF-724A-0012"} hint="Con un lector de código de barras, cada lectura queda en una línea." />
      </div>
    </Dialog>
  );
}

/** En la venta: las series entregadas y cuáles faltan por anotar. */
export function SaleSerialsCard({ sale }: { sale: SaleDetail }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const write = can("ventas.crear");
  const [rows, setRows] = useState<Serial[]>([]);
  const [any, setAny] = useState(false);
  const [picking, setPicking] = useState(false);
  const [stock, setStock] = useState<Serial[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const products = [...new Set(sale.lines.map((l) => l.product_uid).filter((u): u is string => !!u))];
  const load = useCallback(() => {
    backend.serials({ sale_uid: sale.uid }).then(setRows).catch(() => {});
    // La tarjeta solo aparece si la venta ya tiene series o si hay series en stock de sus productos.
    Promise.all(products.map((p) => backend.serials({ product_uid: p, status: "en_stock", limit: 200 }))).then((r) => { const all = r.flat(); setStock(all); setAny(all.length > 0); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, sale.uid]);
  useEffect(load, [load]);
  if (sale.commercial_state === "anulada" || (!rows.length && !any)) return null;
  async function assign() {
    try { setRows(await backend.assignSerials(sale.uid, chosen)); toast("success", "Series anotadas en la venta."); setPicking(false); setChosen([]); load(); }
    catch (e) { toast("danger", errorMessage(e)); }
  }
  async function release(s: Serial) {
    try { await backend.releaseSerial(s.uid); toast("success", `La serie ${s.serial} volvió al stock.`); load(); } catch (e) { toast("danger", errorMessage(e)); }
  }
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Barcode size={17} aria-hidden />Series entregadas</span>}
      actions={write && stock.length > 0 && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setPicking(true)}>Anotar series</Button>}>
      {rows.length === 0 ? <p className="text-sm text-muted">Aún no anotas qué equipos (por serie) se entregaron en esta venta.</p> : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rows.map((s) => {
            const d = dueText(s);
            return (
              <li key={s.uid} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-mono text-[13px] font-semibold text-ink">{s.serial}</span>
                <span className="text-muted">{s.product_name}</span>
                {s.certificate_number && <span className="text-muted">· certificado {s.certificate_number}</span>}
                {d && <Badge tone={d.tone}>{d.text}</Badge>}
                {write && <span className="ml-auto"><IconButton icon={Undo2} label={`Quitar la serie ${s.serial} de la venta`} size={15} onClick={() => void release(s)} /></span>}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={picking} onClose={() => setPicking(false)} title="Qué series se entregaron"
        footer={<><Button variant="ghost" onClick={() => setPicking(false)}>Cancelar</Button><Button onClick={assign} disabled={!chosen.length}>Anotar {chosen.length || ""}</Button></>}>
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {stock.map((s) => {
            const on = chosen.includes(s.uid);
            return (
              <li key={s.uid}>
                <button role="checkbox" aria-checked={on} onClick={() => setChosen(on ? chosen.filter((u) => u !== s.uid) : [...chosen, s.uid])}
                  className={cx("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm", on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}>
                  <span className="font-mono text-[13px] font-semibold text-ink">{s.serial}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{s.product_name}{s.certificate_number ? ` · certificado ${s.certificate_number}` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
    </Card>
  );
}
