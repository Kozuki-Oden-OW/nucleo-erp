// Editor de cotización, venta o factura interna. Pensado para digitar rápido con el teclado:
// buscar producto → Enter → ajustar cantidad → siguiente producto.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Info, Save, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type Customer, type LineInput, type Product, type QuoteDetail, type SaleDetail } from "../../data";
import { computeTotals, lineAmounts } from "../../data/calc";
import { addDays, formatMoney, formatPpm, parsePercent, parseQty, todayIso } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { goBack, navigate } from "../../lib/router";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Field, IconButton, Label, Notice, PageHeader, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { NewCustomerDrawer } from "../clientes/Customers";
import { CustomerPicker, ProductPicker, type ProductPickerHandle } from "./pickers";

type Kind = "COT" | "VEN" | "FV";
const TITLE: Record<Kind, string> = { COT: "Nueva cotización", VEN: "Nueva venta", FV: "Nueva factura interna" };

interface Row extends LineInput { key: number; qtyText: string; discText: string }
let rowSeq = 0;

function toRow(l: LineInput): Row {
  return { ...l, key: ++rowSeq, qtyText: String(l.qty_milli / 1000).replace(".", ","), discText: l.discount_ppm ? String(l.discount_ppm / 10_000).replace(".", ",") : "" };
}

