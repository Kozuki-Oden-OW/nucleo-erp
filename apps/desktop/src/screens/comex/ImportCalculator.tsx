// Calculadora y comparador de escenarios de importación. Usa el MISMO cálculo que las carpetas
// (data/comex.ts = nucleo-domain/comex.rs, verificados con los mismos casos golden).
//
// Tres modalidades, según cómo llega la mercadería (COMEX_RULES.md § Modalidades):
// · Con agente de aduana (declaración DIN): arancel e IVA sobre el valor aduanero, gastos del agente.
// · Courier / envío rápido: el courier hace el trámite simplificado y cobra un cargo; mismos impuestos.
// · Plataforma (compra a distancia de bajo valor): la plataforma cobra el IVA al pagar, sin arancel.
// Los límites de cada modalidad y las tasas vienen de un paquete normativo o los escribe el usuario.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, FolderPlus, Info, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type Product, type TransportMode } from "../../data";
import { landedCost, priceForMargin, type LandedCost, type LandedResult } from "../../data/comex";
import { formatMoney, formatQty, parseQty } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, cx, Field, IconButton, Notice, Segmented, Select } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { ProductPicker } from "../ventas/pickers";
import { PercentField, RateField, TRANSPORT } from "./common";

type Mode = "agente" | "courier" | "plataforma";
type InsuranceMode = "contratado" | "teorico" | "ninguno";
type PriceCurrency = "USD" | "CLP";

const MODE_LABEL: Record<Mode, string> = { agente: "Con agente de aduana", courier: "Courier", plataforma: "Plataforma" };
const MODE_HINT: Record<Mode, string> = {
  agente: "Declaración de importación (DIN) con agente: arancel e IVA sobre el valor aduanero, más los gastos del agente, puerto y transporte.",
  courier: "Envío rápido (DHL, FedEx, UPS…): el courier hace el trámite simplificado y cobra un cargo. Paga arancel e IVA sobre el valor aduanero.",
  plataforma: "Compra en una plataforma (Mercado Libre Internacional, AliExpress, Shein…): la plataforma cobra el IVA al pagar sobre producto + envío y no hay arancel.",
};

interface Item { key: number; product_uid: string | null; description: string; qty: string; price: number | null }
interface Scenario {
  name: string; mode: Mode; transport: TransportMode; transit_days: number; rate_e6: number | null; freight_minor: number;
  insurance_mode: InsuranceMode; insurance_ppm: number | null; notional_ppm: number | null;
  duty_ppm: number | null; vat_ppm: number | null; vat_recoverable: boolean;
  /** Plataforma: IVA que muestra el resumen de compra (reemplaza el cálculo por tasa). */
  vat_charged_clp: number | null;
  agent_clp: number; port_clp: number; inland_clp: number; bank_clp: number; other_clp: number;
}
interface Limits { platform_cents: number | null; courier_cents: number | null; cargo_no_agent_cents: number | null }
let seq = 0;

const decimalsOf = (c: PriceCurrency) => (c === "CLP" ? 0 : 2);

function compute(items: Item[], s: Scenario, currency: PriceCurrency): LandedResult {
  const rate = currency === "CLP" ? 1_000_000 : s.rate_e6 ?? 0;
  const d = decimalsOf(currency);
  const plat = s.mode === "plataforma";
  const li = items.map((i) => ({ qty_milli: parseQty(i.qty) ?? 0, unit_price_minor: i.price ?? 0, duty_ppm: plat ? 0 : s.duty_ppm }));
  const goodsMinor = li.reduce((a, i) => a + Math.round((i.qty_milli * i.unit_price_minor) / 1000), 0);
  const toPesos = (minor: number) => Math.round((minor * rate) / 10 ** d / 1_000_000);
  const insuranceMinor = !plat && s.insurance_mode === "contratado" && s.insurance_ppm ? Math.round(((goodsMinor + s.freight_minor) * s.insurance_ppm) / 1_000_000) : 0;
  const costs: LandedCost[] = [
    { kind: "flete", amount_clp: toPesos(s.freight_minor) }, { kind: "seguro", amount_clp: toPesos(insuranceMinor) },
    { kind: "agente_aduana", amount_clp: plat ? 0 : s.agent_clp }, { kind: "gastos_portuarios", amount_clp: s.mode === "agente" ? s.port_clp : 0 },
    { kind: "transporte_interno", amount_clp: s.inland_clp }, { kind: "gastos_bancarios", amount_clp: plat ? 0 : s.bank_clp }, { kind: "otros", amount_clp: s.other_clp },
    { kind: "iva_importacion", amount_clp: plat && s.vat_charged_clp !== null ? s.vat_charged_clp : 0, recoverable: s.vat_recoverable },
  ].filter((c) => c.amount_clp > 0) as LandedCost[];
  return landedCost({
    currency_decimals: d, rate_e6: rate, basis: "valor", vat_ppm: s.vat_ppm, vat_recoverable: s.vat_recoverable,
    notional_insurance_ppm: !plat && s.insurance_mode === "teorico" ? s.notional_ppm : null, items: li, costs,
  });
}

