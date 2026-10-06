// Calculadora de exportación: ingreso en moneda extranjera, costo de la mercadería (costo promedio),
// costos de exportar, utilidad, margen y punto de equilibrio. Mismo cálculo que nucleo-domain.
import { useEffect, useMemo, useState } from "react";
import { Info, Plus, Trash2 } from "lucide-react";
import { useBackend, type CurrencyRow, type Product } from "../../data";
import { exportMargin } from "../../data/comex";
import { formatMoney, formatPpm, formatQty, parseQty } from "../../lib/format";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Button, Card, cx, Field, IconButton, Notice, Select } from "../../ui/kit";
import { ProductPicker } from "../ventas/pickers";
import { RateField } from "./common";

interface Line { key: number; description: string; qty: string; price: number | null; cost_e4: number }
interface Cost { key: number; label: string; amount: number | null }
let seq = 0;

export function ExportCalculator() {
  const backend = useBackend();
  const { can } = useSession();
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState<number | null>(null);
  const [incoterm, setIncoterm] = useState("FOB");
  const [lines, setLines] = useState<Line[]>([]);
  const [costs, setCosts] = useState<Cost[]>([
    { key: ++seq, label: "Transporte al puerto o aeropuerto", amount: 180_000 },
    { key: ++seq, label: "Agente de aduana y documentos", amount: 150_000 },
    { key: ++seq, label: "Gastos bancarios", amount: 25_000 },
  ]);
  useEffect(() => {
    backend.currencies().then((c) => { setCurrencies(c); setRate((r) => r ?? c.find((x) => x.code === "USD")?.last_rate_e6 ?? null); }).catch(() => {});
  }, [backend]);
  const decimals = currencies.find((c) => c.code === currency)?.decimals ?? 2;
  const res = useMemo(() => exportMargin({
    currency_decimals: decimals, rate_e6: rate ?? 0,
    items: lines.map((l) => ({ qty_milli: parseQty(l.qty) ?? 0, unit_price_minor: l.price ?? 0, unit_cost_e4: l.cost_e4 })),
    costs_clp: costs.map((c) => c.amount ?? 0),
  }), [lines, costs, rate, decimals]);
  const showCost = can("costos.ver");
  const add = (p: Product | null, text: string) => { if (p || text) setLines((xs) => [...xs, { key: ++seq, description: p?.name ?? text, qty: "1", price: null, cost_e4: p?.cost_e4 ?? 0 }]); };
  const totalQty = lines.reduce((a, l) => a + (parseQty(l.qty) ?? 0), 0);
  const beUnit = lines.length === 1 && totalQty > 0 && rate ? Math.ceil(((res.goods_cost_clp + res.costs_clp) * 1000 / totalQty) / (rate / 1_000_000) * 10 ** decimals) : null;

  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info" icon={Info} title="Simulación de rentabilidad">
        Calcula si te conviene exportar con el costo promedio de tus productos. No emite documentos de exportación. El tratamiento del IVA de las exportaciones
        (venta exenta y recuperación del IVA de compras) está pendiente de revisión con un contador antes de incorporarlo.
      </Notice>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Venta al exterior">
            <div className="grid gap-4 md:grid-cols-3">
              <Select label="Moneda de la venta" value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(currencies.find((c) => c.code === e.target.value)?.last_rate_e6 ?? rate); }}
                options={(currencies.length ? currencies.filter((c) => c.code !== "CLP").map((c) => c.code) : ["USD"]).map((c) => ({ value: c, label: c }))} />
              <RateField rate={rate} onRate={setRate} currency={currency} />
              <Select label="Incoterm de la venta" value={incoterm} onChange={(e) => setIncoterm(e.target.value)} options={["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DDP"].map((c) => ({ value: c, label: c }))}
                hint={["EXW", "FCA", "FOB"].includes(incoterm) ? "El flete internacional lo paga tu cliente" : "Incluye en los costos el flete y seguro que pagas tú"} />
            </div>
          </Card>
          <Card title="Productos" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-4 py-2">Producto</th><th className="w-24 px-2 text-right">Cantidad</th><th className="w-36 px-2 text-right">Precio ({currency})</th>{showCost && <th className="w-28 px-2 text-right">Costo unit.</th>}<th className="w-10" /></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="border-b border-line">
                      <td className="px-4 py-1.5 text-ink">{l.description}</td>
                      <td className="px-2 py-1.5"><input aria-label={`Cantidad de ${l.description}`} inputMode="decimal" value={l.qty} onChange={(e) => setLines((xs) => xs.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} className="num h-8 w-full rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" /></td>
                      <td className="px-2 py-1.5"><MoneyField aria-label={`Precio de ${l.description}`} currency={currency} value={l.price} onValue={(v) => setLines((xs) => xs.map((x) => (x.key === l.key ? { ...x, price: v } : x)))} /></td>
                      {showCost && <td className="num px-2 text-right text-muted">{formatMoney(Math.round(l.cost_e4 / 10_000))}</td>}
                      <td><IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setLines((xs) => xs.filter((x) => x.key !== l.key))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3"><ProductPicker onPick={add} /></div>
          </Card>
          <Card title="Costos de exportar (en pesos)" actions={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setCosts((xs) => [...xs, { key: ++seq, label: "Otro costo", amount: null }])}>Agregar</Button>}>
            <div className="flex flex-col gap-3">
              {costs.map((c) => (
                <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_10rem_auto] items-end gap-3">
                  <Field label="Concepto" value={c.label} onChange={(e) => setCosts((xs) => xs.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)))} />
                  <MoneyField label="Monto" value={c.amount} onValue={(v) => setCosts((xs) => xs.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} />
                  <IconButton icon={Trash2} label="Quitar" size={15} onClick={() => setCosts((xs) => xs.filter((x) => x.key !== c.key))} />
                </div>
              ))}
            </div>
          </Card>
        </div>
        <aside className="flex flex-col gap-6 xl:sticky xl:top-4 xl:self-start">
          <Card title="Resultado">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Venta</dt><dd className="num">{formatMoney(res.revenue_minor, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Venta en pesos</dt><dd className="num">{formatMoney(res.revenue_clp)}</dd></div>
              {showCost && <div className="flex justify-between"><dt className="text-muted">− Costo de la mercadería</dt><dd className="num">{formatMoney(res.goods_cost_clp)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">− Costos de exportar</dt><dd className="num">{formatMoney(res.costs_clp)}</dd></div>
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Utilidad</dt><dd className={cx("num text-xl font-semibold", res.profit_clp < 0 ? "text-danger" : "text-success")}>{formatMoney(res.profit_clp)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Margen sobre la venta</dt><dd className="num">{res.margin_ppm === null ? "—" : formatPpm(res.margin_ppm)}</dd></div>
            </dl>
          </Card>
          <Card title="Punto de equilibrio">
            {res.breakeven_revenue_clp === null ? <p className="text-sm text-muted">{lines.length ? "El precio no cubre el costo de la mercadería: con estos precios no hay punto de equilibrio." : "Agrega productos para calcularlo."}</p> : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-ink">Necesitas vender al menos <strong className="num">{formatMoney(res.breakeven_revenue_clp)}</strong> (con la misma mezcla de productos) para cubrir los costos de exportar.</p>
                {beUnit !== null && <p className="text-muted">Con {formatQty(totalQty)} unidades, el precio mínimo por unidad es <strong className="num text-ink">{formatMoney(beUnit, currency)}</strong>.</p>}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
