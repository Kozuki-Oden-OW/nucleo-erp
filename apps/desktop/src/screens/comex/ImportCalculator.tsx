// NÚCLEO COMEX — calculadora y comparador de escenarios de importación (prototipo de la Fase 3).
import { useEffect, useMemo, useState } from "react";
import { Copy, Info, Plane, Plus, Ship, Trash2, Truck, Package2 } from "lucide-react";
import { useBackend } from "../../data";
import { computeLanded, priceForMargin, type ComexItem, type ComexScenario } from "../../data/comex";
import { formatMoney, formatPpm, parsePercent } from "../../lib/format";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, Field, IconButton, Notice, PageHeader, Select, cx } from "../../ui/kit";

const TRANSPORT = { maritimo: { label: "Marítimo", icon: Ship }, aereo: { label: "Aéreo", icon: Plane }, courier: { label: "Courier", icon: Package2 }, terrestre: { label: "Terrestre", icon: Truck } } as const;

function PercentField({ label, ppm, onPpm, hint }: { label: string; ppm: number; onPpm: (v: number) => void; hint?: string }) {
  const [text, setText] = useState(String(ppm / 10_000).replace(".", ","));
  useEffect(() => { setText(String(ppm / 10_000).replace(".", ",")); }, [ppm]);
  return <Field label={label} hint={hint} suffix="%" inputMode="decimal" value={text} inputClassName="text-right num" onChange={(e) => { setText(e.target.value); const v = parsePercent(e.target.value); if (v !== null) onPpm(v); }} />;
}

function UsdField({ label, cents, onCents, hint }: { label: string; cents: number; onCents: (v: number) => void; hint?: string }) {
  return <MoneyField label={label} currency="USD" value={cents} onValue={(v) => onCents(v ?? 0)} hint={hint} />;
}

