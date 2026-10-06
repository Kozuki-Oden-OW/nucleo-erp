// Inicio: Dashboard del dueño (Blueprint §1.6, §19.14). Responde "¿cómo va mi negocio?" en lenguaje simple.
import { useEffect, useState } from "react";
import {
  Banknote, CalendarClock, FilePlus2, FileWarning, HandCoins, Landmark, PackageX, Plus, Receipt,
  TrendingUp, UserPlus, Wallet,
} from "lucide-react";
import { useBackend, errorMessage, type Dashboard as Data, type SessionInfo } from "../data";
import { formatDate, formatMoney, formatMoneyShort, formatMonthShort, formatQty } from "../lib/format";
import { useTerm } from "../lib/glosario";
import { navigate } from "../lib/router";
import { BarChart } from "../ui/BarChart";
import { Badge, Button, Card, Kpi, Notice, PageHeader, Spinner } from "../ui/kit";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

export function Dashboard({ session }: { session: SessionInfo }) {
  const backend = useBackend();
  const t = useTerm();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { backend.dashboard().then(setD).catch((e) => setErr(errorMessage(e))); }, [backend]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <Spinner label="Calculando tu resumen…" />;

  const dayOfMonth = new Date().getDate();

  return (
    <div className="anim-in">
      <PageHeader
        title={`${greeting()}`}
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Receipt} label="Ventas de hoy" value={formatMoney(d.today_sales_minor)} hint={`${d.today_sales_count} ${d.today_sales_count === 1 ? "venta" : "ventas"}`} onClick={() => navigate("/ventas")} />
        <Kpi
          icon={TrendingUp}
          label={t("ventas_mes")}
          value={formatMoney(d.month_sales_minor)}
          hint={`${dayOfMonth} ${dayOfMonth === 1 ? "día" : "días"} · mes anterior completo: ${formatMoneyShort(d.month_prev_sales_minor)}`}
        />
        <Kpi icon={Landmark} label={t("utilidad_mes")} value={formatMoney(d.month_profit_minor)} tone={d.month_profit_minor < 0 ? "danger" : "success"} hint={`Ventas − costo − ${t("gastos_mes").toLowerCase()} (${formatMoneyShort(d.month_expenses_minor)})`} />
        <Kpi icon={Wallet} label={t("disponible")} value={formatMoney(d.cash_minor)} hint="Caja y bancos" onClick={() => navigate("/dinero")} />
        <Kpi
          icon={HandCoins}
          label={t("por_cobrar")}
          value={formatMoney(d.receivable_minor)}
          tone={d.receivable_overdue_minor > 0 ? "warning" : undefined}
          hint={d.receivable_overdue_minor > 0 ? `${formatMoney(d.receivable_overdue_minor)} ${t("vencido").toLowerCase()}` : "Todo al día"}
          onClick={() => navigate("/dinero?tab=por_cobrar")}
        />
        <Kpi icon={Banknote} label={t("por_pagar")} value={formatMoney(d.payable_minor)} hint="Proveedores y gastos" onClick={() => navigate("/dinero?tab=por_pagar")} />
        {d.tax_estimate_minor !== null && (
          <Kpi icon={Receipt} label={t("iva_estimado")} value={formatMoney(d.tax_estimate_minor)} hint="Solo referencia: NÚCLEO no declara impuestos" />
        )}
        <Kpi
          icon={FileWarning}
          label="Pendientes de documentar"
          value={d.pending_documentation}
          tone={d.pending_documentation > 0 ? "warning" : "success"}
          hint={d.pending_documentation > 0 ? "Ventas sin documento tributario anotado" : "Nada pendiente"}
          onClick={() => navigate("/ventas?tab=pendientes_doc")}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Ventas de los últimos 12 meses" subtitle="Montos totales de ventas efectuadas, por mes">
          <BarChart
            title="Ventas de los últimos 12 meses"
            data={d.series.map((s) => ({ key: s.month, label: formatMonthShort(s.month), value: s.sales_minor }))}
            format={(v) => formatMoney(v)}
            formatAxis={(v) => formatMoneyShort(v)}
          />
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Requiere tu atención">
            <ul className="flex flex-col gap-3 text-sm">
              {d.pending_documentation > 0 && (
                <li className="flex items-start gap-3">
                  <FileWarning size={17} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-ink">{d.pending_documentation} ventas pendientes de documentación tributaria</div>
                    <button className="text-[13px] font-medium text-accent hover:underline" onClick={() => navigate("/ventas?tab=pendientes_doc")}>Revisar y marcar</button>
                  </div>
                </li>
              )}
              {d.low_stock.slice(0, 4).map((p) => (
                <li key={p.uid} className="flex items-start gap-3">
                  <PackageX size={17} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">{p.name}</div>
                    <div className="text-[13px] text-muted">Quedan {formatQty(p.on_hand_milli)} · mínimo {formatQty(p.min_milli)}</div>
                  </div>
                </li>
              ))}
              {d.low_stock.length > 4 && (
                <li><button className="text-[13px] font-medium text-accent hover:underline" onClick={() => navigate("/productos?filtro=bajo")}>Ver los {d.low_stock.length} productos con poco stock</button></li>
              )}
              {d.pending_documentation === 0 && d.low_stock.length === 0 && <li className="text-muted">Nada urgente. ¡Buen trabajo!</li>}
            </ul>
          </Card>

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
        </div>
      </div>
    </div>
  );
}
