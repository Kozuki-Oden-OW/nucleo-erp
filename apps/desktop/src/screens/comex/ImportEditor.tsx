// Crear o editar una carpeta de importación: proveedor, Incoterm, moneda y tipo de cambio, fechas,
// productos (precio en la moneda del proveedor, peso y arancel) y vista previa del costo en bodega.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Info, Save, Trash2 } from "lucide-react";
import {
  useBackend, errorMessage, type CurrencyRow, type ImportDetail, type ImportInput, type IncotermDef, type Product, type Supplier, type TransportMode,
} from "../../data";
import { BASIS_LABEL, COST_LABEL, landedCost, toClp, type Basis } from "../../data/comex";
import { formatMoney, formatQty, parseQty, todayIso } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Checkbox, Field, IconButton, Notice, PageHeader, Select, Spinner, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { SupplierFormDrawer } from "../compras/common";
import { ProductPicker, SupplierPicker, type ProductPickerHandle } from "../ventas/pickers";
import { PercentField, RateField, TRANSPORT } from "./common";

interface Row {
  key: number; product_uid: string | null; sku: string | null; description: string; qty: string; price: number | null;
  weightKg: string; duty_ppm: number | null; hs_code: string;
}
let seq = 0;
const kgToG = (t: string): number | null => { const c = t.trim().replace(",", "."); if (!c) return null; const v = Number(c); return Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : null; };
const gToKg = (g: number | null) => (g === null ? "" : String(g / 1000).replace(".", ","));

