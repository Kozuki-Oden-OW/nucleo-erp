// Gastos: anotar todo lo que se gasta (cantidad × valor), verlo por categoría con presupuesto y
// saber cuánto hay que vender para cubrirlo (punto de equilibrio, proyección y reparto de la utilidad).
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, Pencil, PiggyBank, Plus, Receipt, Scale, Wallet, Zap } from "lucide-react";
import { useBackend, errorMessage, type CategoryInput, type ExpenseCategory, type ExpenseInsights } from "../../data";
import { CATEGORY_GROUPS, QUICK_CATEGORIES } from "../../data/gastos";
import { formatMoney, formatMonthShort, formatPpm } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Kpi, Notice, PageHeader, Segmented, Select, Spinner, Tabs } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { ExpensesTab } from "../dinero/Expenses";
import { RecurringTab } from "../dinero/Recurring";
import { GroupedBars, Meter } from "./charts";
import { Equilibrio } from "./Equilibrio";

type Tab = "resumen" | "registro" | "categorias" | "fijos" | "equilibrio";

export function Gastos({ route }: { route: Route }) {
  const backend = useBackend();
  const { can } = useSession();
  const tab = (route.query.get("tab") as Tab) || "resumen";
  const [months, setMonths] = useState(6);
  const [ins, setIns] = useState<ExpenseInsights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    backend.expenseInsights(months).then((x) => alive && setIns(x)).catch((e) => alive && setErr(errorMessage(e)));
    return () => { alive = false; };
  }, [backend, months, version]);
  const setTab = (x: Tab) => navigate(x === "resumen" ? "/gastos" : `/gastos?tab=${x}`, { replace: true });
  const write = can("dinero.registrar");
  return (
    <div className="anim-in">
      <PageHeader title="Gastos"
        subtitle="Anota todo lo que gastas —bencina, comida, viajes, arriendo, estudios— y mira cuánto necesitas vender para cubrirlo."
        actions={write && (
          <>
            {tab === "fijos" && <Button variant="secondary" icon={Plus} onClick={() => navigate("/gastos?tab=fijos&nuevo=1")}>Nuevo gasto fijo</Button>}
            <Button icon={Receipt} onClick={() => navigate("/gastos?tab=registro&nuevo=1")}>Registrar gasto</Button>
          </>
        )} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "resumen", label: "Resumen" },
        { value: "registro", label: "Registro de gastos" },
        { value: "categorias", label: "Categorías y presupuesto" },
        { value: "fijos", label: "Gastos fijos" },
        { value: "equilibrio", label: "¿Cuánto necesito vender?" },
      ]} />
      <div className="mt-5">
        {err && <Notice tone="danger">{err}</Notice>}
        {tab === "resumen" && (ins ? <Resumen ins={ins} write={write} /> : !err && <Spinner label="Sumando tus gastos…" />)}
        {tab === "registro" && <ExpensesTab route={route} onChanged={reload} />}
        {tab === "categorias" && <Categorias ins={ins} write={write} onChanged={reload} />}
        {tab === "fijos" && (
          <div className="flex flex-col gap-4">
            <Notice tone="info" title="Gastos que se repiten">
              Arriendo, sueldos, internet, el plan del celular, una suscripción. Anótalos aquí una vez: NÚCLEO te los recuerda en el calendario de Dinero y los
              usa para proyectar tu caja. Cuando los pagues, regístralos como gasto y elige «¿Es un pago recurrente?».
            </Notice>
            <RecurringTab onChanged={reload} base="/gastos?tab=fijos" />
          </div>
        )}
        {tab === "equilibrio" && (ins ? <Equilibrio ins={ins} months={months} onMonths={setMonths} /> : !err && <Spinner label="Calculando tu punto de equilibrio…" />)}
      </div>
    </div>
  );
}

/* ───────────── Resumen ───────────── */

