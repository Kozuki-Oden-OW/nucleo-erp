// Gastos del negocio: lista, registro rápido (pagado o por pagar) y ficha con pagos y anulación.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Ban, HandCoins, Plus, Receipt, Search } from "lucide-react";
import {
  useBackend, errorMessage, type ExpenseCategory, type ExpenseDetail, type ExpenseInput, type ExpenseSummary, type Recurring, type Supplier,
} from "../../data";
import { PAYMENT_METHODS } from "../../data/catalogs";
import { addDays, formatDate, formatMoney, todayIso } from "../../lib/format";
import { goBack, navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Checkbox, DefinitionList, EmptyState, Field, Notice, PageHeader, Segmented, Select, Spinner, TextArea } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";
import { AttachmentsPanel } from "../documentos/Documents";
import { SupplierFormDrawer } from "../compras/common";
import { SupplierPicker } from "../ventas/pickers";
import { AccountSelect, ExpenseStateBadge, PayDialog } from "./common";

type Period = "mes" | "anterior" | "todo";

function monthRange(p: Period): { from?: string; to?: string } {
  const t = todayIso();
  if (p === "todo") return {};
  const d = new Date(`${t}T12:00:00`);
  d.setDate(1);
  if (p === "anterior") d.setMonth(d.getMonth() - 1);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(d); end.setMonth(end.getMonth() + 1); end.setDate(0);
  return { from, to: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}` };
}

export function ExpensesTab({ route, onChanged }: { route: Route; onChanged: () => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("mes");
  const [withVoid, setWithVoid] = useState(false);
  const [rows, setRows] = useState<ExpenseSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const creating = route.query.get("nuevo") === "1";
  useEffect(() => {
    let alive = true;
    const tm = setTimeout(() => {
      backend.listExpenses({ query, ...monthRange(period), include_void: withVoid }).then((r) => alive && setRows(r)).catch((e) => alive && setErr(errorMessage(e)));
    }, 90);
    return () => { alive = false; clearTimeout(tm); };
  }, [backend, query, period, withVoid, version]);

  const live = (rows ?? []).filter((g) => g.status !== "anulado");
  const total = live.reduce((a, g) => a + g.total_minor, 0);
  const pending = live.reduce((a, g) => a + g.total_minor - g.paid_minor, 0);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of live) m.set(g.category, (m.get(g.category) ?? 0) + g.total_minor);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [live]);

  const cols: Column<ExpenseSummary>[] = [
    { key: "n", header: "Número", width: "8.5rem", render: (g) => <span className="font-mono text-[13px] font-medium">{g.number}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (g) => <span className="num text-muted">{formatDate(g.date)}</span> },
    { key: "c", header: "Categoría", width: "11rem", render: (g) => <span className="text-muted">{g.category}</span> },
    { key: "d", header: "Descripción", render: (g) => <span className="truncate text-ink">{g.description}{g.supplier_name && <span className="text-muted"> · {g.supplier_name}</span>}</span> },
    { key: "e", header: "Estado", width: "10.5rem", render: (g) => <ExpenseStateBadge g={g} /> },
    { key: "t", header: "Total", width: "8.5rem", align: "right", render: (g) => <span className={`num font-medium ${g.status === "anulado" ? "text-muted line-through" : ""}`}>{formatMoney(g.total_minor)}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Field aria-label="Buscar gastos" leading={<Search size={15} />} placeholder="Número, descripción, categoría o proveedor" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-md" />
        <Segmented label="Período" value={period} onChange={setPeriod} options={[{ value: "mes", label: "Este mes" }, { value: "anterior", label: "Mes anterior" }, { value: "todo", label: "Todo" }]} />
        <Checkbox label="Incluir anulados" checked={withVoid} onChange={setWithVoid} />
      </div>
      {rows && live.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span>Total: <strong className="num text-ink">{formatMoney(total)}</strong></span>
          {pending > 0 && <span>Por pagar: <strong className="num text-warning">{formatMoney(pending)}</strong></span>}
          {byCat.length > 1 && <span className="min-w-0">Mayores: {byCat.map(([c, v]) => `${c} ${formatMoney(v)}`).join(" · ")}</span>}
        </div>
      )}
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable label="Gastos" columns={cols} rows={rows ?? []} rowKey={(g) => g.uid} onOpen={(g) => navigate(`/dinero/gasto/${g.uid}`)}
        empty={<EmptyState icon={Receipt} title={query ? "Sin coincidencias" : "Sin gastos en este período"} action={can("dinero.registrar") && !query && <Button icon={Plus} onClick={() => navigate("/dinero?tab=gastos&nuevo=1", { replace: true })}>Registrar gasto</Button>}>
          Arriendo, luz, internet, sueldos, fletes… todo lo que pagas para que el negocio funcione.
        </EmptyState>} />
      <ExpenseFormDrawer open={creating} onClose={() => navigate("/dinero?tab=gastos", { replace: true })}
        onSaved={(g) => { setVersion((v) => v + 1); onChanged(); navigate(`/dinero/gasto/${g.uid}`); }} />
    </div>
  );
}

export function ExpenseFormDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (g: ExpenseDetail) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [recs, setRecs] = useState<Recurring[]>([]);
  const blank = (): ExpenseInput => ({ category_id: 0, supplier_uid: null, date: todayIso(), description: "", total_minor: 0, tax_included: true, due_date: null, paid_method: PAYMENT_METHODS[1]!, paid_account_uid: null, recurring_id: null });
  const [f, setF] = useState<ExpenseInput>(blank);
  const [amount, setAmount] = useState<number | null>(null);
  const [paid, setPaid] = useState<"pagado" | "por_pagar">("pagado");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(blank()); setAmount(null); setPaid("pagado"); setSupplier(null); setErr(null);
    backend.expenseCategories().then((c) => { setCats(c); setF((x) => ({ ...x, category_id: x.category_id || (c.find((k) => k.name === "Otros")?.id ?? c[0]?.id ?? 0) })); }).catch(() => {});
    backend.recurring().then((r) => setRecs(r.filter((x) => x.active && x.direction === "egreso"))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, open]);

  function fromRecurring(id: string) {
    const r = recs.find((x) => String(x.id) === id);
    if (!r) { setF({ ...f, recurring_id: null }); return; }
    setF({ ...f, recurring_id: r.id, description: r.description, category_id: r.category_id ?? f.category_id });
    setAmount(r.amount_minor);
  }
  async function addCategory() {
    if (!newCat?.trim()) return;
    try {
      const c = await backend.addExpenseCategory(newCat, false);
      setCats(c);
      const made = c.find((x) => x.name.toLowerCase() === newCat.trim().toLowerCase());
      if (made) setF({ ...f, category_id: made.id });
      setNewCat(null);
    } catch (e) { toast("danger", errorMessage(e)); }
  }
  async function save() {
    setBusy(true); setErr(null);
    try {
      const g = await backend.registerExpense({
        ...f, total_minor: amount ?? 0, supplier_uid: supplier?.uid ?? null,
        paid_method: paid === "pagado" ? f.paid_method : null, paid_account_uid: paid === "pagado" ? f.paid_account_uid : null,
        due_date: paid === "por_pagar" ? f.due_date || addDays(f.date, 30) : null, notes: f.notes?.trim() || undefined,
      });
      toast("success", `${g.number} registrado${g.payment_state === "pagado" ? " y pagado" : ": queda en Dinero que debes"}.`);
      onSaved(g);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  const cat = cats.find((c) => c.id === f.category_id);
  return (
    <>
      <Drawer open={open && newSupplier === null} onClose={onClose} title="Registrar gasto" subtitle="Queda en tu historial y en la auditoría. Si te equivocas, se anula con motivo."
        footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Receipt} onClick={save} disabled={busy || !amount || !f.description.trim() || !f.category_id}>{busy ? "Guardando…" : "Registrar gasto"}</Button></>}>
        <div className="flex flex-col gap-4">
          {recs.length > 0 && (
            <Select label="¿Es un pago recurrente?" optional value={f.recurring_id ? String(f.recurring_id) : ""} onChange={(e) => fromRecurring(e.target.value)}
              options={[{ value: "", label: "No" }, ...recs.map((r) => ({ value: String(r.id), label: `${r.description} · ${formatMoney(r.amount_minor)}` }))]}
              hint="Al registrarlo, deja de aparecer como pendiente en el calendario de este período." />
          )}
          <Field label="Descripción" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej. cuenta de luz de septiembre" data-autofocus />
          <div className="grid gap-4 sm:grid-cols-2">
            {newCat === null ? (
              <Select label="Categoría" value={String(f.category_id)} onChange={(e) => e.target.value === "nueva" ? setNewCat("") : setF({ ...f, category_id: Number(e.target.value) })}
                options={[...cats.map((c) => ({ value: String(c.id), label: c.name })), { value: "nueva", label: "+ Nueva categoría…" }]}
                hint={cat ? (cat.behavior === "fijo" ? "Gasto fijo: se repite cada mes" : "Gasto variable") : undefined} />
            ) : (
              <div className="flex items-end gap-2">
                <Field label="Nueva categoría" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }} className="flex-1" />
                <Button size="sm" onClick={addCategory} disabled={!newCat.trim()}>Crear</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewCat(null)}>Volver</Button>
              </div>
            )}
            <Field label="Fecha del gasto" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField label="Monto total" value={amount} onValue={setAmount} />
            <div className="flex items-end pb-2"><Checkbox label="El monto incluye IVA" checked={f.tax_included} onChange={(v) => setF({ ...f, tax_included: v })} hint="Se separa con la tasa de tu negocio (informativo)." /></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">Proveedor <span className="font-normal text-muted">(opcional)</span></span>
            <SupplierPicker value={supplier} onChange={setSupplier} onCreate={(name) => setNewSupplier(name)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">¿Ya lo pagaste?</span>
            <Segmented label="Pago" value={paid} onChange={setPaid} options={[{ value: "pagado", label: "Sí, ya lo pagué" }, { value: "por_pagar", label: "No, queda por pagar" }]} />
          </div>
          {paid === "pagado" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Medio de pago" value={f.paid_method ?? ""} onChange={(e) => setF({ ...f, paid_method: e.target.value })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
              <AccountSelect value={f.paid_account_uid ?? ""} onChange={(u) => setF({ ...f, paid_account_uid: u || null })} method={f.paid_method ?? ""} label="Sale de la cuenta" />
            </div>
          ) : (
            <Field label="Vence" type="date" value={f.due_date ?? addDays(f.date, 30)} onChange={(e) => setF({ ...f, due_date: e.target.value })} hint="Aparece en Dinero que debes y en el calendario de pagos." />
          )}
          <TextArea label="Notas" optional rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
      </Drawer>
      <SupplierFormDrawer open={newSupplier !== null} initialName={newSupplier ?? ""} onClose={() => setNewSupplier(null)} onSaved={(s) => { setSupplier(s); setNewSupplier(null); }} />
    </>
  );
}

export function ExpenseView({ uid }: { uid: string }) {
  const backend = useBackend();
  const { can } = useSession();
  const [g, setG] = useState<ExpenseDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "pay" | "void">(null);
  useEffect(() => { backend.expense(uid).then(setG).catch((e) => setErr(errorMessage(e))); }, [backend, uid]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!g) return <Spinner />;
  const due = g.status === "registrado" ? g.total_minor - g.paid_minor : 0;
  const write = can("dinero.registrar");
  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/dinero?tab=gastos")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Gastos</button>}
        title={<span className="flex flex-wrap items-center gap-3"><span>{g.description}</span><ExpenseStateBadge g={g} /></span>}
        subtitle={`${g.number} · ${g.category} · ${formatDate(g.date)}${g.supplier_name ? ` · ${g.supplier_name}` : ""}`}
        actions={write && g.status === "registrado" && (
          <>
            {due > 0 && <Button icon={HandCoins} onClick={() => setOpen("pay")}>Registrar pago</Button>}
            <Button variant="ghost" icon={Ban} onClick={() => setOpen("void")}>Anular</Button>
          </>
        )}
      />
      {g.status === "anulado" && <div className="mb-4"><Notice tone="warning" title="Gasto anulado">{g.void_reason}</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Detalle">
            <DefinitionList items={[
              { label: "Categoría", value: g.category },
              { label: "Proveedor", value: g.supplier_name ?? "—" },
              { label: "Fecha", value: formatDate(g.date) },
              { label: "Vence", value: formatDate(g.due_date) },
              ...(g.notes ? [{ label: "Notas", value: <span className="whitespace-pre-wrap">{g.notes}</span> }] : []),
            ]} />
          </Card>
          <AttachmentsPanel link={{ entity: "gasto", uid: g.uid }} />
        </div>
        <aside className="flex flex-col gap-4">
          <Card title="Montos">
            <dl className="flex flex-col gap-2 text-sm">
              {g.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">Neto</dt><dd className="num">{formatMoney(g.net_minor)}</dd></div>}
              {g.tax_minor > 0 && <div className="flex justify-between"><dt className="text-muted">IVA crédito (estimado)</dt><dd className="num">{formatMoney(g.tax_minor)}</dd></div>}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">Total</dt><dd className="num text-[20px] font-semibold">{formatMoney(g.total_minor)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Pagado</dt><dd className="num">{formatMoney(g.paid_minor)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Saldo</dt><dd className={`num font-semibold ${due > 0 ? "text-warning" : "text-success"}`}>{formatMoney(due)}</dd></div>
            </dl>
            {g.payments.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
                {g.payments.map((p) => (
                  <li key={p.number} className={`px-3 py-2 ${g.status === "anulado" ? "opacity-60" : ""}`}>
                    <div className="flex justify-between gap-3"><span className="text-ink">{p.method}</span><span className="num font-medium">{formatMoney(p.amount_minor)}</span></div>
                    <div className="num text-xs text-muted">{p.number} · {formatDate(p.date)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Historial">
            <ol className="flex flex-col gap-2 text-sm">{g.timeline.map((x, i) => <li key={i}><div className="text-ink">{x.text}</div><div className="num text-xs text-muted">{new Date(x.at).toLocaleString("es-CL")}</div></li>)}</ol>
          </Card>
        </aside>
      </div>
      {open === "pay" && (
        <PayDialog title={`Pagar ${g.number}`} due={due} onClose={() => setOpen(null)}
          onPay={async (amount, method, date, acc) => {
            const x = await backend.payExpense(g.uid, amount, method, date, acc);
            setG(x); setOpen(null);
            return x.payment_state === "pagado" ? "Gasto pagado completo." : "Abono registrado.";
          }} />
      )}
      {open === "void" && <VoidExpenseDialog g={g} onClose={() => setOpen(null)} onDone={(x) => { setG(x); setOpen(null); }} />}
    </div>
  );
}

function VoidExpenseDialog({ g, onClose, onDone }: { g: ExpenseDetail; onClose: () => void; onDone: (g: ExpenseDetail) => void }) {
  const backend = useBackend();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() { try { onDone(await backend.voidExpense(g.uid, reason)); } catch (e) { setErr(errorMessage(e)); } }
  return (
    <Dialog open onClose={onClose} title={`Anular ${g.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Ban} onClick={go} disabled={!reason.trim()}>Anular gasto</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Se anulan la deuda y los pagos registrados{g.payments.length ? ": el dinero vuelve a la cuenta de donde salió" : ""}. Nada se borra; después puedes registrar el gasto corregido.</p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. monto mal digitado" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
