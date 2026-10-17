// Inicio: Dashboard del dueño (Blueprint §19.14). Responde "¿cómo va mi negocio?" en menos de 30
// segundos: HOY, ESTE MES y REQUIERE TU ATENCIÓN. Cada cifra abre su detalle.
import { useEffect, useState } from "react";
import {
  Banknote, CalendarClock, FilePlus2, HandCoins, Landmark, Percent, Plus, Receipt, Settings2, ShoppingCart,
  TrendingDown, TrendingUp, UserPlus, Users, Wallet,
} from "lucide-react";
import { useBackend, errorMessage, type Dashboard as Data, type SessionInfo } from "../data";
import { formatDate, formatMoney, formatMoneyShort, formatMonthShort } from "../lib/format";
import { useTerm } from "../lib/glosario";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { AlertList } from "../shell/AlertList";
import { BarChart } from "../ui/BarChart";
import { Badge, Button, Card, Kpi, Notice, PageHeader, Segmented, Spinner } from "../ui/kit";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

const pct = (ppm: number) => `${(ppm / 10_000).toFixed(1).replace(".", ",")} %`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function Dashboard({ session }: { session: SessionInfo }) {
  const backend = useBackend();
  const { can } = useSession();
  const t = useTerm();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chart, setChart] = useState<"ventas" | "margen">("ventas");

  useEffect(() => { backend.dashboard().then(setD).catch((e) => setErr(errorMessage(e))); }, [backend]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <Spinner label="Calculando tu resumen…" />;

  const costs = can("costos.ver");
  const money = can("dinero.ver");
  const day = new Date().getDate();
  const vsPrev = d.month_prev_same_minor > 0 ? Math.round(((d.month_sales_minor - d.month_prev_same_minor) * 1_000_000) / d.month_prev_same_minor) : null;

  return (
    <div className="anim-in">
      <PageHeader
        title={greeting()}
        subtitle={`Así va ${session.company.name} hoy, ${new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}.`}
        actions={
          <>
            <Button icon={Plus} onClick={() => navigate("/ventas/nueva")}>Nueva venta</Button>
            <Button variant="secondary" icon={FilePlus2} onClick={() => navigate("/cotizaciones/nueva")}>Nueva cotización</Button>
            <Button variant="secondary" icon={HandCoins} onClick={() => navigate("/ventas?tab=por_cobrar")}>Registrar un cobro</Button>
            <Button variant="ghost" icon={UserPlus} onClick={() => navigate("/clientes?nuevo=1")}>Nuevo cliente</Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <Section title="Hoy">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={Receipt} label="Ventas" value={formatMoney(d.today_sales_minor)} hint={`${d.today_sales_count} ${d.today_sales_count === 1 ? "venta" : "ventas"}`} onClick={() => navigate("/ventas")} />
              {costs && <Kpi icon={Landmark} label="Utilidad" value={formatMoney(d.today_profit_minor)} tone={d.today_profit_minor < 0 ? "danger" : undefined} hint="Estimada: venta neta − costo de lo vendido" />}
              <Kpi icon={Users} label="Clientes" value={d.today_customers} hint={d.today_customers === 1 ? "1 cliente compró hoy" : `${d.today_customers} clientes compraron hoy`} onClick={() => navigate("/clientes")} />
              {money && <Kpi icon={Wallet} label="Disponible" value={formatMoney(d.cash_minor)} hint="Dinero en caja y bancos" onClick={() => navigate("/dinero")} />}
            </div>
          </Section>

          <Section title="Este mes">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={vsPrev !== null && vsPrev < 0 ? TrendingDown : TrendingUp} label="Ventas" value={formatMoney(d.month_sales_minor)}
                tone={vsPrev === null ? undefined : vsPrev >= 0 ? "success" : "warning"}
                hint={vsPrev === null ? `${day} ${day === 1 ? "día" : "días"} del mes` : `${vsPrev >= 0 ? "▲" : "▼"} ${pct(Math.abs(vsPrev))} vs. el mes anterior a esta fecha (${formatMoneyShort(d.month_prev_same_minor)})`}
                onClick={() => navigate("/analisis?r=ventas_periodo")} />
              {can("compras.ver") && <Kpi icon={ShoppingCart} label="Compras" value={formatMoney(d.month_purchases_minor)} hint="Neto, documentos registrados" onClick={() => navigate("/compras")} />}
              {money && <Kpi icon={Banknote} label="Gastos" value={formatMoney(d.month_expenses_minor)} hint="Neto, sin IVA" onClick={() => navigate("/gastos")} />}
              {costs && <Kpi icon={Landmark} label="Utilidad" value={formatMoney(d.month_profit_minor)} tone={d.month_profit_minor < 0 ? "danger" : "success"} hint="Estimada: ventas − costo − gastos" onClick={() => navigate("/analisis?r=utilidad")} />}
              {costs && d.month_margin_ppm !== null && <Kpi icon={Percent} label="Margen" value={pct(d.month_margin_ppm)} tone={d.month_margin_ppm < 0 ? "danger" : undefined} hint={`De cada $100 vendidos te quedan $${Math.round(d.month_margin_ppm / 10_000)} antes de gastos`} onClick={() => navigate("/analisis?tab=productos")} />}
              {money && (
                <Kpi icon={HandCoins} label="Te deben" value={formatMoney(d.receivable_minor)} tone={d.receivable_overdue_minor > 0 ? "warning" : undefined}
                  hint={d.receivable_overdue_minor > 0 ? `${formatMoney(d.receivable_overdue_minor)} ${t("vencido").toLowerCase()}` : "Todo al día"} onClick={() => navigate("/dinero?tab=por_cobrar")} />
              )}
              {money && <Kpi icon={Banknote} label="Debes" value={formatMoney(d.payable_minor)} hint="A proveedores y en gastos" onClick={() => navigate("/dinero?tab=por_pagar")} />}
              {d.tax_estimate_minor !== null && <Kpi icon={Receipt} label="IVA estimado" value={formatMoney(d.tax_estimate_minor)} hint="Solo referencia: NÚCLEO no declara impuestos" onClick={() => navigate("/contabilidad")} />}
            </div>
          </Section>

          <Section title="Últimos 12 meses">
            <Card title={chart === "ventas" ? "Ventas por mes" : "Margen por mes"} subtitle={chart === "ventas" ? "Montos totales de ventas efectuadas" : "Venta neta − costo de lo vendido"}
              actions={costs && <Segmented label="Gráfico" value={chart} onChange={setChart} options={[{ value: "ventas", label: "Ventas" }, { value: "margen", label: "Margen" }]} />}>
              <BarChart
                title={chart === "ventas" ? "Ventas de los últimos 12 meses" : "Margen de los últimos 12 meses"}
                data={d.series.map((s) => ({ key: s.month, label: formatMonthShort(s.month), value: chart === "ventas" ? s.sales_minor : s.margin_minor }))}
                format={(v) => formatMoney(v)}
                formatAxis={(v) => formatMoneyShort(v)}
              />
            </Card>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Requiere tu atención" subtitle={d.alerts.length ? `${d.alerts.length} ${d.alerts.length === 1 ? "aviso" : "avisos"}, de lo más urgente a lo informativo` : undefined}
            actions={can("config.editar") && <button className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline" onClick={() => navigate("/config/alertas")}><Settings2 size={15} aria-hidden /> Reglas</button>}>
            <AlertList alerts={d.alerts} />
          </Card>

          {money && (
            <Card title="Próximos cobros y pagos" actions={<button className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline" onClick={() => navigate("/dinero?tab=calendario")}><CalendarClock size={15} aria-hidden /> Calendario</button>}>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {d.upcoming_payments.length === 0 && <li className="text-muted">Sin cobros ni pagos por vencer.</li>}
                {d.upcoming_payments.map((u, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ink">{u.label}</div>
                      <div className="text-[13px] text-muted">{formatDate(u.date)}</div>
                    </div>
                    <div className="text-right">
                      <div className="num font-medium text-ink">{formatMoney(u.amount_minor)}</div>
                      <Badge tone={u.kind === "cobro" ? "success" : "neutral"}>{u.kind === "cobro" ? "Te pagan" : "Pagas"}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
