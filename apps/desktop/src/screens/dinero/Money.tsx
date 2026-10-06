// Dinero: cuánto tienes, cuánto te deben, cuánto debes y cómo viene la caja (Fase 8, Hito C).
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Banknote, CalendarDays, HandCoins, Receipt, Repeat, TrendingUp, Wallet } from "lucide-react";
import { useBackend, errorMessage, type Aging, type CalendarItem, type MoneyOverview } from "../../data";
import { daysBetween, formatDate, formatMoney, todayIso } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, EmptyState, Kpi, Notice, Segmented, Spinner, Tabs } from "../../ui/kit";
import { AccountsTab } from "./Accounts";
import { DueTable, accountLabel } from "./common";
import { ExpensesTab } from "./Expenses";
import { FlowChart } from "./FlowChart";
import { RecurringTab } from "./Recurring";

type Tab = "resumen" | "cuentas" | "gastos" | "por_cobrar" | "por_pagar" | "calendario" | "recurrentes";

export function Money({ route }: { route: Route }) {
  const backend = useBackend();
  const { can } = useSession();
  const t = useTerm();
  const tab = (route.query.get("tab") as Tab) || "resumen";
  const [ov, setOv] = useState<MoneyOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    backend.moneyOverview().then((o) => alive && setOv(o)).catch((e) => alive && setErr(errorMessage(e)));
    return () => { alive = false; };
  }, [backend, version]);
  const setTab = (x: Tab) => navigate(x === "resumen" ? "/dinero" : `/dinero?tab=${x}`, { replace: true });
  const write = can("dinero.registrar");

  return (
    <div className="anim-in">
      <PageHeaderBar write={write} tab={tab} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "cuentas", label: "Cuentas" },
          { value: "gastos", label: "Gastos" },
          { value: "por_cobrar", label: t("por_cobrar"), count: ov?.receivables.length },
          { value: "por_pagar", label: t("por_pagar"), count: ov?.payables.length },
          { value: "calendario", label: "Calendario" },
          { value: "recurrentes", label: "Recurrentes" },
        ]}
      />
      <div className="mt-5">
        {err && <Notice tone="danger">{err}</Notice>}
        {tab === "resumen" && (ov ? <Overview ov={ov} /> : !err && <Spinner label="Calculando tu caja…" />)}
        {tab === "cuentas" && <AccountsTab route={route} onChanged={reload} />}
        {tab === "gastos" && <ExpensesTab route={route} onChanged={reload} />}
        {tab === "por_cobrar" && ov && (
          <DueBlock total={ov.receivable_minor} overdue={ov.receivable_overdue_minor} aging={ov.receivable_aging} kind="cobro">
            <DueTable rows={ov.receivables} kind="cobro" empty={<EmptyState icon={HandCoins} title="Nadie te debe dinero">Las ventas a crédito aparecen aquí hasta que se pagan.</EmptyState>} />
          </DueBlock>
        )}
        {tab === "por_pagar" && ov && (
          <DueBlock total={ov.payable_minor} overdue={ov.payable_overdue_minor} aging={ov.payable_aging} kind="pago">
            <DueTable rows={ov.payables} kind="pago" empty={<EmptyState icon={Banknote} title="No debes nada">Las compras y gastos sin pagar aparecen aquí.</EmptyState>} />
          </DueBlock>
        )}
        {tab === "calendario" && <CalendarTab version={version} />}
        {tab === "recurrentes" && <RecurringTab onChanged={reload} />}
      </div>
    </div>
  );
}

function PageHeaderBar({ write, tab }: { write: boolean; tab: Tab }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">Dinero</h1>
        <p className="mt-1 text-sm text-muted">Cajas y bancos, lo que te deben, lo que debes, tus gastos y cómo viene la caja en las próximas semanas.</p>
      </div>
      {write && (
        <div className="flex flex-wrap items-center gap-2">
          {tab === "cuentas" && <Button variant="secondary" icon={ArrowLeftRight} onClick={() => navigate("/dinero?tab=cuentas&traspaso=1")}>Traspasar</Button>}
          {tab === "recurrentes" && <Button variant="secondary" icon={Repeat} onClick={() => navigate("/dinero?tab=recurrentes&nuevo=1")}>Nuevo recurrente</Button>}
          <Button icon={Receipt} onClick={() => navigate("/dinero?tab=gastos&nuevo=1")}>Registrar gasto</Button>
        </div>
      )}
    </div>
  );
}