/** Valor de la compra en centavos de dólar (mercadería + flete), para comparar con los límites. */
function valueUsdCents(items: Item[], s: Scenario, currency: PriceCurrency): number | null {
  const goods = items.reduce((a, i) => a + Math.round(((parseQty(i.qty) ?? 0) * (i.price ?? 0)) / 1000), 0) + s.freight_minor;
  if (currency === "USD") return goods;
  if (!s.rate_e6) return null;
  return Math.round((goods * 100 * 1_000_000) / s.rate_e6);
}

function limitWarnings(s: Scenario, usdCents: number | null, limits: Limits): { tone: "warning" | "info"; text: string }[] {
  const out: { tone: "warning" | "info"; text: string }[] = [];
  if (usdCents === null) return out;
  const usd = (c: number) => formatMoney(c, "USD");
  if (s.mode === "plataforma" && limits.platform_cents !== null && usdCents > limits.platform_cents)
    out.push({ tone: "warning", text: `La compra (${usd(usdCents)}) supera ${usd(limits.platform_cents)}: no se trata como compra de bajo valor por plataforma. Pasa por aduana con arancel e IVA; simúlala como Courier o Con agente.` });
  if (s.mode === "courier" && limits.courier_cents !== null && usdCents > limits.courier_cents)
    out.push({ tone: "warning", text: `La compra (${usd(usdCents)}) supera ${usd(limits.courier_cents)}, el máximo del despacho simplificado por courier: necesitas un agente de aduana (DIN).` });
  if (s.mode === "agente" && s.transport !== "courier" && limits.cargo_no_agent_cents !== null && usdCents <= limits.cargo_no_agent_cents)
    out.push({ tone: "info", text: `Por ${usd(usdCents)} puedes despachar la carga sin agente con la declaración simplificada (hasta ${usd(limits.cargo_no_agent_cents)}).` });
  if (s.mode === "agente" && limits.courier_cents !== null && usdCents <= limits.courier_cents)
    out.push({ tone: "info", text: `Por ${usd(usdCents)} también puedes traerlo por courier sin agente (hasta ${usd(limits.courier_cents)}). Compara el escenario Courier.` });
  return out;
}

