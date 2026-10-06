// Editor de orden de compra y de documento de compra del proveedor (factura, boleta…).
// Mismo flujo de teclado que las ventas: buscar producto → Enter → cantidad → siguiente.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, History, Save, Send, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type BuyLineInput, type Product, type PurchaseOrderDetail, type Supplier } from "../../data";
import { EXTERNAL_DOC_KINDS, PAYMENT_METHODS } from "../../data/catalogs";
import { computeTotals } from "../../data/calc";
import { addDays, formatDate, formatMoney, formatPpm, formatQty, parseQty, todayIso } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { goBack, navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Checkbox, Field, IconButton, Label, Notice, PageHeader, Select, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { ProductPicker, SupplierPicker, type ProductPickerHandle } from "../ventas/pickers";
import { SupplierFormDrawer } from "./common";

type Mode = "oc" | "doc";
interface Row extends BuyLineInput { key: number; qtyText: string; hint: string | null }
let seq = 0;
const toRow = (l: BuyLineInput, hint: string | null = null): Row => ({ ...l, key: ++seq, qtyText: String(l.qty_milli / 1000).replace(".", ","), hint });
const lineNet = (r: BuyLineInput) => Math.round((r.qty_milli * r.unit_cost_minor) / 1000);

export function BuyEditor({ mode, existing, supplierUid, orderUid }: { mode: Mode; existing?: PurchaseOrderDetail; supplierUid?: string | null; orderUid?: string | null }) {
  const backend = useBackend();
  const toast = useToast();
  const t = useTerm();
  const { can } = useSession();
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [date, setDate] = useState(existing?.issue_date ?? todayIso());
  const [expected, setExpected] = useState(existing?.expected_date ?? addDays(todayIso(), 7));
  const [docKind, setDocKind] = useState(EXTERNAL_DOC_KINDS[0]!);
  const [docNumber, setDocNumber] = useState("");
  const [due, setDue] = useState("");
  const [receive, setReceive] = useState(true);
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState(PAYMENT_METHODS[1]!);
  const [rows, setRows] = useState<Row[]>(() => (existing?.lines ?? []).map((l) => toRow(l)));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<ProductPickerHandle>(null);
  const qtyRefs = useRef(new Map<number, HTMLInputElement>());
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    const el = qtyRefs.current.get(focusRow);
    if (el) { el.focus(); el.select(); setFocusRow(null); }
  }, [focusRow, rows]);

  useEffect(() => { backend.business().then(setBiz).catch(() => setBiz(null)); }, [backend]);
  const presetSupplier = existing?.supplier_uid ?? supplierUid;
  useEffect(() => { if (presetSupplier) backend.supplier(presetSupplier).then(setSupplier).catch(() => {}); }, [backend, presetSupplier]);
  useEffect(() => {
    if (!orderUid) return;
    backend.purchaseOrder(orderUid).then((o) => {
      setOrder(o);
      backend.supplier(o.supplier_uid).then(setSupplier).catch(() => {});
      setRows(o.lines.map((l) => toRow({ product_uid: l.product_uid, description: l.description, qty_milli: l.received_milli > 0 ? l.received_milli : l.qty_milli, unit_cost_minor: l.unit_cost_minor, taxable: l.taxable })));
      setReceive(false);
    }).catch((e) => setErr(errorMessage(e)));
  }, [backend, orderUid]);

  const taxPpm = biz?.tax_enabled ? biz.tax_rate_ppm : null;
  const totals = useMemo(() => computeTotals(rows.map((r) => ({ product_uid: r.product_uid, description: r.description, qty_milli: r.qty_milli, unit_price_minor: r.unit_cost_minor, discount_ppm: 0, taxable: r.taxable })), taxPpm), [rows, taxPpm]);
  const autoDue = supplier ? addDays(date, supplier.payment_terms_days) : date;

  async function addProduct(p: Product | null, text: string) {
    const same = p ? rows.find((r) => r.product_uid === p.uid) : undefined;
    if (same) {
      update(same.key, { qty_milli: same.qty_milli + 1000, qtyText: String((same.qty_milli + 1000) / 1000).replace(".", ",") });
      setFocusRow(same.key);
      return;
    }
    const row = toRow({ product_uid: p?.uid ?? null, description: p?.name ?? text, qty_milli: 1000, unit_cost_minor: p ? Math.round(p.cost_e4 / 10_000) : 0, taxable: p?.taxable ?? true });
    setRows((rs) => [...rs, row]);
    setFocusRow(row.key);
    if (p && can("compras.ver")) {
      try {
        const h = await backend.priceHistory(p.uid);
        const mine = h.find((x) => x.supplier_uid === supplier?.uid) ?? h[0];
        if (mine) {
          update(row.key, {
            unit_cost_minor: mine.unit_price_minor,
            hint: `Último precio: ${formatMoney(mine.unit_price_minor)} · ${mine.supplier_name} · ${formatDate(mine.date)}${h.length > 1 ? ` (${h.length} registros)` : ""}`,
          });
        }
      } catch { /* el historial es una ayuda: si falla, se usa el costo promedio */ }
    }
  }
  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function save(issue: boolean) {
    setErr(null);
    if (!supplier) { setErr("Elige el proveedor."); return; }
    const lines: BuyLineInput[] = rows.map(({ product_uid, description, qty_milli, unit_cost_minor, taxable }) => ({ product_uid, description, qty_milli, unit_cost_minor, taxable }));
    setBusy(true);
    try {
      if (mode === "oc") {
        let o = await backend.savePurchaseOrder({ supplier_uid: supplier.uid, issue_date: date, expected_date: expected || null, lines, notes: notes || undefined }, existing?.uid);
        if (issue) o = await backend.issuePurchaseOrder(o.uid);
        toast("success", issue ? `${o.number} emitida.` : `${o.number} guardada como borrador.`);
        navigate(`/compras/oc/${o.uid}`, { replace: true });
      } else {
        const c = await backend.registerPurchase({
          supplier_uid: supplier.uid, doc_kind: docKind, doc_number: docNumber || undefined, issue_date: date, due_date: due || null,
          order_uid: order?.uid ?? null, receive_stock: !order && receive, lines, notes: notes || undefined, paid_method: paid ? method : null,
        });
        toast("success", `${c.number} registrado.${c.received_stock ? " La mercadería ya está en bodega." : ""}`);
        navigate(`/compras/doc/${c.uid}`, { replace: true });
      }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void save(false); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const title = mode === "oc" ? (existing ? `Editar ${existing.number}` : "Nueva orden de compra") : "Registrar documento de compra";
  const subtitle = mode === "oc"
    ? "Lo que le pides al proveedor. No mueve stock ni dinero hasta que recibas la mercadería."
    : "La factura o boleta que te entregó el proveedor. Queda en “Dinero que debes” hasta que la pagues.";

  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/compras")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Volver</button>}
        title={title}
        subtitle={subtitle}
        actions={mode === "oc"
          ? <><Button variant="secondary" icon={Save} onClick={() => save(false)} disabled={busy || rows.length === 0} kbd="Ctrl Enter">Guardar borrador</Button><Button icon={Send} onClick={() => save(true)} disabled={busy || rows.length === 0}>Guardar y emitir</Button></>
          : <Button icon={Save} onClick={() => save(false)} disabled={busy || rows.length === 0} kbd="Ctrl Enter">Registrar documento</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem_10rem]">
              <div className="flex flex-col gap-1.5">
                <Label>Proveedor</Label>
                {order ? (
                  <div className="flex h-ctl items-center rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink">{order.supplier_name}</div>
                ) : (
                  <SupplierPicker value={supplier} onChange={setSupplier} onCreate={(name) => setNewSupplier(name)} />
                )}
              </div>
              <Field label={mode === "oc" ? "Fecha de la orden" : "Fecha del documento"} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              {mode === "oc"
                ? <Field label="Llegada estimada" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
                : <Field label="Vence" type="date" value={due || autoDue} onChange={(e) => setDue(e.target.value)} hint={supplier?.payment_terms_days ? `Plazo del proveedor: ${supplier.payment_terms_days} días` : undefined} />}
            </div>
            {mode === "doc" && (
              <div className="mt-4 grid gap-4 md:grid-cols-[12rem_12rem_minmax(0,1fr)]">
                <Select label="Tipo de documento" value={docKind} onChange={(e) => setDocKind(e.target.value)} options={EXTERNAL_DOC_KINDS.map((k) => ({ value: k, label: k }))} />
                <Field label="Número" optional value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="Ej. 8841" />
                {order && <div className="flex flex-col justify-end text-sm text-muted">Asociado a la orden <span className="font-mono text-ink">{order.number}</span>. Se copiaron las cantidades recibidas.</div>}
              </div>
            )}
          </Card>

          <Card title="Productos y servicios" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5">Descripción</th>
                    <th className="w-24 px-2 py-2.5 text-right">Cantidad</th>
                    <th className="w-36 px-2 py-2.5 text-right">Costo unitario</th>
                    <th className="w-16 px-2 py-2.5 text-center">IVA</th>
                    <th className="w-32 px-2 py-2.5 text-right">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-line align-top">
                      <td className="px-4 py-1.5">
                        <input aria-label="Descripción" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })}
                          className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-ink hover:border-line focus:border-accent focus:outline-none" />
                        {r.hint && <div className="flex items-center gap-1 px-2 pb-1 text-[11.5px] text-muted"><History size={12} aria-hidden /> {r.hint}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <input ref={(el) => { if (el) qtyRefs.current.set(r.key, el); else qtyRefs.current.delete(r.key); }} aria-label="Cantidad" inputMode="decimal" value={r.qtyText}
                          onChange={(e) => { const v = parseQty(e.target.value); update(r.key, { qtyText: e.target.value, qty_milli: v ?? 0 }); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); picker.current?.focus(); } }}
                          className={`num h-8 w-full rounded-md border bg-surface px-2 text-right focus:border-accent focus:outline-none ${r.qty_milli > 0 ? "border-line" : "border-danger"}`} />
                      </td>
                      <td className="px-2 py-1.5"><MoneyField aria-label="Costo unitario" value={r.unit_cost_minor} onValue={(v) => update(r.key, { unit_cost_minor: v ?? 0 })} /></td>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Afecto a IVA" checked={r.taxable} onChange={(e) => update(r.key, { taxable: e.target.checked })} className="mt-2 h-4 w-4 accent-[var(--accent)]" /></td>
                      <td className="num px-2 py-1.5 pt-3 text-right font-medium text-ink">{formatMoney(lineNet(r))}</td>
                      <td className="pr-2 pt-0.5"><IconButton icon={Trash2} label="Quitar línea" size={15} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4">
              <ProductPicker ref={picker} onPick={(p, text) => void addProduct(p, text)} />
              {rows.length === 0 && <p className="mt-2 text-xs text-muted">Escribe parte del nombre y presiona Enter. El costo se sugiere con el último precio que pagaste.</p>}
            </div>
          </Card>

          <Card><TextArea label="Observaciones" optional value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={mode === "oc" ? "Condiciones, lugar de entrega, contacto…" : "Notas internas sobre esta compra"} /></Card>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          <Card title="Resumen">
            <dl className="flex flex-col gap-2 text-sm">
              {taxPpm !== null ? (
                <>
                  <div className="flex justify-between"><dt className="text-muted">{t("neto")}</dt><dd className="num text-ink">{formatMoney(totals.net_minor)}</dd></div>
                  {totals.exempt_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{t("exento")}</dt><dd className="num text-ink">{formatMoney(totals.exempt_minor)}</dd></div>}
                  <div className="flex justify-between"><dt className="text-muted">IVA crédito ({formatPpm(taxPpm, 0)})</dt><dd className="num text-ink">{formatMoney(totals.tax_minor)}</dd></div>
                </>
              ) : <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="num text-ink">{formatMoney(totals.exempt_minor)}</dd></div>}
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="num text-[22px] font-semibold text-ink">{formatMoney(totals.total_minor)}</dd>
              </div>
            </dl>
            {rows.length > 0 && <p className="mt-3 text-xs text-muted">{rows.length} líneas · {formatQty(rows.reduce((a, r) => a + r.qty_milli, 0))} unidades</p>}
          </Card>
          {mode === "doc" && (
            <Card>
              <div className="flex flex-col gap-4">
                {!order && can("compras.recibir") && (
                  <Checkbox label="Ingresar la mercadería a bodega" hint="Suma el stock y actualiza el costo promedio. Desmárcalo si la recibiste con una orden de compra." checked={receive} onChange={setReceive} />
                )}
                {can("dinero.registrar") && <Checkbox label="Ya lo pagué" hint="Registra el pago completo con este documento." checked={paid} onChange={setPaid} />}
                {paid && <Select label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />}
              </div>
            </Card>
          )}
          {err && <Notice tone="danger">{err}</Notice>}
          {mode === "oc"
            ? <Button size="lg" icon={Send} onClick={() => save(true)} disabled={busy || rows.length === 0}>{busy ? "Guardando…" : "Guardar y emitir"}</Button>
            : <Button size="lg" icon={Save} onClick={() => save(false)} disabled={busy || rows.length === 0}>{busy ? "Registrando…" : "Registrar documento"}</Button>}
        </aside>
      </div>
      <SupplierFormDrawer open={newSupplier !== null} initialName={newSupplier ?? ""} onClose={() => setNewSupplier(null)} onSaved={(s) => { setSupplier(s); setNewSupplier(null); }} />
    </div>
  );
}