export function ImportEditor({ existing }: { existing?: ImportDetail }) {
  const backend = useBackend();
  const toast = useToast();
  const [incoterms, setIncoterms] = useState<IncotermDef[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const e = existing;
  const [f, setF] = useState({
    incoterm: e?.incoterm ?? "FOB", transport_mode: (e?.transport_mode ?? "maritimo") as TransportMode, origin_country: e?.origin_country ?? "",
    origin_port: e?.origin_port ?? "", destination_port: e?.destination_port ?? "", currency_code: e?.currency_code ?? "USD", rate_e6: e?.rate_e6 ?? null as number | null,
    purchase_date: e?.purchase_date ?? "", shipment_date: e?.shipment_date ?? "", eta: e?.eta ?? "", allocation_basis: (e?.allocation_basis ?? "valor") as Basis,
    vat_ppm: e?.vat_ppm ?? null as number | null, vat_recoverable: e?.vat_recoverable ?? true, notes: e?.notes ?? "",
    notional_insurance_ppm: e?.notional_insurance_ppm ?? null as number | null,
    transport_freight_minor: e?.transport_freight_minor ?? null as number | null,
  });
  const [notionalHint, setNotionalHint] = useState<{ value: number; source: string } | null>(null);
  const [rows, setRows] = useState<Row[]>(() => (e?.items ?? []).map((i) => ({
    key: ++seq, product_uid: i.product_uid, sku: i.sku, description: i.description, qty: formatQty(i.qty_milli), price: i.unit_price_minor,
    weightKg: gToKg(i.weight_g), duty_ppm: i.duty_ppm, hs_code: i.hs_code ?? "",
  })));
  const [defaultDuty, setDefaultDuty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<ProductPickerHandle>(null);

  useEffect(() => {
    backend.incoterms().then(setIncoterms).catch(() => {});
    backend.currencies().then((c) => {
      setCurrencies(c);
      if (!e) { const usd = c.find((x) => x.code === "USD"); if (usd?.last_rate_e6) setF((x) => ({ ...x, rate_e6: x.rate_e6 ?? usd.last_rate_e6 })); }
    }).catch(() => {});
    if (!e) {
      backend.ruleValue("IVA_TASA_GENERAL_PPM").then((v) => v && setF((x) => ({ ...x, vat_ppm: x.vat_ppm ?? v.value }))).catch(() => {});
      backend.ruleValue("ARANCEL_GENERAL_PPM").then((v) => v && setDefaultDuty(v.value)).catch(() => {});
    }
    backend.ruleValue("SEGURO_TEORICO_PPM").then(setNotionalHint).catch(() => {});
    if (e?.supplier_uid) backend.supplier(e.supplier_uid).then(setSupplier).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const cur = currencies.find((c) => c.code === f.currency_code);
  const decimals = cur?.decimals ?? (f.currency_code === "CLP" ? 0 : 2);
  const inc = incoterms.find((i) => i.code === f.incoterm);
  const items = rows.map((r) => ({
    product_uid: r.product_uid, description: r.description.trim(), qty_milli: parseQty(r.qty) ?? 0, unit_price_minor: r.price ?? 0,
    weight_g: kgToG(r.weightKg), volume_cm3: null, duty_ppm: r.duty_ppm, hs_code: r.hs_code.trim() || null,
  }));
  const preview = useMemo(() => landedCost({
    currency_decimals: decimals, rate_e6: f.rate_e6 ?? (f.currency_code === "CLP" ? 1_000_000 : 0), basis: f.allocation_basis,
    vat_ppm: f.vat_ppm, vat_recoverable: f.vat_recoverable, notional_insurance_ppm: f.notional_insurance_ppm, customs_freight_clp: f.transport_freight_minor !== null ? toClp(f.transport_freight_minor, decimals, f.rate_e6 ?? (f.currency_code === "CLP" ? 1_000_000 : 0)) : null, items,
    costs: (e?.costs ?? []).filter((c) => c.status === "vigente").map((c) => {
      const rate = c.rate_e6 ?? (c.currency_code === "CLP" ? 1_000_000 : c.currency_code === f.currency_code ? f.rate_e6 : null);
      return { kind: c.kind, amount_clp: rate ? toClp(c.amount_minor, c.currency_decimals, rate) : 0, basis: c.allocation_basis, recoverable: c.recoverable_tax };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(items), f, decimals, e]);

  function add(p: Product | null, text: string) {
    if (!p && !text) return;
    setRows((rs) => [...rs, { key: ++seq, product_uid: p?.uid ?? null, sku: p?.sku ?? null, description: p?.name ?? text, qty: "1", price: null, weightKg: "", duty_ppm: defaultDuty, hs_code: "" }]);
  }
  const upd = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setErr(null);
    const bad = rows.find((r) => parseQty(r.qty) === null || !(parseQty(r.qty)! > 0));
    if (bad) { setErr(`Revisa la cantidad de “${bad.description}”.`); return; }
    const input: ImportInput = {
      supplier_uid: supplier?.uid ?? null, incoterm: f.incoterm || null, transport_mode: f.transport_mode, origin_country: f.origin_country || null,
      origin_port: f.origin_port || null, destination_port: f.destination_port || null, currency_code: f.currency_code,
      rate_e6: f.currency_code === "CLP" ? null : f.rate_e6, purchase_date: f.purchase_date || null, production_eta: e?.production_eta ?? null,
      shipment_date: f.shipment_date || null, eta: f.eta || null, arrival_date: e?.arrival_date ?? null, allocation_basis: f.allocation_basis,
      vat_ppm: f.vat_ppm, vat_recoverable: f.vat_recoverable, notional_insurance_ppm: f.notional_insurance_ppm, transport_freight_minor: f.transport_freight_minor, notes: f.notes || null, items,
    };
    setBusy(true);
    try {
      const d = await backend.saveImport(input, e?.uid);
      toast("success", e ? `${d.number} actualizada.` : `${d.number} creada. Ahora agrega sus costos (flete, seguro, agente…).`);
      navigate(`/comex/importacion/${d.uid}`, { replace: true });
    } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  }

  if (e && !e.editable) return <Notice tone="warning" title="Ya no se puede editar">Esta importación tiene mercadería recibida o está cerrada. Puedes seguir registrando sus costos desde la carpeta.</Notice>;
  const T = TRANSPORT[f.transport_mode];
  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack(e ? `/comex/importacion/${e.uid}` : "/comex")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> {e ? e.number : "Comercio exterior"}</button>}
        title={e ? `Editar ${e.number}` : "Nueva importación"}
        subtitle="Parte como cotización: compárala, ajústala y confírmala cuando hagas el pedido."
        actions={<Button icon={Save} onClick={save} disabled={busy || rows.length === 0}>{busy ? "Guardando…" : e ? "Guardar cambios" : "Crear importación"}</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Card title="Proveedor y logística">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Proveedor en el extranjero</span>
                <SupplierPicker value={supplier} onChange={setSupplier} onCreate={(n) => setNewSupplier(n)} />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Select label="Incoterm" value={f.incoterm} onChange={(x) => setF({ ...f, incoterm: x.target.value })}
                  options={[{ value: "", label: "Sin indicar" }, ...incoterms.map((i) => ({ value: i.code, label: `${i.code} · ${i.name}` }))]} />
                <Select label="Transporte" value={f.transport_mode} onChange={(x) => setF({ ...f, transport_mode: x.target.value as TransportMode })}
                  options={(Object.keys(TRANSPORT) as TransportMode[]).map((k) => ({ value: k, label: TRANSPORT[k].label }))} />
                <Field label="País de origen" value={f.origin_country} onChange={(x) => setF({ ...f, origin_country: x.target.value })} placeholder="Ej. China" />
                <Field label={f.transport_mode === "aereo" ? "Aeropuerto de origen" : "Puerto o ciudad de origen"} optional value={f.origin_port} onChange={(x) => setF({ ...f, origin_port: x.target.value })} />
                <Field label={f.transport_mode === "aereo" ? "Aeropuerto de destino" : "Puerto de destino"} optional value={f.destination_port} onChange={(x) => setF({ ...f, destination_port: x.target.value })} placeholder={f.transport_mode === "maritimo" ? "Ej. San Antonio" : undefined} />
                <Field label="Llegada estimada (ETA)" type="date" value={f.eta} onChange={(x) => setF({ ...f, eta: x.target.value })} />
              </div>
              {inc && (
                <div className="flex gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
                  <Info size={17} className="mt-0.5 shrink-0 text-info" aria-hidden />
                  <div><span className="font-medium text-ink">{inc.code}:</span> <span className="text-muted">{inc.content.nota}</span>
                    {inc.content.transporte === "maritimo" && f.transport_mode !== "maritimo" && <span className="text-warning"> Este Incoterm es para transporte marítimo.</span>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
        <div>
          <Card title="Moneda e impuestos">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Select label="Moneda" value={f.currency_code} onChange={(x) => { const c = currencies.find((k) => k.code === x.target.value); setF({ ...f, currency_code: x.target.value, rate_e6: x.target.value === "CLP" ? null : c?.last_rate_e6 ?? f.rate_e6 }); }}
                  options={(currencies.length ? currencies.map((c) => c.code) : ["USD", "CLP"]).map((c) => ({ value: c, label: c }))} />
                {f.currency_code !== "CLP" && <RateField label="Tipo de cambio" rate={f.rate_e6} onRate={(v) => setF({ ...f, rate_e6: v })} currency={f.currency_code} />}
              </div>
              {f.currency_code !== "CLP" && <p className="-mt-2 text-xs text-muted">{cur?.last_rate_date ? `Último registrado (${cur.last_rate_date}) en Configuración → Monedas.` : `Pesos chilenos por 1 ${f.currency_code}.`} Usa el que te indique tu agente para la declaración.</p>}
              <Select label="Repartir los costos" value={f.allocation_basis} onChange={(x) => setF({ ...f, allocation_basis: x.target.value as Basis })}
                options={(Object.keys(BASIS_LABEL) as Basis[]).filter((b) => b !== "volumen").map((b) => ({ value: b, label: BASIS_LABEL[b] }))}
                hint="Criterio para flete y gastos entre los productos. Cada costo puede tener el suyo." />
              <PercentField label="IVA de importación" ppm={f.vat_ppm} onPpm={(v) => setF({ ...f, vat_ppm: v })} optional hint="Para estimar. El monto real de la declaración lo reemplaza." />
              <Checkbox label="Recupero el IVA como crédito" hint="Si lo recuperas, no suma al costo del producto." checked={f.vat_recoverable} onChange={(v) => setF({ ...f, vat_recoverable: v })} />
              <PercentField label="Seguro teórico (si no contrataste seguro)" ppm={f.notional_insurance_ppm} onPpm={(v) => setF({ ...f, notional_insurance_ppm: v })} optional
                hint={`% del valor de la mercadería que la aduana agrega al valor aduanero cuando no hay seguro. No se paga ni suma al costo; sí sube el IVA y los derechos.${notionalHint ? ` Demostración: ${notionalHint.value / 10_000} %.` : " Pregúntale a tu agente el porcentaje."}`} />
              <MoneyField label={`Flete según el AWB o BL (${f.currency_code})`} currency={f.currency_code} value={f.transport_freight_minor} onValue={(v) => setF({ ...f, transport_freight_minor: v })}
                hint="Solo si la factura trae el flete incluido (CPT, CFR) y el documento de transporte muestra otro: Aduanas declara ese flete y la diferencia pasa a la mercadería." />
            </div>
          </Card>
        </div>
      </div>
      <div className="mt-6">
          <Card title="Productos" subtitle={`Precio unitario en ${f.currency_code} según la factura del proveedor (${f.incoterm || "sin Incoterm"}). Peso por unidad para repartir el flete.`} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Producto</th><th className="w-24 px-2 text-right">Cantidad</th><th className="w-36 px-2 text-right">Precio unit.</th>
              <th className="w-24 px-2 text-right">Peso (kg)</th><th className="w-24 px-2 text-right">Arancel</th><th className="w-28 px-2">Partida</th>
              <th className="w-32 px-2 text-right">Costo unit.</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="border-b border-line align-top">
                  <td className="px-4 py-2">
                    <input aria-label="Descripción" value={r.description} onChange={(x) => upd(r.key, { description: x.target.value })} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 hover:border-line focus:border-accent focus:outline-none" />
                    {r.sku ? <div className="px-2 font-mono text-xs text-muted">{r.sku}</div> : <div className="px-2 text-xs text-warning">Sin producto: no entrará a bodega</div>}
                  </td>
                  <td className="px-2 py-2"><input aria-label={`Cantidad de ${r.description}`} inputMode="decimal" value={r.qty} onChange={(x) => upd(r.key, { qty: x.target.value })} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                  <td className="px-2 py-2"><MoneyField aria-label={`Precio de ${r.description}`} currency={f.currency_code} value={r.price} onValue={(v) => upd(r.key, { price: v })} /></td>
                  <td className="px-2 py-2"><input aria-label={`Peso de ${r.description}`} inputMode="decimal" value={r.weightKg} placeholder="—" onChange={(x) => upd(r.key, { weightKg: x.target.value })} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                  <td className="px-2 py-2"><PercentField label="" ariaLabel={`Arancel de ${r.description}`} ppm={r.duty_ppm} onPpm={(v) => upd(r.key, { duty_ppm: v })} placeholder="0" /></td>
                  <td className="px-2 py-2"><input aria-label={`Partida de ${r.description}`} value={r.hs_code} placeholder="—" onChange={(x) => upd(r.key, { hs_code: x.target.value })} className="h-8 w-full rounded-md border border-line bg-surface px-2 font-mono text-xs focus:border-accent focus:outline-none" /></td>
                  <td className="num px-2 py-3.5 text-right font-medium">{preview.items[i] ? formatMoney(Math.round(preview.items[i]!.unit_cost_e4 / 10_000)) : "—"}</td>
                  <td className="pr-2 pt-2"><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4"><ProductPicker ref={picker} onPick={add} /></div>
      </Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Notas"><TextArea label="Observaciones" optional rows={2} value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} /></Card>
          <Card title="Fechas" subtitle="Se completan solas al avanzar de etapa.">
            <div className="flex flex-col gap-3">
              <Field label="Fecha de compra" type="date" optional value={f.purchase_date} onChange={(x) => setF({ ...f, purchase_date: x.target.value })} max={todayIso()} />
              <Field label={`Embarque (${T.label.toLowerCase()})`} type="date" optional value={f.shipment_date} onChange={(x) => setF({ ...f, shipment_date: x.target.value })} />
            </div>
          </Card>
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card title="Vista previa">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Mercadería</dt><dd className="num">{formatMoney(preview.fob_minor, f.currency_code)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">En pesos</dt><dd className="num">{formatMoney(preview.fob_clp)}</dd></div>
              {preview.freight_clp + preview.insurance_clp > 0 && <div className="flex justify-between"><dt className="text-muted">+ {COST_LABEL.flete} y seguro</dt><dd className="num">{formatMoney(preview.freight_clp + preview.insurance_clp)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">+ Derechos</dt><dd className="num">{formatMoney(preview.duty_clp)}</dd></div>
              {preview.local_clp > 0 && <div className="flex justify-between"><dt className="text-muted">+ Gastos</dt><dd className="num">{formatMoney(preview.local_clp)}</dd></div>}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Costo en bodega</dt><dd className="num text-lg font-semibold">{formatMoney(preview.landed_clp)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">{e ? "Incluye los costos ya registrados en la carpeta." : "Al crearla, agrega flete, seguro, agente y demás costos en la carpeta."}</p>
            {preview.notes.map((n) => <p key={n} className="mt-1 text-xs text-warning">{n}</p>)}
          </Card>
        </aside>
      </div>
      <SupplierFormDrawer open={newSupplier !== null} initialName={newSupplier ?? ""} onClose={() => setNewSupplier(null)} onSaved={(s) => { setSupplier(s); setNewSupplier(null); }} />
    </div>
  );
}

export function ImportEditLoader({ uid }: { uid: string }) {
  const backend = useBackend();
  const [d, setD] = useState<ImportDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { backend.import(uid).then(setD).catch((x) => setErr(errorMessage(x))); }, [backend, uid]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <Spinner />;
  return <ImportEditor existing={d} />;
}
