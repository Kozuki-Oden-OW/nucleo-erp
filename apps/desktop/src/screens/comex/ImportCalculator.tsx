// Calculadora y comparador de escenarios de importación. Usa el MISMO cálculo que las carpetas
// (data/comex.ts = nucleo-domain/comex.rs, verificados con los mismos casos golden).
import { useEffect, useMemo, useState } from "react";
import { Copy, FolderPlus, Info, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type Product, type TransportMode } from "../../data";
import { landedCost, priceForMargin, type LandedCost, type LandedResult } from "../../data/comex";
import { formatMoney, formatQty, parseQty } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, cx, Field, IconButton, Notice, Select } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { ProductPicker } from "../ventas/pickers";
import { PercentField, RateField, TRANSPORT } from "./common";

interface Item { key: number; product_uid: string | null; description: string; qty: string; price: number | null }
interface Scenario {
  name: string; transport: TransportMode; transit_days: number; rate_e6: number | null; freight_cents: number;
  insurance_ppm: number | null; duty_ppm: number | null; vat_ppm: number | null; vat_recoverable: boolean;
  agent_clp: number; port_clp: number; inland_clp: number; bank_clp: number; other_clp: number;
}
let seq = 0;

function compute(items: Item[], s: Scenario): LandedResult {
  const rate = s.rate_e6 ?? 0;
  const li = items.map((i) => ({ qty_milli: parseQty(i.qty) ?? 0, unit_price_minor: i.price ?? 0, duty_ppm: s.duty_ppm }));
  const fobCents = li.reduce((a, i) => a + Math.round((i.qty_milli * i.unit_price_minor) / 1000), 0);
  const usd = (cents: number) => Math.round((cents * rate) / 100 / 1_000_000);
  const insuranceCents = s.insurance_ppm ? Math.round(((fobCents + s.freight_cents) * s.insurance_ppm) / 1_000_000) : 0;
  const costs: LandedCost[] = [
    { kind: "flete", amount_clp: usd(s.freight_cents) }, { kind: "seguro", amount_clp: usd(insuranceCents) },
    { kind: "agente_aduana", amount_clp: s.agent_clp }, { kind: "gastos_portuarios", amount_clp: s.port_clp },
    { kind: "transporte_interno", amount_clp: s.inland_clp }, { kind: "gastos_bancarios", amount_clp: s.bank_clp }, { kind: "otros", amount_clp: s.other_clp },
  ].filter((c) => c.amount_clp > 0) as LandedCost[];
  return landedCost({ currency_decimals: 2, rate_e6: rate, basis: "valor", vat_ppm: s.vat_ppm, vat_recoverable: s.vat_recoverable, items: li, costs });
}