function Overview({ ov }: { ov: MoneyOverview }) {
  const t = useTerm();
  const active = ov.accounts.filter((a) => !a.archived);
  // Primera semana en negativo (la alerta) y la más baja (el tamaño del problema).
  const firstNeg = ov.shortfall_week ? ov.projection.find((w) => w.closing_minor < 0) : undefined;
  const lowest = ov.projection.find((w) => w.start === ov.shortfall_week);
  const soon = firstNeg ? daysBetween(ov.today, firstNeg.start) <= 28 : false;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Wallet} label={t("disponible")} value={formatMoney(ov.cash_minor)} hint={`${active.length} ${active.length === 1 ? "cuenta" : "cuentas"}`} tone={ov.cash_minor < 0 ? "danger" : undefined} onClick={() => navigate("/dinero?tab=cuentas", { replace: true })} />
        <Kpi icon={HandCoins} label={t("por_cobrar")} value={formatMoney(ov.receivable_minor)} tone={ov.receivable_overdue_minor > 0 ? "warning" : undefined}
          hint={ov.receivable_overdue_minor > 0 ? `${formatMoney(ov.receivable_overdue_minor)} ${t("vencido").toLowerCase()}` : "Todo al día"} onClick={() => navigate("/dinero?tab=por_cobrar", { replace: true })} />
        <Kpi icon={Banknote} label={t("por_pagar")} value={formatMoney(ov.payable_minor)} tone={ov.payable_overdue_minor > 0 ? "warning" : undefined}
          hint={ov.payable_overdue_minor > 0 ? `${formatMoney(ov.payable_overdue_minor)} ${t("vencido").toLowerCase()}` : "Todo al día"} onClick={() => navigate("/dinero?tab=por_pagar", { replace: true })} />
        <Kpi icon={TrendingUp} label="En 30 días tendrías" value={formatMoney(ov.in30_minor)} tone={ov.in30_minor < 0 ? "danger" : undefined}
          hint={`+${formatMoney(ov.next30_in_minor)} entra · −${formatMoney(ov.next30_out_minor)} sale`} onClick={() => navigate("/dinero?tab=calendario", { replace: true })} />
      </div>
      {firstNeg && lowest && (
        <Notice tone={soon ? "warning" : "info"} icon={AlertTriangle} title={`Desde la semana del ${formatDate(firstNeg.start)} la caja quedaría en negativo`}
          actions={<><Button size="sm" variant="secondary" onClick={() => navigate("/dinero?tab=por_cobrar", { replace: true })}>Ver cobros pendientes</Button><Button size="sm" variant="ghost" onClick={() => navigate("/dinero?tab=calendario", { replace: true })}>Ver calendario</Button></>}>
          Lo más bajo sería {formatMoney(lowest.closing_minor)} la semana del {formatDate(lowest.start)}. Es con lo que ya sabes (cobros, pagos y recurrentes),
          sin contar ventas nuevas: si vendes al contado cada semana, la caja real estará mejor (puedes anotar esas ventas como ingreso recurrente).
        </Notice>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Proyección de caja · 13 semanas" subtitle="Parte de tu saldo de hoy y suma lo que ya sabes: cobros y pagos por vencer (los atrasados cuentan esta semana) y movimientos recurrentes. No supone ventas nuevas.">
          <FlowChart weeks={ov.projection} />
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Tus cuentas" actions={<button className="text-[13px] font-medium text-accent hover:underline" onClick={() => navigate("/dinero?tab=cuentas", { replace: true })}>Ver movimientos</button>}>
            <ul className="flex flex-col divide-y divide-line text-sm">
              {active.map((a) => (
                <li key={a.uid} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 truncate text-ink">{accountLabel(a)}</span>
                  <span className={`num font-medium ${a.balance_minor < 0 ? "text-danger" : "text-ink"}`}>{formatMoney(a.balance_minor)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <AgingCard title="Te deben, por antigüedad" aging={ov.receivable_aging} total={ov.receivable_minor} />
          <AgingCard title="Debes, por antigüedad" aging={ov.payable_aging} total={ov.payable_minor} />
        </div>
      </div>
    </div>
  );
}

const BUCKETS: { key: keyof Aging; label: string; tone: string }[] = [
  { key: "current_minor", label: "Al día", tone: "var(--chart-1)" },
  { key: "d1_30_minor", label: "1–30 días atrasado", tone: "var(--warning)" },
  { key: "d31_60_minor", label: "31–60 días", tone: "var(--warning)" },
  { key: "d61_90_minor", label: "61–90 días", tone: "var(--danger)" },
  { key: "d90_plus_minor", label: "Más de 90 días", tone: "var(--danger)" },
];

function AgingCard({ title, aging, total }: { title: string; aging: Aging; total: number }) {
  return (
    <Card title={title}>
      {total === 0 ? <p className="text-sm text-muted">Nada pendiente.</p> : (
        <ul className="flex flex-col gap-2.5 text-sm">
          {BUCKETS.map((b) => {
            const v = aging[b.key];
            return (
              <li key={b.key}>
                <div className="flex justify-between gap-3"><span className={v ? "text-ink" : "text-muted"}>{b.label}</span><span className="num font-medium">{formatMoney(v)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full" style={{ width: `${(v / total) * 100}%`, background: b.tone }} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DueBlock({ total, overdue, aging, kind, children }: { total: number; overdue: number; aging: Aging; kind: "cobro" | "pago"; children: React.ReactNode }) {
  const late = aging.d1_30_minor + aging.d31_60_minor + aging.d61_90_minor + aging.d90_plus_minor;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>Total {kind === "cobro" ? "por cobrar" : "por pagar"}: <strong className="num text-ink">{formatMoney(total)}</strong></span>
        {overdue > 0 && <span>Atrasado: <strong className="num text-danger">{formatMoney(late)}</strong></span>}
        <span>{kind === "cobro" ? "Para registrar un cobro, abre la venta." : "Para pagar, abre el documento o el gasto."}</span>
      </div>
      {children}
    </div>
  );
}

const CAL_KIND: Record<CalendarItem["kind"], { label: string; tone: "success" | "neutral" | "info" | "warning" }> = {
  cobro: { label: "Te pagan", tone: "success" },
  pago: { label: "Pagas", tone: "neutral" },
  ingreso_recurrente: { label: "Ingreso recurrente", tone: "info" },
  egreso_recurrente: { label: "Pago recurrente", tone: "warning" },
};

function CalendarTab({ version }: { version: number }) {
  const backend = useBackend();
  const [days, setDays] = useState<"30" | "60" | "90">("30");
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { backend.moneyCalendar(Number(days)).then(setItems).catch((e) => setErr(errorMessage(e))); }, [backend, days, version]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  const today = todayIso();
  const groups = new Map<string, CalendarItem[]>();
  for (const it of items ?? []) {
    const k = it.overdue ? "atrasado" : it.date;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const sign = (it: CalendarItem) => (it.kind === "cobro" || it.kind === "ingreso_recurrente" ? 1 : -1);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Período" value={days} onChange={setDays} options={[{ value: "30", label: "30 días" }, { value: "60", label: "60 días" }, { value: "90", label: "90 días" }]} />
        {items && <span className="text-sm text-muted">Entra <strong className="num text-success">{formatMoney(items.filter((i) => sign(i) > 0).reduce((a, i) => a + i.amount_minor, 0))}</strong> · sale <strong className="num text-ink">{formatMoney(items.filter((i) => sign(i) < 0).reduce((a, i) => a + i.amount_minor, 0))}</strong></span>}
      </div>
      {!items ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Sin cobros ni pagos en este período">Las ventas a crédito, las compras por pagar y los recurrentes aparecen aquí.</EmptyState>
      ) : (
        <Card padded={false}>
          <ol className="divide-y divide-line">
            {[...groups.entries()].map(([k, list]) => (
              <li key={k} className="grid gap-2 px-5 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <div className={`text-sm font-semibold ${k === "atrasado" ? "text-danger" : k === today ? "text-accent" : "text-ink"}`}>
                  {k === "atrasado" ? "Atrasado" : k === today ? "Hoy" : formatDate(k)}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {list.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <Badge tone={CAL_KIND[it.kind].tone}>{CAL_KIND[it.kind].label}</Badge>
                      {it.link ? <button className="min-w-0 truncate text-left text-ink hover:text-accent hover:underline" onClick={() => navigate(it.link!)}>{it.label}</button> : <span className="min-w-0 truncate text-ink">{it.label}</span>}
                      <span className="min-w-0 truncate text-muted">{it.party}{k === "atrasado" && ` · venció ${formatDate(it.date)}`}</span>
                      <span className={`num ml-auto font-medium ${sign(it) > 0 ? "text-success" : "text-ink"}`}>{sign(it) > 0 ? "+" : "−"}{formatMoney(it.amount_minor)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted"><Repeat size={12} aria-hidden /> Los pagos recurrentes dejan de aparecer cuando registras el gasto de ese período.</p>
    </div>
  );
}
