// Editor de cotización, venta o factura interna. Pensado para digitar rápido con el teclado:
// buscar producto → Enter → ajustar cantidad → siguiente producto.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BadgePercent, CheckCircle2, Info, Save, Trash2 } from "lucide-react";
import { applyPromotions } from "../../data/promos";
import { useBackend, errorMessage, type BusinessSettings, type Customer, type LineInput, type Product, type Promotion, type QuoteDetail, type Receiver, type SaleDetail, type SaleTerms } from "../../data";
import { EMPTY_TERMS, receiverFromCustomer } from "../../data/saleTerms";
import { PaymentCard, ReceiverCard, ReferencesCard } from "./terms";
import { computeTotals, lineAmounts } from "../../data/calc";
import { addDays, formatMoney, formatPpm, parsePercent, parseQty, todayIso } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { goBack, navigate } from "../../lib/router";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Field, IconButton, Label, Notice, PageHeader, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { NewCustomerDrawer } from "../clientes/Customers";
import { useCreditWarning } from "../clientes/credit";
import { formatRut } from "../../lib/format";
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
  const [terms, setTerms] = useState<SaleTerms>(() => ({ ...EMPTY_TERMS, ...((existing as SaleDetail | undefined)?.terms ?? {}) }));
  const [saveToCustomer, setSaveToCustomer] = useState(false);
  const isSale = kind !== "COT";
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
  // Al elegir otro cliente, el receptor se completa desde su ficha y se propone su plazo habitual.
  const lastCustomer = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const u = customer?.uid ?? null;
    if (lastCustomer.current === u) return;
    // El cliente de un documento guardado todavía se está cargando.
    if (lastCustomer.current === undefined && existing?.customer_uid && !customer) return;
    const prev = lastCustomer.current;
    lastCustomer.current = u;
    // Al abrir un documento guardado se respetan sus condiciones; solo se completa el receptor si falta.
    const restoring = !!existing && prev === undefined && u === (existing.customer_uid ?? null);
    const rec = customer ? { ...receiverFromCustomer(customer), rut: customer.rut ? formatRut(customer.rut) : null } : null;
    if (!restoring) setSaveToCustomer(false);
    setTerms((t) => {
      if (restoring) return t.receiver || !rec ? t : { ...t, receiver: rec };
      return {
        ...t,
        receiver: rec,
        ...(customer && customer.credit_enabled && customer.payment_terms_days > 0 && !t.payment ? { payment: "credito" as const, credit_days: customer.payment_terms_days, due_date: null } : {}),
        ...(!customer && t.payment === "credito" ? { payment: "" as const } : {}),
      };
    });
  }, [customer, existing]);
  const receiverChanged = useMemo(() => {
    if (!customer || !terms.receiver) return false;
    const base = { ...receiverFromCustomer(customer), rut: customer.rut ? formatRut(customer.rut) : null } as Receiver;
    return (Object.keys(base) as (keyof Receiver)[]).some((k) => (base[k] ?? "") !== (terms.receiver![k] ?? ""));
  }, [customer, terms.receiver]);

  const taxPpm = biz?.tax_enabled ? biz.tax_rate_ppm : null;
  // Promociones vigentes que calzan con la venta (no aplica a cotizaciones de interesados sin cliente).
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  useEffect(() => { if (backend.features.has("promociones")) backend.promotions().then(setPromos).catch(() => setPromos([])); }, [backend]);
  const promo = useMemo(() => applyPromotions(promos, rows, customer ? { uid: customer.uid, preferred: customer.preferred } : null), [promos, rows, customer]);
  const promoApplied = promo.lines.every((l, i) => !l || rows[i]!.discount_ppm === l.discount_ppm);
  const belowCost = rows.filter((r, i) => {
    const l = promo.lines[i]; const c = r.product_uid ? costs[r.product_uid] : undefined;
    return l && c && r.unit_price_minor * (1 - l.discount_ppm / 1_000_000) * 10_000 < c;
  }).map((r) => r.description);
  function applyPromos() {
    setRows((rs) => rs.map((r, i) => { const l = promo.lines[i]; return l ? { ...r, discount_ppm: l.discount_ppm, discText: String(Math.round(l.discount_ppm / 100) / 100).replace(".", ",") } : r; }));
    // El % exacto (p. ej. 5,0003 %) cuadra el ahorro al peso; en pantalla basta con dos decimales.
    toast("success", `Promociones aplicadas: ahorro ${formatMoney(promo.total_saving_minor)} sin IVA.`);
  }
  const totals = useMemo(() => computeTotals(rows, taxPpm), [rows, taxPpm]);
  const creditWarn = useCreditWarning(customer?.uid, totals.total_minor, isSale && terms.payment === "credito");

  function addProduct(p: Product | null, text: string) {
    if (p) setCosts((c) => ({ ...c, [p.uid]: p.cost_e4 }));
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
        if (saveToCustomer && customer && terms.receiver) {
          const r = terms.receiver;
          await backend.updateCustomer(customer.uid, {
            ...customer, name: r.name || customer.name, rut: r.rut || undefined, email: customer.email ?? undefined, phone: r.phone || customer.phone || undefined,
            business_activity: r.activity, address: r.address, commune: r.commune, city: r.city, region: r.region, contact_name: r.contact,
            invoice_email: r.email && r.email !== customer.email ? r.email : customer.invoice_email, trade_name: customer.trade_name,
          });
        }
        const s = await backend.saveSale({ doc_type: kind, customer_uid: customer?.uid ?? null, issue_date: date, lines, notes: notes || undefined, terms: kind === "FV" ? terms : { ...terms, receiver: null } }, existing?.uid);
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

          {isSale && <PaymentCard terms={terms} onChange={setTerms} issueDate={date} hasCustomer={!!customer} creditWarning={creditWarn} />}
          {isSale && kind === "FV" && customer && terms.receiver && (
            <ReceiverCard receiver={terms.receiver} onChange={(r) => setTerms({ ...terms, receiver: r })} saveToCustomer={saveToCustomer}
              onSaveToCustomer={setSaveToCustomer} canSave={receiverChanged} />
          )}
          {isSale && <ReferencesCard refs={terms.references} onChange={(references) => setTerms({ ...terms, references })} />}

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
          {promo.applied.length > 0 && (
            <Card title="Promociones" subtitle={promoApplied ? "Aplicadas como descuento en cada línea." : "Calzan con esta venta."}>
              <ul className="flex flex-col gap-2 text-sm">
                {promo.applied.map((a) => (
                  <li key={a.uid} className="flex items-start gap-2">
                    <BadgePercent size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="font-medium text-ink">{a.name}</span><span className="block text-xs text-muted">{a.detail}</span></span>
                    <span className="num font-medium text-success">−{formatMoney(a.saving_minor)}</span>
                  </li>
                ))}
              </ul>
              {promoApplied
                ? <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-success"><CheckCircle2 size={15} aria-hidden /> Ahorro {formatMoney(promo.total_saving_minor)} (sin IVA)</p>
                : <Button className="mt-3 w-full" icon={BadgePercent} onClick={applyPromos}>Aplicar promociones (−{formatMoney(promo.total_saving_minor)})</Button>}
              {belowCost.length > 0 && <Notice tone="warning">Con el descuento, {belowCost.join(", ")} queda bajo el costo.</Notice>}
            </Card>
          )}
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