export function ImportCalculator() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [margin, setMargin] = useState<number | null>(350_000);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [active, setActive] = useState(0);
  const [hasRules, setHasRules] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([backend.ruleValue("ARANCEL_GENERAL_PPM"), backend.ruleValue("IVA_TASA_GENERAL_PPM"), backend.currencies().catch(() => []), backend.searchProducts("taladro").catch(() => [])]).then(([d, v, cur, prods]) => {
      setHasRules(!!(d || v));
      const usd = cur.find((c) => c.code === "USD")?.last_rate_e6 ?? null;
      const base = { rate_e6: usd, insurance_ppm: 5_000, duty_ppm: d?.value ?? null, vat_ppm: v?.value ?? null, vat_recoverable: true, bank_clp: 25_000, other_clp: 0 };
      setScenarios([
        { ...base, name: "A · Marítimo", transport: "maritimo", transit_days: 45, freight_cents: 85_000, agent_clp: 180_000, port_clp: 210_000, inland_clp: 140_000 },
        { ...base, name: "B · Aéreo", transport: "aereo", transit_days: 7, freight_cents: 240_000, agent_clp: 180_000, port_clp: 95_000, inland_clp: 90_000 },
        { ...base, name: "C · Courier", transport: "courier", transit_days: 4, freight_cents: 310_000, agent_clp: 0, port_clp: 0, inland_clp: 35_000 },
      ]);
      const p = prods[0];
      setItems(p ? [{ key: ++seq, product_uid: p.uid, description: p.name, qty: "200", price: 2_150 }] : [{ key: ++seq, product_uid: null, description: "Producto de ejemplo", qty: "200", price: 2_150 }]);
    }).catch(() => {});
  }, [backend]);

  const results = useMemo(() => scenarios.map((s) => compute(items, s)), [scenarios, items]);
  const s = scenarios[active];
  const res = results[active];
  const cheapest = results.length ? results.reduce((best, x, i) => (x.landed_clp < results[best]!.landed_clp ? i : best), 0) : -1;
  const upd = (patch: Partial<Scenario>) => setScenarios((xs) => xs.map((x, i) => (i === active ? { ...x, ...patch } : x)));
  const updItem = (key: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = (p: Product | null, text: string) => { if (p || text) setItems((xs) => [...xs, { key: ++seq, product_uid: p?.uid ?? null, description: p?.name ?? text, qty: "1", price: null }]); };

  async function createImport() {
    if (!s || !res) return;
    setBusy(true);
    try {
      let d = await backend.saveImport({
        supplier_uid: null, incoterm: "FOB", transport_mode: s.transport, origin_country: null, origin_port: null, destination_port: null,
        currency_code: "USD", rate_e6: s.rate_e6, purchase_date: null, production_eta: null, shipment_date: null, eta: null, arrival_date: null,
        allocation_basis: "valor", vat_ppm: s.vat_ppm, vat_recoverable: s.vat_recoverable, notes: `Creada desde la calculadora · escenario ${s.name}`,
        items: items.map((i) => ({ product_uid: i.product_uid, description: i.description, qty_milli: parseQty(i.qty) ?? 0, unit_price_minor: i.price ?? 0, weight_g: null, volume_cm3: null, duty_ppm: s.duty_ppm, hs_code: null })),
      });
      const est = (kind: "flete" | "seguro" | "agente_aduana" | "gastos_portuarios" | "transporte_interno" | "gastos_bancarios" | "otros", amount: number, currency = "CLP") => ({
        kind, description: null, supplier_uid: null, currency_code: currency, amount_minor: amount, rate_e6: null, is_estimate: true, recoverable_tax: false,
        allocation_basis: null, document_ref: null, cost_date: null, payment: null, due_date: null, paid_method: null, paid_account_uid: null,
      });
      const list = [est("flete", s.freight_cents, "USD"), est("seguro", res.insurance_clp), est("agente_aduana", s.agent_clp), est("gastos_portuarios", s.port_clp),
        est("transporte_interno", s.inland_clp), est("gastos_bancarios", s.bank_clp), est("otros", s.other_clp)].filter((c) => c.amount_minor > 0);
      for (const c of list) d = await backend.addImportCost(d.uid, c);
      toast("success", `${d.number} creada como cotización con los costos estimados del escenario.`);
      navigate(`/comex/importacion/${d.uid}`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  if (!s || !res) return <p className="text-sm text-muted">Cargando…</p>;
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info" icon={Info} title="Los porcentajes son tuyos">
        Arancel e IVA de importación se ingresan según tu operación. {hasRules ? "Se proponen valores ilustrativos de demostración." : "No hay un paquete normativo cargado: escribe los porcentajes que te indicó tu agente de aduana."}
        {" "}Es la misma calculadora de las carpetas de importación.
      </Notice>
      <div role="tablist" className="flex flex-wrap gap-2">
        {scenarios.map((x, i) => {
          const T = TRANSPORT[x.transport];
          return (
            <button key={i} role="tab" aria-selected={i === active} onClick={() => setActive(i)}
              className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm", i === active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink hover:border-line-strong")}>
              <T.icon size={16} aria-hidden />
              <span className="font-medium">{x.name}</span>
              <span className="num text-xs text-muted">{formatMoney(results[i]!.landed_clp)}</span>
              {i === cheapest && <Badge tone="success">Más barato</Badge>}
            </button>
          );
        })}
        <Button variant="ghost" icon={Copy} onClick={() => { setScenarios((xs) => [...xs, { ...s, name: `${String.fromCharCode(65 + xs.length)} · Copia` }]); setActive(scenarios.length); }}>Duplicar escenario</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Mercadería (precio FOB en USD)" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2">Producto</th><th className="w-24 px-2 text-right">Cantidad</th><th className="w-36 px-2 text-right">FOB unitario</th><th className="w-10" /></tr></thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.key} className="border-b border-line">
                      <td className="px-4 py-1.5"><input aria-label="Producto" value={it.description} onChange={(e) => updItem(it.key, { description: e.target.value })} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 hover:border-line focus:border-accent focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><input aria-label={`Cantidad de ${it.description}`} inputMode="decimal" value={it.qty} onChange={(e) => updItem(it.key, { qty: e.target.value })} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><MoneyField aria-label={`FOB unitario de ${it.description}`} currency="USD" value={it.price} onValue={(v) => updItem(it.key, { price: v })} /></td>
                      <td><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3"><ProductPicker onPick={add} /></div>
          </Card>

          <Card title={`Escenario ${s.name}`}>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Nombre" value={s.name} onChange={(e) => upd({ name: e.target.value })} />
              <Select label="Transporte" value={s.transport} onChange={(e) => upd({ transport: e.target.value as TransportMode })} options={(Object.keys(TRANSPORT) as TransportMode[]).map((v) => ({ value: v, label: TRANSPORT[v].label }))} />
              <Field label="Días de tránsito" inputMode="numeric" value={s.transit_days} onChange={(e) => upd({ transit_days: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <RateField rate={s.rate_e6} onRate={(v) => upd({ rate_e6: v })} currency="USD" />
              <MoneyField label="Flete internacional (USD)" currency="USD" value={s.freight_cents} onValue={(v) => upd({ freight_cents: v ?? 0 })} />
              <PercentField label="Seguro (% de FOB + flete)" ppm={s.insurance_ppm} onPpm={(v) => upd({ insurance_ppm: v })} />
              <PercentField label="Arancel (% sobre CIF)" ppm={s.duty_ppm} onPpm={(v) => upd({ duty_ppm: v })} hint="Según la clasificación de tu producto" />
              <PercentField label="IVA de importación (%)" ppm={s.vat_ppm} onPpm={(v) => upd({ vat_ppm: v })} hint={hasRules ? "Valor de demostración" : "Ingresa el porcentaje vigente"} />
              <div className="flex items-end pb-2"><Checkbox label="Recupero el IVA como crédito" hint="Si lo recuperas, no suma al costo" checked={s.vat_recoverable} onChange={(v) => upd({ vat_recoverable: v })} /></div>
            </div>
            <h3 className="mb-3 mt-6 text-sm font-semibold text-ink">Gastos en Chile (CLP)</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <MoneyField label="Agente de aduana" value={s.agent_clp} onValue={(v) => upd({ agent_clp: v ?? 0 })} />
              <MoneyField label="Gastos portuarios y almacenaje" value={s.port_clp} onValue={(v) => upd({ port_clp: v ?? 0 })} />
              <MoneyField label="Transporte a tu bodega" value={s.inland_clp} onValue={(v) => upd({ inland_clp: v ?? 0 })} />
              <MoneyField label="Gastos bancarios" value={s.bank_clp} onValue={(v) => upd({ bank_clp: v ?? 0 })} />
              <MoneyField label="Otros" value={s.other_clp} onValue={(v) => upd({ other_clp: v ?? 0 })} />
            </div>
          </Card>
        </div>

        <aside className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
          <Card title="Costo puesto en bodega" actions={can("comex.editar") && <Button size="sm" variant="secondary" icon={FolderPlus} onClick={createImport} disabled={busy || !items.length}>Crear importación</Button>}>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">FOB</dt><dd className="num">{formatMoney(res.fob_minor, "USD")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">FOB en pesos</dt><dd className="num">{formatMoney(res.fob_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Flete y seguro</dt><dd className="num">{formatMoney(res.freight_clp + res.insurance_clp)}</dd></div>
              <div className="flex justify-between font-medium"><dt>= CIF en pesos</dt><dd className="num">{formatMoney(res.customs_value_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Arancel</dt><dd className="num">{formatMoney(res.duty_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Gastos en Chile</dt><dd className="num">{formatMoney(res.local_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">IVA importación</dt><dd className={cx("num", s.vat_recoverable && "text-faint line-through")}>{formatMoney(res.vat_clp)}</dd></div>
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Costo total</dt><dd className="num text-xl font-semibold">{formatMoney(res.landed_clp)}</dd></div>
            </dl>
            {s.vat_recoverable && res.vat_clp > 0 && <p className="mt-2 text-xs text-muted">El IVA de importación ({formatMoney(res.vat_clp)}) igual se paga, pero lo recuperas como crédito: no suma al costo.</p>}
            {res.notes.map((n) => <p key={n} className="mt-1 text-xs text-warning">{n}</p>)}
          </Card>
          <Card title="Costo y precio por unidad">
            <div className="mb-3"><PercentField label="Margen que quieres ganar (sobre el precio)" ppm={margin} onPpm={setMargin} /></div>
            <ul className="flex flex-col divide-y divide-line text-sm">
              {res.items.map((it, i) => {
                const u = Math.round(it.unit_cost_e4 / 10_000);
                return (
                  <li key={items[i]?.key ?? i} className="py-2">
                    <div className="truncate font-medium text-ink">{items[i]?.description} <span className="font-normal text-muted">× {formatQty(parseQty(items[i]?.qty ?? "") ?? 0)}</span></div>
                    <div className="mt-1 flex justify-between text-muted"><span>Costo unitario real</span><span className="num text-ink">{formatMoney(u)}</span></div>
                    <div className="flex justify-between text-muted"><span>Precio neto sugerido</span><span className="num font-semibold text-accent">{formatMoney(priceForMargin(u, margin ?? 0))}</span></div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </aside>
      </div>

      <Card title="Comparación de escenarios" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-5 py-2.5">Escenario</th><th className="text-right">Días</th><th className="text-right">CIF (CLP)</th><th className="text-right">Arancel</th><th className="text-right">Gastos Chile</th><th className="px-5 text-right">Costo total</th><th className="px-5 text-right">vs. más barato</th></tr></thead>
            <tbody>
              {scenarios.map((x, i) => {
                const rr = results[i]!;
                const diff = rr.landed_clp - results[cheapest]!.landed_clp;
                return (
                  <tr key={i} className={cx("border-b border-line last:border-0", i === active && "bg-accent-soft/50")}>
                    <td className="px-5 py-2.5 font-medium">{x.name}</td>
                    <td className="num text-right">{x.transit_days}</td>
                    <td className="num text-right">{formatMoney(rr.customs_value_clp)}</td>
                    <td className="num text-right">{formatMoney(rr.duty_clp)}</td>
                    <td className="num text-right">{formatMoney(rr.local_clp)}</td>
                    <td className="num px-5 text-right font-semibold">{formatMoney(rr.landed_clp)}</td>
                    <td className={cx("num px-5 text-right", diff === 0 ? "text-success" : "text-muted")}>{diff === 0 ? "El más barato" : `+ ${formatMoney(diff)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
