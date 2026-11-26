// Cobros recurrentes: una venta que se repite sola (mensual, trimestral, anual…), como el monitoreo
// por suscripción. NÚCLEO la genera cuando toca, la deja por cobrar y le avisa al cliente.
import { useCallback, useEffect, useState } from "react";
import { CalendarSync, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useBackend, errorMessage, type Customer, type LineInput, type Product, type RecurringFrequency, type RecurringSale, type RecurringSaleInput } from "../../data";
import { computeTotals } from "../../data/calc";
import { addDays, formatDate, formatMoney, todayIso } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Notice, Select, Spinner, TextArea } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";
import { CustomerPicker, ProductPicker } from "./pickers";

const FREQ: Record<RecurringFrequency, string> = { mensual: "Cada mes", bimestral: "Cada 2 meses", trimestral: "Cada 3 meses", semestral: "Cada 6 meses", anual: "Cada año" };

export function RecurringSalesTab() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const write = can("ventas.crear");
  const [rows, setRows] = useState<RecurringSale[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecurringSale | "nuevo" | null>(null);
  const [running, setRunning] = useState<RecurringSale | null>(null);
  const [removing, setRemoving] = useState<RecurringSale | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { backend.recurringSales().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend]);
  useEffect(load, [load]);
  useEffect(() => { window.addEventListener("nucleo:datos", load); return () => window.removeEventListener("nucleo:datos", load); }, [load]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;

  async function runNow() {
    if (!running) return;
    setBusy(true);
    try {
      const r = await backend.recurringRunNow(running.uid);
      toast(r.notes.length ? "warning" : "success", `Se generó ${r.sales.join(", ")}${r.mails_sent ? " y se le avisó al cliente" : ""}.${r.notes.length ? ` ${r.notes[0]}` : ""}`);
      setRunning(null); load();
      window.dispatchEvent(new Event("nucleo:datos"));
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!removing) return;
    try { await backend.deleteRecurringSale(removing.uid); toast("success", "Cobro recurrente eliminado. Las ventas que ya generó se mantienen."); setRemoving(null); load(); }
    catch (e) { toast("danger", errorMessage(e)); }
  }
  const monthly = rows.filter((r) => r.active && r.total_minor).reduce((a, r) => a + r.total_minor! / { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }[r.frequency], 0);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          Lo que cobras todos los meses o todos los años: monitoreo, arriendo de equipos, mantenciones. Cuando toca, NÚCLEO crea la venta, la deja por cobrar y le envía al cliente el aviso con el detalle y tus datos de pago.
          La boleta o factura la emites tú desde la venta.
        </p>
        {write && rows.length > 0 && <span data-agent-human><Button icon={Plus} onClick={() => setEditing("nuevo")}>Nuevo cobro recurrente</Button></span>}
      </div>
      {rows.length > 0 && <div className="text-sm text-muted">Ingreso recurrente al mes (aprox.): <strong className="num text-success">{formatMoney(Math.round(monthly))}</strong></div>}
      {rows.length === 0 ? (
        <EmptyState icon={CalendarSync} title="Sin cobros recurrentes" action={write && <span data-agent-human><Button icon={Plus} onClick={() => setEditing("nuevo")}>Crear el primero</Button></span>}>
          Deja programado lo que le cobras a un cliente cada mes o cada año, y deja de acordarte de hacerlo a mano.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
          {rows.map((r) => (
            <li key={r.uid} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${r.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{r.name}</span>
                  <Badge tone="neutral">{FREQ[r.frequency]}</Badge>
                  {!r.active && <Badge>Pausado</Badge>}
                  {r.due_now && <Badge tone="warning">Toca generarlo</Badge>}
                  {r.send_mail && !r.customer_email && <Badge tone="warning">El cliente no tiene correo</Badge>}
                </div>
                <div className="text-[13px] text-muted">
                  <button className="hover:text-accent" onClick={() => navigate(`/clientes/${r.customer_uid}`)}>{r.customer_name}</button>
                  {" · "}próximo cobro el {formatDate(r.next_date)}{r.end_date && ` · hasta el ${formatDate(r.end_date)}`}
                  {r.last_sale_uid && <>{" · "}último: <button className="text-accent hover:underline" onClick={() => navigate(`/ventas/${r.last_sale_uid}`)}>{r.last_sale_number}</button> ({formatDate(r.last_run_date)})</>}
                </div>
              </div>
              <span className="num font-semibold text-ink">{r.total_minor === null ? "—" : formatMoney(r.total_minor)}</span>
              {write && (
                <span data-agent-human className="flex items-center gap-1">
                  <Button size="sm" variant="secondary" icon={Play} onClick={() => setRunning(r)}>Generar ahora</Button>
                  <IconButton icon={Pencil} label={`Editar ${r.name}`} size={15} onClick={() => setEditing(r)} />
                  <IconButton icon={Trash2} label={`Eliminar ${r.name}`} size={15} onClick={() => setRemoving(r)} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <RecurringDrawer editing={editing === "nuevo" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <Dialog open={running !== null} onClose={() => setRunning(null)} title="Generar el cobro ahora"
        footer={<><Button variant="ghost" onClick={() => setRunning(null)}>Cancelar</Button><span data-agent-human><Button icon={Play} onClick={runNow} disabled={busy}>{busy ? "Generando…" : "Generar"}</Button></span></>}>
        {running && (
          <p className="text-sm text-ink">
            Se creará la venta de <strong>{running.name}</strong> para {running.customer_name} por {running.total_minor === null ? "el monto de sus líneas" : formatMoney(running.total_minor)}
            {running.confirm ? `, por cobrar con vencimiento el ${formatDate(addDays(todayIso(), running.credit_days))}` : ", en borrador"}
            {running.confirm && running.send_mail && running.customer_email ? `, y se enviará el aviso a ${running.customer_email}` : ""}. El próximo cobro avanza un período.
          </p>
        )}
      </Dialog>
      <Dialog open={removing !== null} onClose={() => setRemoving(null)} title="Eliminar el cobro recurrente"
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button><span data-agent-human><Button variant="danger" icon={Trash2} onClick={remove}>Eliminar</Button></span></>}>
        <p className="text-sm text-ink">«{removing?.name}» deja de generarse. Las ventas que ya creó no se tocan. Si solo quieres detenerlo un tiempo, edítalo y desmarca «Activo».</p>
      </Dialog>
    </div>
  );
}

type Row = LineInput & { key: number };

function RecurringDrawer({ editing, onClose, onSaved }: { editing: RecurringSale | null; onClose: () => void; onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [rows, setRows] = useState<Row[]>((editing?.lines ?? []).map((l, i) => ({ ...l, key: i })));
  const [f, setF] = useState<Omit<RecurringSaleInput, "lines" | "customer_uid">>(editing
    ? { name: editing.name, notes: editing.notes, frequency: editing.frequency, next_date: editing.next_date, end_date: editing.end_date, credit_days: editing.credit_days, confirm: editing.confirm, send_mail: editing.send_mail, active: editing.active }
    : { name: "", notes: null, frequency: "mensual", next_date: todayIso(), end_date: null, credit_days: 10, confirm: true, send_mail: true, active: true });
  const [taxPpm, setTaxPpm] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    backend.business().then((b) => setTaxPpm(b.tax_enabled ? b.tax_rate_ppm : null)).catch(() => {});
    if (editing) backend.searchCustomers(editing.customer_name).then((r) => setCustomer(r.find((c) => c.uid === editing.customer_uid) ?? null)).catch(() => {});
  }, [backend, editing]);
  const add = (p: Product | null, text: string) => setRows((r) => [...r, { key: Date.now(), product_uid: p?.uid ?? null, description: p?.name ?? text, qty_milli: 1000, unit_price_minor: p?.price_minor ?? 0, discount_ppm: 0, taxable: p?.taxable ?? true }]);
  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const totals = computeTotals(rows, taxPpm);
  async function save() {
    if (!customer) { setErr("Elige el cliente al que se le cobra."); return; }
    setBusy(true); setErr(null);
    try {
      await backend.saveRecurringSale({ ...f, name: f.name.trim(), notes: f.notes?.trim() || null, end_date: f.end_date || null, customer_uid: customer.uid, lines: rows.map(({ key: _k, ...l }) => l) }, editing?.uid ?? null);
      toast("success", "Cobro recurrente guardado.");
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Drawer open onClose={onClose} title={editing ? "Editar cobro recurrente" : "Nuevo cobro recurrente"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><span data-agent-human><Button onClick={save} disabled={busy || !f.name.trim() || rows.length === 0}>Guardar</Button></span></>}>
      <div data-agent-human className="flex flex-col gap-4">
        <Field label="Nombre del cobro" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Monitoreo mensual, 4 equipos" hint="Así aparece en la venta y en el correo al cliente." data-autofocus />
        <div><span className="mb-1.5 block text-[13px] font-medium text-ink">Cliente</span><CustomerPicker value={customer} onChange={setCustomer} allowWalkIn={false} onCreate={() => navigate("/clientes?nuevo=1")} /></div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Qué se cobra (precios netos, sin IVA)</span>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[1fr_4.5rem_8rem_auto] items-center gap-2">
                <Field aria-label="Descripción" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
                <Field aria-label="Cantidad" inputMode="decimal" value={String(r.qty_milli / 1000)} onChange={(e) => update(r.key, { qty_milli: Math.round((Number(e.target.value.replace(",", ".")) || 0) * 1000) })} inputClassName="text-right num" />
                <MoneyField aria-label="Precio unitario neto" value={r.unit_price_minor} onValue={(v) => update(r.key, { unit_price_minor: v ?? 0 })} />
                <IconButton icon={X} label="Quitar la línea" size={15} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} />
              </div>
            ))}
            <ProductPicker onPick={add} />
          </div>
          {rows.length > 0 && <div className="mt-2 text-right text-sm text-muted">Neto {formatMoney(totals.net_minor + totals.exempt_minor)}{totals.tax_minor > 0 && ` · IVA ${formatMoney(totals.tax_minor)}`} · <strong className="num text-ink">Total {formatMoney(totals.total_minor)}</strong></div>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Se repite" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as RecurringFrequency })} options={(Object.keys(FREQ) as RecurringFrequency[]).map((k) => ({ value: k, label: FREQ[k] }))} />
          <Field label="Próximo cobro" type="date" value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} hint="Los siguientes caen el mismo día del mes." />
          <Field label="Hasta" optional type="date" value={f.end_date ?? ""} onChange={(e) => setF({ ...f, end_date: e.target.value || null })} />
          <Field label="Días para pagar" inputMode="numeric" value={f.credit_days} onChange={(e) => setF({ ...f, credit_days: Math.min(365, Number(e.target.value.replace(/\D/g, "")) || 0) })} inputClassName="text-right num" />
        </div>
        <Checkbox label="Dejar la venta por cobrar" checked={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} hint="Si lo desmarcas, la venta queda en borrador para que la revises antes de confirmarla." />
        <Checkbox label="Avisarle al cliente por correo" checked={f.send_mail} onChange={(v) => setF({ ...f, send_mail: v })} hint={customer && !customer.email ? "Este cliente no tiene correo en su ficha: agrégalo para que le llegue." : "Con el detalle, el vencimiento, tus datos de transferencia y el enlace de pago."} />
        <TextArea label="Nota para la venta" optional rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <Checkbox label="Activo" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}
