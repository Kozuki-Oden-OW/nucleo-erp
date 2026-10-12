// «¿Cuánto necesito vender?»: punto de equilibrio con tus datos (o con cifras estimadas si recién
// empiezas), proyección a 12 meses y reparto de la utilidad entre reserva, reinversión, publicidad,
// inversiones y retiro. Los supuestos se guardan en este computador, por empresa.
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Info, RotateCcw, Scale, ShieldCheck, Target, TrendingUp } from "lucide-react";
import type { ExpenseInsights } from "../../data";
import { DEFAULT_SPLIT, SPLIT_KEYS, SPLIT_LABEL, plan, project, runwayMonths, split, type SplitKey } from "../../data/gastos";
import { formatInt, formatMoney, formatPpm } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Field, Kpi, Notice, Segmented } from "../../ui/kit";
import { GroupedBars, Meter } from "./charts";

interface Assumptions {
  expenses: number | null;
  marginPpm: number | null;
  targetProfit: number;
  daysOpen: number;
  growthPpm: number;
  expenseGrowthPpm: number;
  cushionMonths: number;
  split: Record<SplitKey, number>;
}
const BASE: Assumptions = { expenses: null, marginPpm: null, targetProfit: 0, daysOpen: 26, growthPpm: 0, expenseGrowthPpm: 0, cushionMonths: 3, split: DEFAULT_SPLIT };

function load(key: string): Assumptions {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...BASE, ...(JSON.parse(raw) as Partial<Assumptions>) } : BASE;
  } catch { return BASE; }
}