export function ImportCalculator() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [currency, setCurrency] = useState<PriceCurrency>("USD");
  const [margin, setMargin] = useState<number | null>(350_000);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [active, setActive] = useState(0);
  const [hasRules, setHasRules] = useState(false);
  const [limits, setLimits] = useState<Limits>({ platform_cents: null, courier_cents: null, cargo_no_agent_cents: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const rule = (code: string) => backend.ruleValue(code).catch(() => null);
    Promise.all([
      rule("ARANCEL_GENERAL_PPM"), rule("IVA_TASA_GENERAL_PPM"), rule("SEGURO_TEORICO_PPM"), rule("COMEX_PLATAFORMA_MAX_USD_CENTS"), rule("COMEX_COURIER_MAX_USD_CENTS"), rule("COMEX_CARGA_SIN_AGENTE_MAX_USD_CENTS"),
      backend.currencies().catch(() => []), backend.searchProducts("taladro").catch(() => []),
    ]).then(([d, v, nt, lp, lc, lg, cur, prods]) => {
      setHasRules(!!(d || v));
      setLimits({ platform_cents: lp?.value ?? null, courier_cents: lc?.value ?? null, cargo_no_agent_cents: lg?.value ?? null });
      const usd = cur.find((c) => c.code === "USD")?.last_rate_e6 ?? null;
      const base = { rate_e6: usd, insurance_ppm: 5_000, notional_ppm: nt?.value ?? null, duty_ppm: d?.value ?? null, vat_ppm: v?.value ?? null, vat_recoverable: true, vat_charged_clp: null, bank_clp: 25_000, other_clp: 0 };
      setScenarios([
        { ...base, name: "A · Marítimo", mode: "agente", transport: "maritimo", transit_days: 45, freight_minor: 85_000, insurance_mode: "contratado", agent_clp: 180_000, port_clp: 210_000, inland_clp: 140_000 },
        { ...base, name: "B · Aéreo", mode: "agente", transport: "aereo", transit_days: 7, freight_minor: 240_000, insurance_mode: "contratado", agent_clp: 180_000, port_clp: 95_000, inland_clp: 90_000 },
        { ...base, name: "C · Courier", mode: "courier", transport: "courier", transit_days: 4, freight_minor: 310_000, insurance_mode: "teorico", agent_clp: 25_000, port_clp: 0, inland_clp: 0 },
      ]);
      const p = prods[0];
      setItems(p ? [{ key: ++seq, product_uid: p.uid, description: p.name, qty: "200", price: 2_150 }] : [{ key: ++seq, product_uid: null, description: "Producto de ejemplo", qty: "200", price: 2_150 }]);
    }).catch(() => {});
  }, [backend]);

  const results = useMemo(() => scenarios.map((s) => compute(items, s, currency)), [scenarios, items, currency]);
  const s = scenarios[active];
  const res = results[active];
  const cheapest = results.length ? results.reduce((best, x, i) => (x.landed_clp < results[best]!.landed_clp ? i : best), 0) : -1;
  const upd = (patch: Partial<Scenario>) => setScenarios((xs) => xs.map((x, i) => (i === active ? { ...x, ...patch } : x)));
  const updItem = (key: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = (p: Product | null, text: string) => { if (p || text) setItems((xs) => [...xs, { key: ++seq, product_uid: p?.uid ?? null, description: p?.name ?? text, qty: "1", price: null }]); };
  const setMode = (mode: Mode) => upd(mode === "plataforma"
    ? { mode, transport: "courier", vat_recoverable: false, insurance_mode: "ninguno" }
    : mode === "courier" ? { mode, transport: "courier", insurance_mode: s?.insurance_mode === "ninguno" ? "teorico" : s?.insurance_mode, port_clp: 0 }
    : { mode, insurance_mode: s?.insurance_mode === "ninguno" ? "contratado" : s?.insurance_mode });
  const changeCurrency = (c: PriceCurrency) => {
    if (c === currency) return;
    // Convierte precios y fletes con el tipo de cambio de cada escenario para no perder lo ingresado.
    const r = scenarios[active]?.rate_e6;
    const conv = (minor: number) => (!r ? minor : c === "CLP" ? Math.round((minor * r) / 100 / 1_000_000) : Math.round((minor * 100 * 1_000_000) / r));
    setItems((xs) => xs.map((x) => ({ ...x, price: x.price === null ? null : conv(x.price) })));
    setScenarios((xs) => xs.map((x) => ({ ...x, freight_minor: conv(x.freight_minor) })));
    setCurrency(c);
  };

  async function createImport() {
    if (!s || !res) return;
    setBusy(true);
    try {
      const plat = s.mode === "plataforma";
      let d = await backend.saveImport({
        supplier_uid: null, incoterm: plat ? null : "FOB", transport_mode: s.transport, origin_country: null, origin_port: null, destination_port: null,
        currency_code: currency, rate_e6: currency === "CLP" ? null : s.rate_e6, purchase_date: null, production_eta: null, shipment_date: null, eta: null, arrival_date: null,
        allocation_basis: "valor", vat_ppm: s.vat_ppm, vat_recoverable: s.vat_recoverable,
        notional_insurance_ppm: !plat && s.insurance_mode === "teorico" ? s.notional_ppm : null,
        notes: `Creada desde la calculadora · escenario ${s.name} (${MODE_LABEL[s.mode].toLowerCase()})`,
        items: items.map((i) => ({ product_uid: i.product_uid, description: i.description, qty_milli: parseQty(i.qty) ?? 0, unit_price_minor: i.price ?? 0, weight_g: null, volume_cm3: null, duty_ppm: plat ? 0 : s.duty_ppm, hs_code: null })),
      });
      const est = (kind: "flete" | "seguro" | "agente_aduana" | "gastos_portuarios" | "transporte_interno" | "gastos_bancarios" | "otros" | "iva_importacion", amount: number, cur = "CLP", description: string | null = null) => ({
        kind, description, supplier_uid: null, currency_code: cur, amount_minor: amount, rate_e6: null, is_estimate: true, recoverable_tax: kind === "iva_importacion" && s.vat_recoverable,
        allocation_basis: null, document_ref: null, cost_date: null, payment: null, due_date: null, paid_method: null, paid_account_uid: null,
      });
      const list = [est("flete", s.freight_minor, currency, plat ? "Envío cobrado por la plataforma" : null), est("seguro", res.insurance_clp),
        est("agente_aduana", plat ? 0 : s.agent_clp, "CLP", s.mode === "courier" ? "Cargo del courier por el trámite" : null),
        est("gastos_portuarios", s.mode === "agente" ? s.port_clp : 0), est("transporte_interno", s.inland_clp), est("gastos_bancarios", plat ? 0 : s.bank_clp), est("otros", s.other_clp, "CLP", plat ? "Cargos de la plataforma" : null),
        est("iva_importacion", plat ? s.vat_charged_clp ?? 0 : 0, "CLP", "IVA cobrado por la plataforma"),
      ].filter((c) => c.amount_minor > 0);
      for (const c of list) d = await backend.addImportCost(d.uid, c);
      toast("success", `${d.number} creada como cotización con los costos estimados del escenario.`);
      navigate(`/comex/importacion/${d.uid}`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  if (!s || !res) return <p className="text-sm text-muted">Cargando…</p>;
  const plat = s.mode === "plataforma";
  const warnings = limitWarnings(s, valueUsdCents(items, s, currency), limits);
  const priceLabel = plat ? "Precio unitario" : "FOB unitario";
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info" icon={Info} title="Los porcentajes son tuyos">
        Arancel, IVA, seguro teórico y los límites de cada modalidad se ingresan según tu operación.{" "}
        {hasRules ? "Se proponen valores ilustrativos de demostración." : "No hay un paquete normativo cargado: escribe los porcentajes que te indicó tu agente de aduana."}
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
          <Card title="Mercadería" actions={<Segmented label="Moneda de los precios" value={currency} onChange={changeCurrency} options={[{ value: "USD", label: "USD" }, { value: "CLP", label: "CLP" }]} />} padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2">Producto</th><th className="w-24 px-2 text-right">Cantidad</th><th className="w-36 px-2 text-right">{priceLabel}</th><th className="w-10" /></tr></thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.key} className="border-b border-line">
                      <td className="px-4 py-1.5"><input aria-label="Producto" value={it.description} onChange={(e) => updItem(it.key, { description: e.target.value })} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 hover:border-line focus:border-accent focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><input aria-label={`Cantidad de ${it.description}`} inputMode="decimal" value={it.qty} onChange={(e) => updItem(it.key, { qty: e.target.value })} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><MoneyField aria-label={`${priceLabel} de ${it.description}`} currency={currency} value={it.price} onValue={(v) => updItem(it.key, { price: v })} /></td>
                      <td><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3"><ProductPicker onPick={add} /></div>
          </Card>

          <Card title={`Escenario ${s.name}`}>
            <div className="mb-4 flex flex-col gap-2">
              <Segmented label="Cómo llega" value={s.mode} onChange={setMode} options={(Object.keys(MODE_LABEL) as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
              <p className="text-xs text-muted">{MODE_HINT[s.mode]}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Nombre" value={s.name} onChange={(e) => upd({ name: e.target.value })} />
              {!plat && <Select label="Transporte" value={s.transport} onChange={(e) => upd({ transport: e.target.value as TransportMode })} options={(Object.keys(TRANSPORT) as TransportMode[]).map((v) => ({ value: v, label: TRANSPORT[v].label }))} />}
              <Field label="Días hasta tu bodega" inputMode="numeric" value={s.transit_days} onChange={(e) => upd({ transit_days: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <RateField rate={s.rate_e6} onRate={(v) => upd({ rate_e6: v })} currency="USD"
                label={currency === "CLP" ? "Dólar (CLP por USD)" : undefined} hint={currency === "CLP" ? "Solo para comparar con los límites en dólares" : undefined} />
              <MoneyField label={plat ? `Envío cobrado (${currency})` : `Flete internacional (${currency})`} currency={currency} value={s.freight_minor} onValue={(v) => upd({ freight_minor: v ?? 0 })}
                hint={plat ? "El que muestra el resumen de compra (0 si es gratis)" : undefined} />
              {!plat && (
                <Select label="Seguro" value={s.insurance_mode} onChange={(e) => upd({ insurance_mode: e.target.value as InsuranceMode })}
                  options={[{ value: "contratado", label: "Contratado (es costo)" }, { value: "teorico", label: "Sin seguro: seguro teórico" }, { value: "ninguno", label: "No considerar" }]}
                  hint={s.insurance_mode === "teorico" ? "Solo para el valor aduanero: no se paga" : undefined} />
              )}
              {!plat && s.insurance_mode === "contratado" && <PercentField label="Seguro (% de FOB + flete)" ppm={s.insurance_ppm} onPpm={(v) => upd({ insurance_ppm: v })} />}
              {!plat && s.insurance_mode === "teorico" && <PercentField label="Seguro teórico (% del FOB)" ppm={s.notional_ppm} onPpm={(v) => upd({ notional_ppm: v })} hint="El que declara tu agente si no tomaste seguro" />}
              {!plat && <PercentField label="Arancel (% sobre CIF)" ppm={s.duty_ppm} onPpm={(v) => upd({ duty_ppm: v })} hint="Según la clasificación. Con certificado de origen de un TLC puede ser 0 %" />}
              <PercentField label={plat ? "IVA que cobra la plataforma (%)" : "IVA de importación (%)"} ppm={s.vat_ppm} onPpm={(v) => upd({ vat_ppm: v })} hint={hasRules ? "Valor de demostración" : "Ingresa el porcentaje vigente"} />
              {plat && <MoneyField label="IVA cobrado en el resumen ($)" value={s.vat_charged_clp} onValue={(v) => upd({ vat_charged_clp: v })}
                hint="Si la plataforma muestra otro monto (descuentos, cupones), escríbelo: reemplaza el cálculo" />}
              <div className="flex items-end pb-2"><Checkbox label="Recupero el IVA como crédito" hint={plat ? "Con boleta normalmente no; confírmalo con tu contador" : "Si lo recuperas, no suma al costo"} checked={s.vat_recoverable} onChange={(v) => upd({ vat_recoverable: v })} /></div>
            </div>
            <h3 className="mb-1 mt-6 text-sm font-semibold text-ink">Gastos en Chile (CLP)</h3>
            <p className="mb-3 text-xs text-muted">Si recuperas el IVA, ingresa los servicios sin IVA (neto): el IVA de esas facturas es crédito.</p>
            <div className="grid gap-4 md:grid-cols-3">
              {s.mode === "agente" && <MoneyField label="Agente de aduana" value={s.agent_clp} onValue={(v) => upd({ agent_clp: v ?? 0 })} hint="Honorarios, gastos de despacho, EDI" />}
              {s.mode === "courier" && <MoneyField label="Cargo del courier por el trámite" value={s.agent_clp} onValue={(v) => upd({ agent_clp: v ?? 0 })} hint="Desaduanaje, manejo, entrega" />}
              {s.mode === "agente" && <MoneyField label="Gastos portuarios y almacenaje" value={s.port_clp} onValue={(v) => upd({ port_clp: v ?? 0 })} />}
              <MoneyField label="Transporte a tu bodega" value={s.inland_clp} onValue={(v) => upd({ inland_clp: v ?? 0 })} />
              {!plat && <MoneyField label="Gastos bancarios" value={s.bank_clp} onValue={(v) => upd({ bank_clp: v ?? 0 })} />}
              <MoneyField label={plat ? "Otros cargos de la plataforma" : "Otros"} value={s.other_clp} onValue={(v) => upd({ other_clp: v ?? 0 })} hint={plat ? "Garantía de envío, cargos por servicio" : undefined} />
            </div>
          </Card>
        </div>

        <aside className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
          <Card title="Costo puesto en bodega" actions={can("comex.editar") && <Button size="sm" variant="secondary" icon={FolderPlus} onClick={createImport} disabled={busy || !items.length}>Crear importación</Button>}>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">{plat ? "Productos" : "FOB"}</dt><dd className="num">{formatMoney(res.fob_minor, currency)}</dd></div>
              {currency !== "CLP" && <div className="flex justify-between"><dt className="text-muted">En pesos</dt><dd className="num">{formatMoney(res.fob_clp)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">{plat ? "+ Envío" : "+ Flete y seguro"}</dt><dd className="num">{formatMoney(res.freight_clp + res.insurance_clp)}</dd></div>
              {res.notional_insurance_clp > 0 && <div className="flex justify-between"><dt className="text-muted">+ Seguro teórico (solo aduana)</dt><dd className="num">{formatMoney(res.notional_insurance_clp)}</dd></div>}
              <div className="flex justify-between font-medium"><dt>{plat ? "= Base del IVA" : "= Valor aduanero (CIF)"}</dt><dd className="num">{formatMoney(res.customs_value_clp)}</dd></div>
              {!plat && <div className="flex justify-between"><dt className="text-muted">+ Arancel</dt><dd className="num">{formatMoney(res.duty_clp)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">{plat ? `+ IVA cobrado al pagar${res.vat_entered ? " (del resumen)" : ""}` : "IVA importación"}</dt><dd className={cx("num", s.vat_recoverable && "text-faint line-through")}>{formatMoney(res.vat_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">+ Gastos en Chile</dt><dd className="num">{formatMoney(res.local_clp)}</dd></div>
              {res.notional_insurance_clp > 0 && <div className="flex justify-between"><dt className="text-muted">− Seguro teórico (no se paga)</dt><dd className="num">{formatMoney(res.notional_insurance_clp)}</dd></div>}
              <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Costo total</dt><dd className="num text-xl font-semibold">{formatMoney(res.landed_clp)}</dd></div>
            </dl>
            {s.vat_recoverable && res.vat_clp > 0 && <p className="mt-2 text-xs text-muted">El IVA ({formatMoney(res.vat_clp)}) igual se paga, pero lo recuperas como crédito: no suma al costo.</p>}
            {res.notes.map((n) => <p key={n} className="mt-1 text-xs text-warning">{n}</p>)}
            {warnings.map((w) => (
              <p key={w.text} className={cx("mt-2 flex gap-1.5 text-xs", w.tone === "warning" ? "text-warning" : "text-muted")}>
                {w.tone === "warning" ? <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> : <Info size={14} className="mt-px shrink-0" aria-hidden />}{w.text}
              </p>
            ))}
            {limits.platform_cents === null && limits.courier_cents === null && <p className="mt-2 text-xs text-muted">Verifica con tu agente los montos máximos de compra por plataforma y por courier.</p>}
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
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-5 py-2.5">Escenario</th><th>Cómo llega</th><th className="text-right">Días</th><th className="text-right">Valor aduanero</th><th className="text-right">Arancel</th><th className="text-right">Gastos Chile</th><th className="px-5 text-right">Costo total</th><th className="px-5 text-right">vs. más barato</th></tr></thead>
            <tbody>
              {scenarios.map((x, i) => {
                const rr = results[i]!;
                const diff = rr.landed_clp - results[cheapest]!.landed_clp;
                const warn = limitWarnings(x, valueUsdCents(items, x, currency), limits).some((w) => w.tone === "warning");
                return (
                  <tr key={i} className={cx("border-b border-line last:border-0", i === active && "bg-accent-soft/50")}>
                    <td className="px-5 py-2.5 font-medium">{x.name}</td>
                    <td className="text-muted"><span className="inline-flex items-center gap-1">{MODE_LABEL[x.mode]}{warn && <AlertTriangle size={13} className="text-warning" aria-label="Supera el límite de la modalidad" />}</span></td>
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