export function ImportCalculator() {
  const backend = useBackend();
  const [duty, setDuty] = useState<{ value: number; source: string } | null>(null);
  const [vat, setVat] = useState<{ value: number; source: string } | null>(null);
  const [items, setItems] = useState<ComexItem[]>([
    { description: "Taladro percutor inalámbrico 18 V", qty: 200, fob_unit_cents: 2_150 },
    { description: "Set de atornilladores 32 piezas", qty: 500, fob_unit_cents: 310 },
  ]);
  const [margin, setMargin] = useState(350_000);
  const [scenarios, setScenarios] = useState<ComexScenario[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    Promise.all([backend.ruleValue("ARANCEL_GENERAL_PPM"), backend.ruleValue("IVA_TASA_GENERAL_PPM")]).then(([d, v]) => {
      setDuty(d); setVat(v);
      const base = { rate_e6: 950_000_000, insurance_cents: null, insurance_ppm: 5_000, duty_ppm: d?.value ?? 0, vat_ppm: v?.value ?? 0, vat_recoverable: true, bank_clp: 25_000, other_clp: 0 };
      setScenarios([
        { ...base, name: "A · Marítimo", transport: "maritimo", transit_days: 45, freight_cents: 85_000, agent_clp: 180_000, port_clp: 210_000, inland_clp: 140_000 },
        { ...base, name: "B · Aéreo", transport: "aereo", transit_days: 7, freight_cents: 240_000, agent_clp: 180_000, port_clp: 95_000, inland_clp: 90_000 },
        { ...base, name: "C · Courier", transport: "courier", transit_days: 4, freight_cents: 310_000, agent_clp: 0, port_clp: 0, inland_clp: 35_000 },
      ]);
    });
  }, [backend]);

  const results = useMemo(() => scenarios.map((s) => computeLanded(items, s)), [scenarios, items]);
  const s = scenarios[active];
  const res = results[active];
  const cheapest = results.length ? results.reduce((best, x, i) => (x.landed_clp < results[best]!.landed_clp ? i : best), 0) : -1;
  const upd = (patch: Partial<ComexScenario>) => setScenarios((xs) => xs.map((x, i) => (i === active ? { ...x, ...patch } : x)));
  const updItem = (i: number, patch: Partial<ComexItem>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  if (!s || !res) return <PageHeader title="Calculadora de importación" subtitle="Cargando…" />;

  return (
    <div className="anim-in">
      <PageHeader
        title="Calculadora de importación"
        subtitle="Conoce el costo real de cada producto puesto en tu bodega antes de comprar, y compara escenarios logísticos."
      />
      <div className="mb-6">
        <Notice tone="info" icon={Info} title="Prototipo · los porcentajes son tuyos">
          Arancel e IVA de importación se ingresan según tu operación. {duty ? `En esta demostración se proponen valores ilustrativos (${duty.source.split("·")[0]?.trim()}).` : "No hay un paquete normativo cargado: escribe los porcentajes que te indicó tu agente de aduana."}
          {" "}Simulación y operación real usarán la misma calculadora (Fase 9).
        </Notice>
      </div>

      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {scenarios.map((x, i) => {
          const T = TRANSPORT[x.transport];
          return (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cx("flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm", i === active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink hover:border-line-strong")}
            >
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
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2">Producto</th><th className="w-24 px-2 text-right">Cantidad</th><th className="w-36 px-2 text-right">FOB unitario</th><th className="w-10" /></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-line">
                    <td className="px-4 py-1.5"><input aria-label="Producto" value={it.description} onChange={(e) => updItem(i, { description: e.target.value })} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 hover:border-line focus:border-accent focus:outline-none" /></td>
                    <td className="px-2 py-1.5"><input aria-label="Cantidad" inputMode="numeric" value={it.qty} onChange={(e) => updItem(i, { qty: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) })} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                    <td className="px-2 py-1.5"><MoneyField aria-label="FOB unitario" currency="USD" value={it.fob_unit_cents} onValue={(v) => updItem(i, { fob_unit_cents: v ?? 0 })} /></td>
                    <td><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-3"><Button variant="ghost" size="sm" icon={Plus} onClick={() => setItems((xs) => [...xs, { description: "Nuevo producto", qty: 1, fob_unit_cents: 0 }])}>Agregar producto</Button></div>
          </Card>

          <Card title={`Escenario ${s.name}`}>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Nombre" value={s.name} onChange={(e) => upd({ name: e.target.value })} />
              <Select label="Transporte" value={s.transport} onChange={(e) => upd({ transport: e.target.value as ComexScenario["transport"] })} options={Object.entries(TRANSPORT).map(([v, t]) => ({ value: v, label: t.label }))} />
              <Field label="Días de tránsito" inputMode="numeric" value={s.transit_days} onChange={(e) => upd({ transit_days: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <Field label="Tipo de cambio (CLP por USD)" inputMode="decimal" inputClassName="text-right num" value={String(s.rate_e6 / 1_000_000).replace(".", ",")} onChange={(e) => { const v = Number(e.target.value.replace(/\./g, "").replace(",", ".")); if (v > 0) upd({ rate_e6: Math.round(v * 1_000_000) }); }} />
              <UsdField label="Flete internacional (USD)" cents={s.freight_cents} onCents={(v) => upd({ freight_cents: v })} />
              <PercentField label="Seguro (% de FOB + flete)" ppm={s.insurance_ppm} onPpm={(v) => upd({ insurance_ppm: v, insurance_cents: null })} />
              <PercentField label="Arancel (% sobre CIF)" ppm={s.duty_ppm} onPpm={(v) => upd({ duty_ppm: v })} hint="Según la clasificación de tu producto" />
              <PercentField label="IVA de importación (%)" ppm={s.vat_ppm} onPpm={(v) => upd({ vat_ppm: v })} hint={vat ? "Valor de demostración" : "Ingresa el porcentaje vigente"} />
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
          <Card title="Costo puesto en bodega">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">FOB</dt><dd className="num">{formatMoney(res.fob_cents, "USD")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Flete y seguro</dt><dd className="num">{formatMoney(s.freight_cents + res.insurance_cents, "USD")}</dd></div>
              <div className="flex justify-between font-medium"><dt>= CIF</dt><dd className="num">{formatMoney(res.cif_cents, "USD")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">CIF en pesos</dt><dd className="num">{formatMoney(res.cif_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Arancel ({formatPpm(s.duty_ppm)})</dt><dd className="num">{formatMoney(res.duty_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Gastos en Chile</dt><dd className="num">{formatMoney(res.local_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">IVA importación ({formatPpm(s.vat_ppm)})</dt><dd className={cx("num", s.vat_recoverable && "text-faint line-through")}>{formatMoney(res.vat_clp)}</dd></div>
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Costo total</dt><dd className="num text-xl font-semibold">{formatMoney(res.landed_clp)}</dd></div>
            </dl>
            {s.vat_recoverable && <p className="mt-2 text-xs text-muted">El IVA de importación ({formatMoney(res.vat_clp)}) igual se paga, pero lo recuperas como crédito: no suma al costo.</p>}
          </Card>
          <Card title="Costo y precio por unidad">
            <div className="mb-3"><PercentField label="Margen que quieres ganar (sobre el precio)" ppm={margin} onPpm={setMargin} /></div>
            <ul className="flex flex-col divide-y divide-line text-sm">
              {res.items.map((it, i) => (
                <li key={i} className="py-2">
                  <div className="truncate font-medium text-ink">{it.description}</div>
                  <div className="mt-1 flex justify-between text-muted"><span>Costo unitario real</span><span className="num text-ink">{formatMoney(it.landed_unit_clp)}</span></div>
                  <div className="flex justify-between text-muted"><span>Precio neto sugerido</span><span className="num font-semibold text-accent">{formatMoney(priceForMargin(it.landed_unit_clp, margin))}</span></div>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      <div className="mt-6">
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
                      <td className="num text-right">{formatMoney(rr.cif_clp)}</td>
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
    </div>
  );
}
