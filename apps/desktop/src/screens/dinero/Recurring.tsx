// Ingresos y egresos recurrentes: alimentan el calendario y la proyección de caja.
import { useEffect, useState } from "react";
import { Pencil, Plus, Repeat } from "lucide-react";
import { useBackend, errorMessage, type ExpenseCategory, type Frequency, type Recurring, type RecurringInput } from "../../data";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { navigate, useRoute } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Notice, Segmented, Select, Spinner } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";

const FREQ: Record<Frequency, string> = { semanal: "Semanal", mensual: "Mensual", bimestral: "Cada 2 meses", trimestral: "Cada 3 meses", anual: "Anual" };

function when(r: Recurring): string {
  if (r.frequency === "semanal") return `Cada semana desde ${formatDate(r.starts_on)}`;
  const day = r.day_of_period ?? Number(r.starts_on.slice(8, 10));
  return `${FREQ[r.frequency]}, el día ${day}${r.ends_on ? ` hasta ${formatDate(r.ends_on)}` : ""}`;
}

export function RecurringTab({ onChanged }: { onChanged: () => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const route = useRoute();
  const [rows, setRows] = useState<Recurring[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const creating = route.query.get("nuevo") === "1";
  useEffect(() => { backend.recurring().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend]);
  const write = can("dinero.registrar");
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;
  const monthly = (dir: Recurring["direction"]) => rows.filter((r) => r.active && r.direction === dir)
    .reduce((a, r) => a + (r.frequency === "semanal" ? (r.amount_minor * 52) / 12 : r.frequency === "mensual" ? r.amount_minor : r.frequency === "bimestral" ? r.amount_minor / 2 : r.frequency === "trimestral" ? r.amount_minor / 3 : r.amount_minor / 12), 0);
  const close = () => { setEditing(null); if (creating) navigate("/dinero?tab=recurrentes", { replace: true }); };
  const saved = (r: Recurring[]) => { setRows(r); onChanged(); close(); };
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted">
        Lo que se repite: arriendo, sueldos, internet, una mantención que te pagan cada mes. NÚCLEO los muestra en el calendario y en la proyección de caja
        hasta que registras el gasto de ese período. No se registran solos.
      </p>
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <span>Egresos al mes (aprox.): <strong className="num text-ink">{formatMoney(Math.round(monthly("egreso")))}</strong></span>
          <span>Ingresos al mes (aprox.): <strong className="num text-success">{formatMoney(Math.round(monthly("ingreso")))}</strong></span>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={Repeat} title="Sin movimientos recurrentes" action={write && <Button icon={Plus} onClick={() => navigate("/dinero?tab=recurrentes&nuevo=1", { replace: true })}>Agregar el primero</Button>}>
          Anota tus pagos fijos para ver con anticipación cuánto dinero vas a necesitar.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
          {rows.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${r.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.description}</span>
                  <Badge tone={r.direction === "ingreso" ? "success" : "neutral"}>{r.direction === "ingreso" ? "Ingreso" : "Egreso"}</Badge>
                  {!r.active && <Badge>Pausado</Badge>}
                </div>
                <div className="text-[13px] text-muted">{when(r)}{r.category && ` · ${r.category}`}</div>
              </div>
              <span className={`num font-semibold ${r.direction === "ingreso" ? "text-success" : "text-ink"}`}>{r.direction === "ingreso" ? "+" : "−"}{formatMoney(r.amount_minor)}</span>
              {write && <IconButton icon={Pencil} label={`Editar ${r.description}`} size={15} onClick={() => setEditing(r)} />}
            </li>
          ))}
        </ul>
      )}
      {(creating || editing) && <RecurringDrawer editing={editing} onClose={close} onSaved={saved} />}
    </div>
  );
}

function RecurringDrawer({ editing, onClose, onSaved }: { editing: Recurring | null; onClose: () => void; onSaved: (r: Recurring[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [f, setF] = useState<RecurringInput>(editing
    ? { ...editing }
    : { id: null, direction: "egreso", description: "", category_id: null, amount_minor: 0, frequency: "mensual", day_of_period: Number(todayIso().slice(8, 10)), starts_on: todayIso(), ends_on: null, active: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.expenseCategories().then(setCats).catch(() => {}); }, [backend]);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await backend.saveRecurring({ ...f, category_id: f.direction === "egreso" ? f.category_id : null, day_of_period: f.frequency === "semanal" ? null : f.day_of_period, ends_on: f.ends_on || null });
      toast("success", "Recurrente guardado.");
      onSaved(r);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Drawer open onClose={onClose} title={editing ? "Editar recurrente" : "Nuevo recurrente"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy || !f.description.trim() || !f.amount_minor}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Segmented label="Dirección" value={f.direction} onChange={(d) => setF({ ...f, direction: d })} options={[{ value: "egreso", label: "Pago (egreso)" }, { value: "ingreso", label: "Cobro (ingreso)" }]} />
        <Field label="Descripción" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={f.direction === "egreso" ? "Ej. arriendo del local" : "Ej. mantención mensual de un cliente"} data-autofocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Monto" value={f.amount_minor || null} onValue={(v) => setF({ ...f, amount_minor: v ?? 0 })} />
          {f.direction === "egreso" && (
            <Select label="Categoría" optional value={f.category_id ? String(f.category_id) : ""} onChange={(e) => setF({ ...f, category_id: e.target.value ? Number(e.target.value) : null })}
              options={[{ value: "", label: "Sin categoría" }, ...cats.map((c) => ({ value: String(c.id), label: c.name }))]} />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Frecuencia" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Frequency })} options={(Object.keys(FREQ) as Frequency[]).map((k) => ({ value: k, label: FREQ[k] }))} />
          {f.frequency !== "semanal" && (
            <Field label="Día del mes" inputMode="numeric" value={f.day_of_period ?? ""} onChange={(e) => setF({ ...f, day_of_period: e.target.value ? Math.min(31, Number(e.target.value.replace(/\D/g, ""))) : null })}
              hint="Si el mes tiene menos días, se usa el último." inputClassName="text-right num" />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Desde" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
          <Field label="Hasta" optional type="date" value={f.ends_on ?? ""} onChange={(e) => setF({ ...f, ends_on: e.target.value || null })} />
        </div>
        <Checkbox label="Activo" checked={f.active} onChange={(v) => setF({ ...f, active: v })} hint="Si lo pausas, deja de aparecer en el calendario y en la proyección." />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}