/** "12,5" → 125000 ppm; admite negativos ("-3"). */
function parsePct(text: string): number | null {
  const clean = text.trim().replace("%", "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  const v = Math.round(Number(clean) * 10_000);
  return Math.abs(v) <= 10_000_000 ? v : null;
}
const pctText = (ppm: number) => String(Math.round(ppm / 1_000) / 10).replace(".", ",");
/** Monto con signo legible: −$5.452.668. */
const signed = (v: number) => (v < 0 ? `−${formatMoney(-v)}` : formatMoney(v));

function PctField({ label, value, onValue, hint }: { label: string; value: number; onValue: (v: number) => void; hint?: string }) {
  const [text, setText] = useState(pctText(value));
  useEffect(() => { setText((t) => (parsePct(t) === value ? t : pctText(value))); }, [value]);
  const bad = parsePct(text) === null;
  return <Field label={label} inputMode="decimal" value={text} suffix="%" hint={hint} error={bad ? "Revisa el porcentaje" : undefined} inputClassName="text-right"
    onChange={(e) => { setText(e.target.value); const v = parsePct(e.target.value); if (v !== null) onValue(v); }} />;
}

export function Equilibrio({ ins, months, onMonths }: { ins: ExpenseInsights; months: number; onMonths: (m: number) => void }) {
  const { session } = useSession();
  const key = `nucleo.gastos.plan.${session.company.uid}`;
  const [a, setA] = useState<Assumptions>(() => load(key));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(a)); } catch { /* sin almacenamiento: los supuestos duran mientras la pantalla esté abierta */ } }, [a, key]);
  const set = (p: Partial<Assumptions>) => setA((x) => ({ ...x, ...p }));

  const expenses = a.expenses ?? ins.avg_expenses_minor;
  const margin = a.marginPpm ?? ins.margin_ppm;
  const simulated = a.expenses !== null || a.marginPpm !== null;
  const p = margin !== null ? plan({ expenses, marginPpm: margin, targetProfit: a.targetProfit, daysOpen: a.daysOpen, avgTicket: ins.avg_ticket_minor, taxPpm: ins.tax_ppm }) : null;
  const sales = ins.avg_sales_minor;
  const coverage = p?.breakEven ? sales / p.breakEven : null;
  const gap = p?.needed != null ? sales - p.needed : null;
  const profitNow = margin !== null ? Math.round((sales * margin) / 1_000_000) - expenses : ins.avg_profit_minor;
  const proj = useMemo(() => margin === null ? [] : project({ sales, marginPpm: margin, expenses, growthPpm: a.growthPpm, expenseGrowthPpm: a.expenseGrowthPpm, cash: ins.cash_minor, months: 12 }),
    [sales, margin, expenses, a.growthPpm, a.expenseGrowthPpm, ins.cash_minor]);
  const yearProfit = proj.reduce((x, m) => x + m.profit, 0);
  const splitPct = SPLIT_KEYS.reduce((x, k) => x + (a.split[k] ?? 0), 0);
  const parts = split(profitNow, a.split);
  const runway = runwayMonths(ins.cash_minor, expenses);
  const cushionGoal = expenses * a.cushionMonths;
  const cushionMissing = Math.max(0, cushionGoal - Math.max(0, ins.cash_minor));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          Con el margen que te dejan tus ventas y lo que gastas al mes, NÚCLEO calcula cuánto necesitas vender para no perder, y cuánto para que además te quede
          la utilidad que quieres. Todo sin IVA, salvo donde se indica.
        </p>
        <Segmented label="Promedio de" value={String(months)} onChange={(v) => onMonths(Number(v))}
          options={[{ value: "3", label: "Últimos 3 meses" }, { value: "6", label: "6 meses" }, { value: "12", label: "12 meses" }]} />
      </div>

      <Card title="Tus números" subtitle={ins.partial ? "Aún no hay un mes completo: se usa lo que va de este mes." : `Promedio de ${ins.months_used} ${ins.months_used === 1 ? "mes completo" : "meses completos"}. Puedes cambiarlos para simular.`}
        actions={simulated && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => set({ expenses: null, marginPpm: null })}>Volver a mis datos</Button>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MoneyField label="Gastos al mes" value={expenses} onValue={(v) => set({ expenses: v })}
            hint={a.expenses === null ? `Fijos ${formatMoney(ins.avg_fixed_minor)} · variables ${formatMoney(ins.avg_variable_minor)}${ins.avg_payroll_minor ? ` · sueldos ${formatMoney(ins.avg_payroll_minor)}` : ""}` : "Simulado"} />
          <PctField label="Margen sobre la venta" value={margin ?? 0} onValue={(v) => set({ marginPpm: v })}
            hint={a.marginPpm === null ? (ins.margin_ppm !== null ? "De tus ventas: (neto − costo) ÷ neto" : "Sin ventas aún: escribe tu margen estimado") : "Simulado"} />
          <MoneyField label="Utilidad que quieres al mes" value={a.targetProfit} onValue={(v) => set({ targetProfit: v ?? 0 })} hint="Tu sueldo, ahorro o meta. Puede ser $0." />
          <Field label="Días que vendes al mes" inputMode="numeric" value={String(a.daysOpen)} inputClassName="text-right"
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1 && n <= 31) set({ daysOpen: Math.round(n) }); }} hint="Ej. 26 de lunes a sábado" />
        </div>
        {ins.recurring_month_minor > 0 && (
          <p className="mt-3 text-xs text-muted">Tus gastos fijos anotados suman {formatMoney(ins.recurring_month_minor)} al mes (con IVA si lo tienen).</p>
        )}
      </Card>

      {margin === null || margin <= 0 || !p?.needed ? (
        <Notice tone="warning" icon={Info} title={margin !== null && margin <= 0 ? "Con margen cero o negativo ninguna venta cubre los gastos" : "Falta el margen"}>
          {margin !== null && margin <= 0 ? "Estás vendiendo al costo o bajo el costo. Revisa precios y costos en Productos." : "Escribe tu margen estimado sobre la venta (por ejemplo 35 %) para calcular cuánto necesitas vender."}
        </Notice>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Scale} label="Para no perder" value={formatMoney(p.breakEven ?? 0)} hint="Venta neta al mes que cubre todos tus gastos" />
            <Kpi icon={Target} label={a.targetProfit > 0 ? "Para tu meta" : "Venta necesaria"} value={formatMoney(p.needed)}
              hint={`Al mes, neto${p.neededWithTax !== p.needed ? ` · ${formatMoney(p.neededWithTax ?? 0)} con IVA` : ""}`} tone="success" />
            <Kpi label="Por semana" value={formatMoney(p.perWeek ?? 0)} hint="Promedio (12 meses ÷ 52 semanas)" />
            <Kpi label="Por día de venta" value={formatMoney(p.perDay ?? 0)}
              hint={p.salesCount !== null ? `≈ ${formatInt(p.salesCount)} ventas al mes de ${formatMoney(ins.avg_ticket_minor ?? 0)}` : `${a.daysOpen} días al mes`} />
          </div>
          <Card title="¿Cómo vas?">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-muted">Vendes en promedio <strong className="num text-ink">{formatMoney(sales)}</strong> al mes{a.targetProfit > 0 && ` · meta ${formatMoney(p.needed)}`}</span>
                {coverage !== null && <span className="num font-semibold text-ink">Cubres el {formatPpm(Math.round(coverage * 1_000_000), 0)} de tus gastos</span>}
              </div>
              <Meter value={sales} max={p.needed} goal label="Venta promedio comparada con la venta necesaria" />
              {gap !== null && (
                <p className={`text-sm ${gap >= 0 ? "text-success" : "text-warning"}`}>
                  {gap >= 0
                    ? `Superas lo necesario por ${formatMoney(gap)} al mes.`
                    : `Te faltan ${formatMoney(-gap)} al mes${p.perDay ? ` (≈ ${formatMoney(Math.ceil(-gap / Math.max(1, a.daysOpen)))} más por día de venta)` : ""}.`}
                </p>
              )}
              <p className="text-xs text-muted">
                Con tu margen de {formatPpm(margin)}, de cada $100.000 vendidos (netos) te quedan {formatMoney(Math.round(100_000 * margin / 1_000_000))} para pagar gastos y ganar.
              </p>
              <Button size="sm" variant="ghost" icon={BarChart3} onClick={() => navigate("/analisis?r=punto_equilibrio")}>Ver el reporte mes a mes</Button>
            </div>
          </Card>
        </>
      )}

      {margin !== null && margin > 0 && (
        <Card title="Proyección a 12 meses" subtitle="Si las ventas y los gastos cambian cada mes en el porcentaje que indiques. Es una estimación de gestión: no considera plazos de cobro ni de pago.">
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <PctField label="Ventas crecen cada mes" value={a.growthPpm} onValue={(v) => set({ growthPpm: v })} hint="Puede ser negativo" />
            <PctField label="Gastos crecen cada mes" value={a.expenseGrowthPpm} onValue={(v) => set({ expenseGrowthPpm: v })} />
            <div className="flex flex-col justify-end gap-1 text-sm">
              <span className="text-muted">Utilidad en 12 meses</span>
              <span className={`num text-[20px] font-semibold ${yearProfit >= 0 ? "text-success" : "text-danger"}`}>{signed(yearProfit)}</span>
              <span className="text-xs text-muted">Dinero estimado al final: {signed(proj.at(-1)?.cash ?? ins.cash_minor)}</span>
            </div>
          </div>
          <GroupedBars caption="Proyección de ventas y utilidad a 12 meses" labels={proj.map((m) => `Mes ${m.n}`)} series={[
            { label: "Ventas netas", color: "var(--chart-1)", values: proj.map((m) => m.sales) },
            { label: "Utilidad del mes", color: "var(--chart-2)", values: proj.map((m) => m.profit) },
          ]} />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="¿Qué hacer con lo que te queda?" subtitle="Reparte la utilidad del mes como tú decidas. Los porcentajes son un ejemplo: cámbialos.">
          {profitNow <= 0 ? (
            <Notice tone="warning" icon={TrendingUp} title="Este mes no queda utilidad para repartir">
              Primero hay que llegar a la venta necesaria. Revisa los gastos más grandes en el Resumen y si tus precios dejan suficiente margen.
            </Notice>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">Utilidad estimada: <strong className="num text-ink">{formatMoney(profitNow)}</strong> al mes</p>
              <ul className="flex flex-col divide-y divide-line">
                {SPLIT_KEYS.map((k) => (
                  <li key={k} className="grid grid-cols-[minmax(0,1fr)_5.5rem_8rem] items-center gap-3 py-2">
                    <div className="min-w-0"><div className="text-sm text-ink">{SPLIT_LABEL[k].label}</div><div className="text-xs text-muted">{SPLIT_LABEL[k].hint}</div></div>
                    <Field aria-label={`Porcentaje para ${SPLIT_LABEL[k].label}`} inputMode="numeric" suffix="%" inputClassName="text-right" value={String(a.split[k] ?? 0)}
                      onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= 100) set({ split: { ...a.split, [k]: Math.round(n) } }); }} />
                    <div className="text-right"><div className="num text-sm font-medium text-ink">{formatMoney(parts[k])}</div><div className="num text-xs text-muted">{formatMoney(parts[k] * 12)} al año</div></div>
                  </li>
                ))}
              </ul>
              {splitPct !== 100 && <Notice tone="warning">Los porcentajes suman {splitPct} %; deberían sumar 100 %.</Notice>}
            </div>
          )}
        </Card>
        <Card title="Tu colchón" subtitle="Cuántos meses de gastos cubre el dinero que tienes hoy en cajas y bancos.">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Dinero disponible</div>
                <div className="num text-[22px] font-semibold text-ink">{formatMoney(ins.cash_minor)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Alcanza para</div>
                <div className="num text-[22px] font-semibold text-ink">{runway === null ? "—" : `${runway.toFixed(1).replace(".", ",")} meses`}</div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Meses de colchón que quieres" inputMode="numeric" value={String(a.cushionMonths)} inputClassName="text-right"
                onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= 36) set({ cushionMonths: Math.round(n) }); }} />
              <div className="flex flex-col justify-end text-sm">
                <span className="text-muted">Meta: <strong className="num text-ink">{formatMoney(cushionGoal)}</strong></span>
                {ins.payables_30d_minor > 0 && <span className="text-xs text-muted">Vence por pagar en 30 días: {formatMoney(ins.payables_30d_minor)}</span>}
              </div>
            </div>
            <Meter value={Math.max(0, ins.cash_minor)} max={cushionGoal || 1} goal label="Dinero disponible comparado con el colchón que quieres" />
            <p className={`flex items-start gap-2 text-sm ${cushionMissing > 0 ? "text-warning" : "text-success"}`}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
              {cushionMissing > 0
                ? `Te faltan ${formatMoney(cushionMissing)} para tu colchón de ${a.cushionMonths} ${a.cushionMonths === 1 ? "mes" : "meses"}. ${
                  profitNow <= 0 ? "Cuando el negocio deje utilidad, la reserva te ayudará a completarlo."
                  : parts.reserva > 0 ? `Con la reserva de ${formatMoney(parts.reserva)} al mes lo completarías en ${Math.ceil(cushionMissing / parts.reserva)} ${Math.ceil(cushionMissing / parts.reserva) === 1 ? "mes" : "meses"}.`
                  : "Asigna un % a la reserva para completarlo."}`
                : "Tu colchón está completo: lo que sobra puede ir a crecer, a publicidad o a otras inversiones, según lo que decidas."}
            </p>
          </div>
        </Card>
      </div>
      <p className="text-xs text-faint">
        Estas cifras son una guía de gestión hecha con tus propios datos. No son asesoría financiera ni tributaria: antes de invertir, consulta con un asesor.
      </p>
    </div>
  );
}
