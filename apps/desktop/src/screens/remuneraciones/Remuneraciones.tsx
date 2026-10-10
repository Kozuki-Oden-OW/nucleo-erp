// Remuneraciones (Fase 10, hito B): liquidaciones del mes, personas e indicadores del mes.
// NÚCLEO prepara la liquidación y explica cada monto; no envía nada a Previred, la DT ni el SII.
// El impuesto único de las liquidaciones emitidas pasa al código 48 del F29 del mes de pago.
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Landmark, UserPlus, Users } from "lucide-react";
import { useBackend, errorMessage, type PayrollView } from "../../data";
import { navigate, type Route } from "../../lib/router";
import { formatDate, formatMoney, formatRut, todayIso } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, EmptyState, Notice, PageHeader, Spinner, Tabs } from "../../ui/kit";
import { MonthPicker, SlipBadge, periodLabel } from "./common";
import { PersonasTab } from "./Personas";
import { IndicadoresTab } from "./Indicadores";
import { PreviredTab } from "./Previred";

type Tab = "liquidaciones" | "previred" | "personas" | "indicadores";

export function Remuneraciones({ route }: { route: Route }) {
  const tab = (route.query.get("tab") as Tab) || "liquidaciones";
  const period = /^\d{4}-\d{2}$/.test(route.query.get("periodo") ?? "") ? route.query.get("periodo")! : todayIso().slice(0, 7);
  const go = (t: Tab, p = period, extra = "") => navigate(`/remuneraciones?tab=${t}&periodo=${p}${extra}`, { replace: true });
  return (
    <div className="anim-in">
      <PageHeader title="Remuneraciones"
        subtitle="Prepara la liquidación de tu sueldo empresarial y la de tus trabajadores, con sus cotizaciones e impuesto único. NÚCLEO no envía nada: te deja todo listo para pagar en Previred y declarar en el F29." />
      {tab !== "personas" && <MonthPicker period={period} onChange={(p) => go(tab, p)} label={tab === "indicadores" ? "Indicadores de" : tab === "previred" ? "Cotizaciones de" : "Remuneraciones de"} />}
      <Tabs value={tab} onChange={(t) => go(t)} tabs={[
        { value: "liquidaciones", label: "Liquidaciones del mes" },
        { value: "previred", label: "Previred y libro" },
        { value: "personas", label: "Personas" },
        { value: "indicadores", label: "Indicadores del mes" },
      ]} />
      <div className="mt-5">
        {tab === "personas" ? <PersonasTab openNew={route.query.get("nueva") === "1"} />
          : tab === "indicadores" ? <IndicadoresTab period={period} />
          : tab === "previred" ? <PreviredTab period={period} />
          : <LiquidacionesTab period={period} onGo={(t, extra) => go(t, period, extra)} />}
      </div>
    </div>
  );
}

function LiquidacionesTab({ period, onGo }: { period: string; onGo: (t: Tab, extra?: string) => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const [view, setView] = useState<PayrollView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); backend.payroll(period).then(setView).catch((e) => setErr(errorMessage(e))); }, [backend, period]);
  useEffect(() => { setView(null); load(); }, [load]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view) return <Spinner />;
  const open = (workerId: number) => navigate(`/remuneraciones/liquidacion/${workerId}?periodo=${period}`);

  if (view.rows.length === 0) {
    return (
      <EmptyState icon={Users} title={`Nadie recibe remuneración en ${periodLabel(period)}`}
        action={can("remuneraciones.editar") && <Button icon={UserPlus} onClick={() => onGo("personas", "&nueva=1")}>Agregar al dueño o a un trabajador</Button>}>
        Si eres socio o dueño y te pagas un sueldo, regístralo como sueldo empresarial: es gasto de la empresa y paga sus cotizaciones e impuesto único como cualquier sueldo.
      </EmptyState>
    );
  }
  const emitted = view.rows.filter((r) => r.status === "emitida");
  return (
    <div className="flex flex-col gap-5">
      {!view.indicators_saved && (
        <Notice tone="warning" title={view.indicators_from ? "Confirma los indicadores de este mes" : "Faltan los indicadores del mes"}>
          {view.indicators_from
            ? `Las liquidaciones se calculan con los indicadores de ${periodLabel(view.indicators_from)}. La UF y la UTM cambian cada mes: revísalos y guárdalos para poder emitir.`
            : "Para calcular cotizaciones e impuesto se necesitan la UF, la UTM, los topes, las tasas de las AFP y la tabla del impuesto único. Se copian una vez al mes desde Previred y el SII."}
          {" "}<button type="button" className="font-medium text-accent hover:underline" onClick={() => onGo("indicadores")}>Ir a los indicadores</button>
        </Notice>
      )}
      <Card padded={false} title={`Liquidaciones de ${periodLabel(period)}`}
        subtitle={`${emitted.length} de ${view.rows.length} emitida(s)${view.voided ? ` · ${view.voided} anulada(s)` : ""}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-medium">Persona</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 text-right font-medium">Total haberes</th>
                <th className="px-3 py-2 text-right font-medium">Impuesto único</th>
                <th className="px-3 py-2 text-right font-medium">Líquido a pagar</th>
                <th className="px-3 py-2 text-right font-medium">Costo empresa</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.worker.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => open(r.worker.id)}>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2 font-medium text-ink">{r.worker.name}{r.worker.is_owner && <Badge tone="accent">Sueldo empresarial</Badge>}</div>
                    <div className="text-xs text-muted">{formatRut(r.worker.rut)}{r.worker.position ? ` · ${r.worker.position}` : ""}</div>
                  </td>
                  <td className="px-3 py-3">
                    <SlipBadge status={r.status} complete={r.complete} />
                    {r.pay_date && <div className="mt-0.5 text-xs text-muted">Pago {formatDate(r.pay_date)}</div>}
                  </td>
                  <td className="num px-3 py-3 text-right">{formatMoney(r.total_earnings)}</td>
                  <td className="num px-3 py-3 text-right">{formatMoney(r.tax)}</td>
                  <td className="num px-3 py-3 text-right font-semibold text-ink">{formatMoney(r.to_pay)}</td>
                  <td className="num px-3 py-3 text-right text-muted">{formatMoney(r.employer_cost)}</td>
                  <td className="px-5 py-3 text-right"><ArrowRight size={16} className="inline text-muted" aria-label="Abrir" /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td className="px-5 py-3" colSpan={3}>Total del mes</td>
                <td className="num px-3 py-3 text-right">{formatMoney(view.total_tax)}</td>
                <td className="num px-3 py-3 text-right">{formatMoney(view.total_to_pay)}</td>
                <td className="num px-3 py-3 text-right text-muted">{formatMoney(view.total_employer_cost)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <Notice tone="info" title="Qué pasa después">
        Al emitir una liquidación eliges la fecha de pago: su impuesto único pasa solo al código 48 del F29 de ese mes.
        Las cotizaciones (AFP, salud, cesantía y los aportes del empleador) se pagan en Previred el mes siguiente: el detalle por institución está en{" "}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => onGo("previred")}>Previred y libro</button>.{" "}
        {can("contabilidad.ver") && <button type="button" className="inline-flex items-center gap-1 font-medium text-accent hover:underline" onClick={() => navigate("/contabilidad?tab=f29")}><Landmark size={14} /> Ver el F29</button>}
      </Notice>
    </div>
  );
}