export function DocEditor({ kind, existing, initialCustomerUid }: { kind: Kind; existing?: QuoteDetail | SaleDetail; initialCustomerUid?: string | null }) {
  const backend = useBackend();
  const toast = useToast();
  const t = useTerm();
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [prospect, setProspect] = useState("");
  const [date, setDate] = useState(existing?.issue_date ?? todayIso());
  const [validUntil, setValidUntil] = useState<string>((existing as QuoteDetail | undefined)?.valid_until ?? addDays(todayIso(), 15));
  const [rows, setRows] = useState<Row[]>(() => (existing?.lines ?? []).map(toRow));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [newCust, setNewCust] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<ProductPickerHandle>(null);
  const qtyRefs = useRef(new Map<number, HTMLInputElement>());
  // Después de agregar un producto, el foco pasa a su cantidad (cuando la fila ya está en pantalla).
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    const el = qtyRefs.current.get(focusRow);
    if (el) { el.focus(); el.select(); setFocusRow(null); }
  }, [focusRow, rows]);

  useEffect(() => { backend.business().then(setBiz).catch(() => setBiz(null)); }, [backend]);
  const preset = existing ? existing.customer_uid : initialCustomerUid;
  useEffect(() => {
    if (preset) backend.customer(preset).then((c) => setCustomer(c)).catch(() => {});
  }, [backend, preset]);

  const taxPpm = biz?.tax_enabled ? biz.tax_rate_ppm : null;
  const totals = useMemo(() => computeTotals(rows, taxPpm), [rows, taxPpm]);

  function addProduct(p: Product | null, text: string) {
    const row = toRow({ product_uid: p?.uid ?? null, description: p?.name ?? text, qty_milli: 1000, unit_price_minor: p?.price_minor ?? 0, discount_ppm: 0, taxable: p?.taxable ?? true });
    const existingRow = p ? rows.find((r) => r.product_uid === p.uid) : undefined;
    if (existingRow) {
      update(existingRow.key, { qty_milli: existingRow.qty_milli + 1000, qtyText: String((existingRow.qty_milli + 1000) / 1000).replace(".", ",") });
      setFocusRow(existingRow.key);
      return;
    }
    setRows((rs) => [...rs, row]);
    setFocusRow(row.key);
  }
  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function save() {
    setErr(null);
    const lines: LineInput[] = rows.map(({ product_uid, description, qty_milli, unit_price_minor, discount_ppm, taxable }) => ({ product_uid, description, qty_milli, unit_price_minor, discount_ppm, taxable }));
    setBusy(true);
    try {
      if (kind === "COT") {
        const q = await backend.saveQuote({ customer_uid: customer?.uid ?? null, prospect_name: prospect || undefined, issue_date: date, valid_until: validUntil, lines, notes: notes || undefined }, existing?.uid);
        toast("success", `${q.number} guardada.`);
        navigate(`/cotizaciones/${q.uid}`, { replace: true });
      } else {
        const s = await backend.saveSale({ doc_type: kind, customer_uid: customer?.uid ?? null, issue_date: date, lines, notes: notes || undefined }, existing?.uid);
        toast("success", `${s.number} guardada como borrador. Ahora puedes marcarla como efectuada.`);
        navigate(`/ventas/${s.uid}`, { replace: true });
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void save(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const title = existing ? `Editar ${existing.number}` : TITLE[kind];

  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/ventas")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Volver</button>}
        title={title}
        subtitle={kind === "FV" ? "Se imprime con el título FACTURA INTERNA y la leyenda “Documento interno — no tributario”." : kind === "COT" ? "No mueve stock ni dinero. Cuando el cliente acepte, conviértela en venta sin volver a digitar." : "Queda como borrador hasta que la marques como efectuada."}
        actions={<Button icon={Save} onClick={save} disabled={busy || rows.length === 0} kbd="Ctrl Enter">{kind === "COT" ? "Guardar cotización" : "Guardar y continuar"}</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem_10rem]">
              <div className="flex flex-col gap-1.5">
                <Label>Cliente</Label>
                <CustomerPicker
                  value={customer}
                  onChange={setCustomer}
                  allowWalkIn={kind !== "COT"}
                  prospect={kind === "COT" ? prospect : undefined}
                  onProspect={kind === "COT" ? setProspect : undefined}
                  onCreate={(name) => setNewCust(name)}
                />
                {kind !== "COT" && !customer && <span className="text-xs text-muted">Sin cliente = venta a cliente ocasional (solo al contado).</span>}
              </div>
              <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              {kind === "COT" ? (
                <Field label="Válida hasta" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              ) : <div />}
            </div>
          </Card>

          <Card title="Productos y servicios" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5">Descripción</th>
                    <th className="w-24 px-2 py-2.5 text-right">Cantidad</th>
                    <th className="w-36 px-2 py-2.5 text-right">Precio unitario</th>
                    <th className="w-20 px-2 py-2.5 text-right">Desc. %</th>
                    <th className="w-32 px-2 py-2.5 text-right">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const a = lineAmounts(r);
                    return (
                      <tr key={r.key} className="border-b border-line">
                        <td className="px-4 py-1.5">
                          <input
                            aria-label="Descripción"
                            value={r.description}
                            onChange={(e) => update(r.key, { description: e.target.value })}
                            className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-ink hover:border-line focus:border-accent focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            ref={(el) => { if (el) qtyRefs.current.set(r.key, el); else qtyRefs.current.delete(r.key); }}
                            aria-label="Cantidad"
                            inputMode="decimal"
                            value={r.qtyText}
                            onChange={(e) => { const v = parseQty(e.target.value); update(r.key, { qtyText: e.target.value, qty_milli: v ?? 0 }); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); picker.current?.focus(); } }}
                            className={`num h-8 w-full rounded-md border bg-surface px-2 text-right focus:border-accent focus:outline-none ${r.qty_milli > 0 ? "border-line" : "border-danger"}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <MoneyField aria-label="Precio unitario" value={r.unit_price_minor} onValue={(v) => update(r.key, { unit_price_minor: v ?? 0 })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            aria-label="Descuento en porcentaje"
                            inputMode="decimal"
                            placeholder="0"
                            value={r.discText}
                            onChange={(e) => { const v = parsePercent(e.target.value); update(r.key, { discText: e.target.value, discount_ppm: v ?? 0 }); }}
                            className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none"
                          />
                        </td>
                        <td className="num px-2 py-1.5 text-right font-medium text-ink">{formatMoney(a.net)}</td>
                        <td className="pr-2">
                          <IconButton icon={Trash2} label="Quitar línea" size={15} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4">
              <ProductPicker ref={picker} onPick={addProduct} />
              {rows.length === 0 && <p className="mt-2 text-xs text-muted">Consejo: escribe parte del nombre (“tala 18”) y presiona Enter. Luego escribe la cantidad y Enter de nuevo para el siguiente producto.</p>}
            </div>
          </Card>

          <Card>
            <TextArea label="Observaciones" optional value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condiciones, plazo de entrega, notas para el cliente…" />
          </Card>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          <Card title="Resumen">
            <dl className="flex flex-col gap-2 text-sm">
              {totals.discount_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Descuentos</dt><dd className="num text-ink">− {formatMoney(totals.discount_minor)}</dd></div>}
              {taxPpm !== null ? (
                <>
                  <div className="flex justify-between"><dt className="text-muted">{t("neto")}</dt><dd className="num text-ink">{formatMoney(totals.net_minor)}</dd></div>
                  {totals.exempt_minor > 0 && <div className="flex justify-between"><dt className="text-muted">{t("exento")}</dt><dd className="num text-ink">{formatMoney(totals.exempt_minor)}</dd></div>}
                  <div className="flex justify-between">
                    <dt className="inline-flex items-center gap-1 text-muted" title={biz?.tax_rule_source ?? undefined}>{t("impuesto")} ({formatPpm(taxPpm, 0)}) <Info size={13} aria-hidden /></dt>
                    <dd className="num text-ink">{formatMoney(totals.tax_minor)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="num text-ink">{formatMoney(totals.exempt_minor)}</dd></div>
              )}
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="num text-[22px] font-semibold text-ink">{formatMoney(totals.total_minor)}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-muted">DOCUMENTO INTERNO — NO TRIBUTARIO</p>
          </Card>
          {err && <Notice tone="danger">{err}</Notice>}
          <Button size="lg" icon={Save} onClick={save} disabled={busy || rows.length === 0}>{busy ? "Guardando…" : kind === "COT" ? "Guardar cotización" : "Guardar y continuar"}</Button>
        </aside>
      </div>
      <NewCustomerDrawer
        open={newCust !== null}
        initialName={newCust ?? ""}
        onClose={() => setNewCust(null)}
        onCreated={(c) => { setCustomer(c); setNewCust(null); }}
      />
    </div>
  );
}