function Resumen({ ins, write }: { ins: ExpenseInsights; write: boolean }) {
  const thisMonth = ins.categories.reduce((a, c) => a + c.this_month_minor, 0);
  const quick = QUICK_CATEGORIES.map(([name, label]) => ({ label, cat: ins.categories.find((c) => c.name === name) })).filter((q) => q.cat);
  const withBudget = ins.categories.filter((c) => c.budget_minor);
  const over = withBudget.filter((c) => c.this_month_minor > (c.budget_minor ?? 0));
  const spent = ins.categories.filter((c) => c.this_month_minor > 0 || c.budget_minor);
  const byGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of ins.categories) m.set(c.group_name, (m.get(c.group_name) ?? 0) + c.avg_month_minor);
    return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }, [ins]);
  const groupTotal = byGroup.reduce((a, [, v]) => a + v, 0);
  const avgLabel = ins.partial ? "este mes" : ins.months_used === 1 ? "último mes completo" : `promedio de ${ins.months_used} meses`;
  const months = [...ins.months, ...(ins.partial ? [] : [ins.current])];
  return (
    <div className="flex flex-col gap-6">
      {write && quick.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink"><Zap size={15} aria-hidden /> Anotar rápido:</span>
          {quick.map((q) => (
            <button key={q.label} onClick={() => navigate(`/gastos?tab=registro&nuevo=1&cat=${q.cat!.id}`)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink transition-colors hover:border-accent hover:text-accent">
              {q.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Receipt} label="Gastado este mes" value={formatMoney(thisMonth)} hint="Lo registrado, como lo pagaste" onClick={() => navigate("/gastos?tab=registro", { replace: true })} />
        <Kpi icon={Wallet} label="Gastos al mes" value={formatMoney(ins.avg_expenses_minor)}
          hint={`${avgLabel} · fijos ${formatMoney(ins.avg_fixed_minor)}${ins.avg_payroll_minor ? ` · sueldos ${formatMoney(ins.avg_payroll_minor)}` : ""}`} />
        <Kpi icon={Scale} label="Venta necesaria al mes" value={ins.break_even_minor !== null ? formatMoney(ins.break_even_minor) : "—"}
          tone={ins.coverage_ppm !== null ? (ins.coverage_ppm >= 1_000_000 ? "success" : "warning") : undefined}
          hint={ins.break_even_minor !== null && ins.coverage_ppm !== null ? `Vendes ${formatMoney(ins.avg_sales_minor)} · cubres ${formatPpm(ins.coverage_ppm, 0)}` : "Sin ventas aún: simúlala en «¿Cuánto necesito vender?»"}
          onClick={() => navigate("/gastos?tab=equilibrio", { replace: true })} />
        <Kpi icon={PiggyBank} label={ins.avg_profit_minor >= 0 ? "Te queda al mes" : "Pierdes al mes"} value={formatMoney(Math.abs(ins.avg_profit_minor))}
          tone={ins.avg_profit_minor >= 0 ? "success" : "danger"} hint={`Ventas − costo − gastos (${avgLabel})`} />
      </div>
      {over.length > 0 && (
        <Notice tone="warning" icon={AlertTriangle} title={over.length === 1 ? `Te pasaste del presupuesto en ${over[0]!.name}` : `Te pasaste del presupuesto en ${over.length} categorías`}>
          {over.map((c) => `${c.name}: ${formatMoney(c.this_month_minor)} de ${formatMoney(c.budget_minor ?? 0)}`).join(" · ")}
        </Notice>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Mes a mes" subtitle="Ventas netas comparadas con todo lo que sale: costo de lo vendido, gastos y sueldos (sin IVA).">
          {months.length > 0 ? (
            <GroupedBars caption="Ventas y gastos por mes" labels={months.map((m) => formatMonthShort(m.month))} series={[
              { label: "Ventas netas", color: "var(--chart-1)", values: months.map((m) => m.sales_net_minor) },
              { label: "Costo + gastos + sueldos", color: "var(--chart-2)", values: months.map((m) => m.cost_minor + m.fixed_minor + m.variable_minor + m.payroll_minor) },
            ]} />
          ) : <p className="text-sm text-muted">Aún no hay meses con movimiento.</p>}
        </Card>
        <Card title="¿En qué se va el dinero?" subtitle={`Por grupo, ${avgLabel}, sin IVA`}>
          {byGroup.length === 0 ? <p className="text-sm text-muted">Registra tus gastos para ver en qué se va el dinero.</p> : (
            <ul className="flex flex-col gap-3">
              {byGroup.map(([g, v]) => (
                <li key={g}>
                  <div className="mb-1 flex justify-between gap-3 text-sm"><span className="text-ink">{g}</span><span className="num text-muted">{formatMoney(v)} · {formatPpm(Math.round((v * 1_000_000) / groupTotal), 0)}</span></div>
                  <Meter value={v} max={groupTotal} label={g} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Este mes por categoría" subtitle="Lo gastado y, si definiste uno, el presupuesto." actions={<Button size="sm" variant="ghost" icon={Pencil} onClick={() => navigate("/gastos?tab=categorias", { replace: true })}>Presupuestos</Button>}>
        {spent.length === 0 ? <EmptyState icon={Receipt} title="Sin gastos este mes">Usa «Anotar rápido» o «Registrar gasto».</EmptyState> : (
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {spent.map((c) => (
              <li key={c.id} className="min-w-0">
                <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-sm">
                  <button className="truncate text-left text-ink hover:text-accent" onClick={() => navigate(`/gastos?tab=registro`, { replace: true })}>{c.name}</button>
                  <span className="num text-muted">{formatMoney(c.this_month_minor)}{c.budget_minor ? ` de ${formatMoney(c.budget_minor)}` : ""}</span>
                </div>
                {c.budget_minor ? <Meter value={c.this_month_minor} max={c.budget_minor} label={`${c.name}: gastado del presupuesto`} />
                  : <div className="text-xs text-faint">Promedio {formatMoney(c.avg_month_minor)} al mes</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {ins.notes.length > 0 && <div className="flex flex-col gap-2">{ins.notes.map((n) => <Notice key={n} tone="info">{n}</Notice>)}</div>}
    </div>
  );
}

/* ───────────── Categorías y presupuesto ───────────── */

function Categorias({ ins, write, onChanged }: { ins: ExpenseInsights | null; write: boolean; onChanged: () => void }) {
  const backend = useBackend();
  const [cats, setCats] = useState<ExpenseCategory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExpenseCategory | "nueva" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => { backend.expenseCategoriesAll().then(setCats).catch((e) => setErr(errorMessage(e))); }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!cats) return <Spinner />;
  const stat = (id: number) => ins?.categories.find((c) => c.id === id);
  const visible = cats.filter((c) => showArchived || !c.archived);
  const groups = [...new Set([...CATEGORY_GROUPS, ...cats.map((c) => c.group_name)])].filter((g) => visible.some((c) => c.group_name === g));
  const budgetTotal = cats.filter((c) => !c.archived).reduce((a, c) => a + (c.monthly_budget_minor ?? 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          Ordena tus gastos como te acomode: crea categorías, júntalas en grupos y ponles un presupuesto mensual para saber cuándo te estás pasando.
          {budgetTotal > 0 && <> Presupuesto total: <strong className="num text-ink">{formatMoney(budgetTotal)}</strong> al mes.</>}
        </p>
        <div className="flex items-center gap-3">
          <Checkbox label="Ver archivadas" checked={showArchived} onChange={setShowArchived} />
          {write && <Button icon={Plus} onClick={() => setEditing("nueva")}>Nueva categoría</Button>}
        </div>
      </div>
      {groups.map((g) => (
        <Card key={g} title={g} padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed text-sm">
              <colgroup><col /><col className="w-28" /><col className="w-36" /><col className="w-32" /><col className="w-52" /><col className="w-14" /></colgroup>
              <thead><tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-semibold">Categoría</th><th className="font-semibold">Tipo</th>
                <th className="text-right font-semibold">Promedio al mes</th><th className="text-right font-semibold">Este mes</th>
                <th className="px-4 font-semibold">Presupuesto</th><th />
              </tr></thead>
              <tbody>
                {visible.filter((c) => c.group_name === g).map((c) => {
                  const s = stat(c.id);
                  return (
                    <tr key={c.id} className={`border-t border-line ${c.archived ? "opacity-60" : ""}`}>
                      <td className="truncate px-5 py-2.5 text-ink">{c.name}{c.archived && <Badge className="ml-2">Archivada</Badge>}</td>
                      <td><Badge tone={c.behavior === "fijo" ? "info" : "neutral"}>{c.behavior === "fijo" ? "Fijo" : "Variable"}</Badge></td>
                      <td className="num text-right text-muted">{s?.avg_month_minor ? formatMoney(s.avg_month_minor) : "—"}</td>
                      <td className="num text-right">{s?.this_month_minor ? formatMoney(s.this_month_minor) : "—"}</td>
                      <td className="px-4">
                        {c.monthly_budget_minor ? (
                          <div className="flex flex-col gap-1">
                            <span className="num text-xs text-muted">{formatMoney(c.monthly_budget_minor)}</span>
                            <Meter value={s?.this_month_minor ?? 0} max={c.monthly_budget_minor} label={`${c.name}: gastado del presupuesto`} />
                          </div>
                        ) : <span className="text-xs text-faint">Sin presupuesto</span>}
                      </td>
                      <td className="pr-3 text-right">{write && <IconButton icon={Pencil} label={`Editar ${c.name}`} onClick={() => setEditing(c)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {editing && (
        <CategoryDialog cat={editing === "nueva" ? null : editing} groups={[...new Set([...CATEGORY_GROUPS, ...cats.map((c) => c.group_name)])]}
          onClose={() => setEditing(null)} onSaved={(c) => { setCats(c); setEditing(null); onChanged(); }} />
      )}
    </div>
  );
}

function CategoryDialog({ cat, groups, onClose, onSaved }: { cat: ExpenseCategory | null; groups: string[]; onClose: () => void; onSaved: (c: ExpenseCategory[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [f, setF] = useState<CategoryInput>({
    id: cat?.id ?? null, name: cat?.name ?? "", fixed: cat?.behavior === "fijo", group_name: cat?.group_name ?? "Otros",
    monthly_budget_minor: cat?.monthly_budget_minor ?? null, archived: cat?.archived ?? false,
  });
  const [newGroup, setNewGroup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    try {
      const c = await backend.saveExpenseCategory(f);
      toast("success", cat ? "Categoría guardada." : `Categoría ${f.name.trim()} creada.`);
      onSaved(c);
    } catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Dialog open onClose={onClose} title={cat ? `Editar ${cat.name}` : "Nueva categoría de gasto"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={!f.name.trim()}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Bencina camioneta, Ferias, Cursos" data-autofocus />
        {newGroup ? (
          <Field label="Nuevo grupo" value={f.group_name ?? ""} onChange={(e) => setF({ ...f, group_name: e.target.value })} hint="Ej. Viajes a ferias, Taller" />
        ) : (
          <Select label="Grupo" value={f.group_name ?? "Otros"} onChange={(e) => e.target.value === "__nuevo" ? (setNewGroup(true), setF({ ...f, group_name: "" })) : setF({ ...f, group_name: e.target.value })}
            options={[...groups.map((g) => ({ value: g, label: g })), { value: "__nuevo", label: "+ Nuevo grupo…" }]} />
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Tipo</span>
          <Segmented label="Tipo de gasto" value={f.fixed ? "fijo" : "variable"} onChange={(v) => setF({ ...f, fixed: v === "fijo" })}
            options={[{ value: "fijo", label: "Fijo (se repite cada mes)" }, { value: "variable", label: "Variable" }]} />
        </div>
        <MoneyField label="Presupuesto mensual" value={f.monthly_budget_minor} onValue={(v) => setF({ ...f, monthly_budget_minor: v })}
          hint="Opcional. Te avisamos cuando lo gastado en el mes lo supere." />
        {cat && <Checkbox label="Archivar (ya no la uso)" checked={f.archived} onChange={(v) => setF({ ...f, archived: v })} hint="Sus gastos siguen en los reportes; solo deja de aparecer al registrar." />}
        {f.archived && !cat?.archived && <Notice tone="info" icon={Archive}>Al archivarla no se borra nada.</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

