import { useEffect, useState } from "react";
import { FilePlus2, Pencil, Plus, Search, ShoppingBag, UserPlus, Users } from "lucide-react";
import { useBackend, errorMessage, type Customer, type CustomerDetail, type NewCustomer } from "../../data";
import { REGIONS } from "../../data/lre";
import { formatDate, formatMoney, formatRut } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { navigate, type Route } from "../../lib/router";
import { MoneyField, SaleStatus } from "../../ui/doc";
import { Button, Checkbox, DefinitionList, EmptyState, Field, Kpi, Notice, PageHeader, Segmented, Select, Spinner, TextArea } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";
import { AttachmentsPanel } from "../documentos/Documents";
import { useSession } from "../../lib/session";
import { CreditPanel } from "./credit";

export function Customers({ route }: { route: Route }) {
  const backend = useBackend();
  const { can } = useSession();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const openUid = route.path[1];
  const creating = route.query.get("nuevo") === "1";

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { backend.searchCustomers(query).then((r) => alive && setRows(r)).catch((e) => setErr(errorMessage(e))); }, 100);
    return () => { alive = false; clearTimeout(t); };
  }, [backend, query, version]);

  const cols: Column<Customer>[] = [
    { key: "n", header: "Nombre o razón social", render: (c) => <span className="font-medium text-ink">{c.name}</span> },
    { key: "r", header: "RUT", width: "9.5rem", render: (c) => <span className="num">{formatRut(c.rut)}</span> },
    { key: "g", header: "Giro o comuna", render: (c) => <span className="text-muted">{[c.business_activity, c.commune].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "e", header: "Correo", render: (c) => <span className="text-muted">{c.email ?? "—"}</span> },
    { key: "t", header: "Teléfono", width: "10rem", render: (c) => <span className="text-muted">{c.phone ?? "—"}</span> },
  ];

  return (
    <div className="anim-in">
      <PageHeader
        title="Clientes"
        subtitle="Busca sin importar tildes, por nombre, RUT (con o sin puntos) o correo."
        actions={can("clientes.editar") && <Button icon={UserPlus} onClick={() => navigate("/clientes?nuevo=1")}>Nuevo cliente</Button>}
      />
      <div className="mb-4">
        <Field aria-label="Buscar clientes" leading={<Search size={15} />} placeholder="Ej. perez, 76.123 o @empresa.cl" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" autoFocus />
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable
        label="Clientes"
        columns={cols}
        rows={rows ?? []}
        rowKey={(c) => c.uid}
        onOpen={(c) => navigate(`/clientes/${c.uid}`)}
        empty={<EmptyState icon={Users} title={query ? "Sin coincidencias" : "Aún no tienes clientes"} action={<Button icon={Plus} onClick={() => navigate("/clientes?nuevo=1")}>Agregar cliente</Button>} />}
      />
      <NewCustomerDrawer open={creating} onClose={() => navigate("/clientes", { replace: true })} onCreated={(c) => { setVersion((v) => v + 1); navigate(`/clientes/${c.uid}`, { replace: true }); }} />
      {openUid && <CustomerDrawer uid={openUid} onClose={() => navigate("/clientes", { replace: true })} onChanged={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

type Form = {
  kind: "persona" | "empresa"; name: string; rut: string; trade_name: string; business_activity: string; email: string; phone: string;
  invoice_email: string; contact_name: string; address: string; commune: string; city: string; region: string; days: string;
  credit_limit: number | null; notes: string; credit_enabled: boolean; credit_conditions: string;
};

function toForm(c: Customer | undefined, initialName: string): Form {
  return {
    kind: c?.kind ?? "persona", name: c?.name ?? initialName, rut: c?.rut ? formatRut(c.rut) : "", trade_name: c?.trade_name ?? "",
    business_activity: c?.business_activity ?? "", email: c?.email ?? "", phone: c?.phone ?? "", invoice_email: c?.invoice_email ?? "",
    contact_name: c?.contact_name ?? "", address: c?.address ?? "", commune: c?.commune ?? "", city: c?.city ?? "", region: c?.region ?? "",
    days: c?.payment_terms_days ? String(c.payment_terms_days) : "", credit_limit: c?.credit_limit_minor ?? null, notes: c?.notes ?? "",
    credit_enabled: c?.credit_enabled ?? false, credit_conditions: c?.credit_conditions ?? "",
  };
}

/** Datos para guardar un cliente a partir del formulario. */
export function customerInput(f: Form): NewCustomer {
  const t = (v: string) => v.trim() || null;
  return {
    name: f.name, rut: f.rut || undefined, email: f.email || undefined, phone: f.phone || undefined, kind: f.kind,
    trade_name: t(f.trade_name), business_activity: t(f.business_activity), invoice_email: t(f.invoice_email), contact_name: t(f.contact_name),
    address: t(f.address), commune: t(f.commune), city: t(f.city), region: t(f.region),
    payment_terms_days: f.credit_enabled ? Number(f.days) || 0 : 0, credit_limit_minor: f.credit_enabled ? f.credit_limit : null, notes: t(f.notes),
    credit_enabled: f.credit_enabled, credit_conditions: f.credit_enabled ? t(f.credit_conditions) : null,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

export function NewCustomerDrawer({ open, onClose, onCreated, initialName = "", editing }: { open: boolean; onClose: () => void; onCreated: (c: Customer) => void; initialName?: string; editing?: Customer }) {
  const backend = useBackend();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => toForm(editing, initialName));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setForm(toForm(editing, initialName)); setErr(null); } }, [open, initialName, editing?.uid]);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (form.credit_enabled && form.days && !/^\d{1,3}$/.test(form.days.trim())) { setErr("Los días de crédito deben ser un número entre 0 y 365."); return; }
    setBusy(true); setErr(null);
    try {
      const input = customerInput(form);
      const c = editing ? await backend.updateCustomer(editing.uid, input) : await backend.addCustomer(input);
      toast("success", editing ? "Cliente actualizado." : `Cliente ${c.name} agregado.`);
      onCreated(c);
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  }
  const company = form.kind === "empresa";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="w-[min(620px,100vw)]"
      title={editing ? "Editar cliente" : "Nuevo cliente"}
      subtitle={editing ? "Los cambios no alteran documentos ya emitidos." : "Solo el nombre es obligatorio. Lo demás es opcional y se usa para completar facturas y cotizaciones."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => save()} disabled={busy || !form.name.trim()}>{editing ? "Guardar cambios" : "Guardar cliente"}</Button></>}
    >
      <form onSubmit={save} className="flex flex-col gap-6">
        <Section title="Identificación">
          <Segmented label="Tipo de cliente" value={form.kind} onChange={(v) => set({ kind: v })} options={[{ value: "persona", label: "Persona" }, { value: "empresa", label: "Empresa" }]} />
          <Field label={company ? "Razón social" : "Nombre"} value={form.name} onChange={(e) => set({ name: e.target.value })} required data-autofocus />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="RUT" optional value={form.rut} onChange={(e) => set({ rut: e.target.value })} placeholder="12.345.678-5" hint="Se valida el dígito verificador." />
            {company && <Field label="Nombre de fantasía" optional value={form.trade_name} onChange={(e) => set({ trade_name: e.target.value })} />}
          </div>
          <Field label="Giro" optional value={form.business_activity} onChange={(e) => set({ business_activity: e.target.value })} placeholder="Ej. Venta al por menor de equipos" hint="Aparece en la factura interna." />
        </Section>
        <Section title="Contacto">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono" optional value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+56 9 1234 5678" />
            <Field label="Correo" optional type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            <Field label="Persona de contacto" optional value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} />
            <Field label="Correo para facturas" optional type="email" value={form.invoice_email} onChange={(e) => set({ invoice_email: e.target.value })} hint="Donde recibe sus documentos tributarios." />
          </div>
        </Section>
        <Section title="Dirección">
          <Field label="Dirección" optional value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Calle, número, oficina" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Comuna" optional value={form.commune} onChange={(e) => set({ commune: e.target.value })} />
            <Field label="Ciudad" optional value={form.city} onChange={(e) => set({ city: e.target.value })} />
            <Select label="Región" optional value={form.region} onChange={(e) => set({ region: e.target.value })}
              options={regionOptions(form.region)} />
          </div>
        </Section>
        <Section title="Condiciones comerciales">
          <Checkbox label="Habilitar crédito para este cliente" checked={form.credit_enabled}
            onChange={(v) => set({ credit_enabled: v, days: v && !form.days ? "30" : form.days })}
            hint="Todo es opcional: puedes darle crédito a un familiar o amigo sin documentos. Los respaldos se suben en la ficha del cliente." />
          {form.credit_enabled && (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Días de crédito" optional inputMode="numeric" value={form.days} onChange={(e) => set({ days: e.target.value })} suffix="días"
                  placeholder="30" hint="Se propone al venderle a crédito." inputClassName="text-right num" />
                <MoneyField label="Monto de crédito (cupo)" value={form.credit_limit} onValue={(v) => set({ credit_limit: v })} hint="Te avisamos si una venta lo supera." />
              </div>
              <TextArea label="Condiciones" optional value={form.credit_conditions} onChange={(e) => set({ credit_conditions: e.target.value })}
                placeholder="Ej. paga con transferencia los días 5; firma pagaré; cheque en garantía; tope por compra…" />
            </div>
          )}
          <TextArea label="Notas" optional value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Horario de recepción, condiciones especiales…" />
        </Section>
        {err && <Notice tone="danger">{err}</Notice>}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

function CustomerDrawer({ uid, onClose, onChanged }: { uid: string; onClose: () => void; onChanged: () => void }) {
  const backend = useBackend();
  const t = useTerm();
  const { can } = useSession();
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const [files, setFiles] = useState(0);
  useEffect(() => { backend.customer(uid).then(setC).catch((e) => setErr(errorMessage(e))); }, [backend, uid, version]);
  if (editing && c) {
    return <NewCustomerDrawer open editing={c} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); setVersion((v) => v + 1); onChanged(); }} />;
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title={c?.name ?? "Cliente"}
      subtitle={c?.rut ? `RUT ${formatRut(c.rut)}` : undefined}
      width="w-[min(640px,100vw)]"
      footer={c && (
        <>
          {can("clientes.editar") && <Button variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Editar</Button>}
          <Button variant="secondary" icon={FilePlus2} onClick={() => navigate(`/cotizaciones/nueva?cliente=${c.uid}`)}>Cotizar</Button>
          <Button icon={ShoppingBag} onClick={() => navigate(`/ventas/nueva?cliente=${c.uid}`)}>Vender</Button>
        </>
      )}
    >
      {err && <Notice tone="danger">{err}</Notice>}
      {!c && !err && <Spinner />}
      {c && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Compras" value={formatMoney(c.revenue_minor)} hint={`${c.sales_count} ventas`} />
            <Kpi label={t("por_cobrar")} value={formatMoney(c.receivable_minor)} tone={c.receivable_minor > 0 ? "warning" : undefined} />
            <Kpi label="Última compra" value={formatDate(c.last_sale_date)} />
            <Kpi label="Compra cada" value={c.avg_days_between ? `${c.avg_days_between} días` : "—"} hint="Promedio entre compras" />
          </div>
          <DefinitionList items={[
            ...(c.trade_name ? [{ label: "Nombre de fantasía", value: c.trade_name }] : []),
            { label: "Giro", value: c.business_activity ?? "—" },
            { label: "Dirección", value: [c.address, c.commune, c.city, c.region].filter(Boolean).join(", ") || "—" },
            { label: "Teléfono", value: c.phone ?? "—" },
            { label: "Correo", value: c.email ?? "—" },
            ...(c.invoice_email ? [{ label: "Correo para facturas", value: c.invoice_email }] : []),
            ...(c.contact_name ? [{ label: "Contacto", value: c.contact_name }] : []),
            { label: "Condición de pago", value: c.credit_enabled ? `Crédito${c.payment_terms_days ? ` ${c.payment_terms_days} días` : ""}` : "Contado" },
            ...(c.notes ? [{ label: "Notas", value: c.notes }] : []),
          ]} />
          <CreditPanel key={`cr${version}`} uid={c.uid} company={c.kind === "empresa"} onFilesChanged={() => setFiles((v) => v + 1)} />
          <AttachmentsPanel key={`f${files}`} link={{ entity: "cliente", uid: c.uid }} />
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Últimas ventas</h3>
            {c.recent.length === 0 ? <p className="text-sm text-muted">Sin ventas todavía.</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {c.recent.map((s) => (
                  <li key={s.uid}>
                    <button onClick={() => navigate(`/ventas/${s.uid}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <span className="font-mono text-[13px]">{s.number}</span>
                      <span className="num text-muted">{formatDate(s.issue_date)}</span>
                      <span className="flex-1"><SaleStatus s={s} compact /></span>
                      <span className="num font-medium">{formatMoney(s.total_minor)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Regiones de Chile; conserva un valor anterior que no esté en la lista. */
function regionOptions(current: string): { value: string; label: string }[] {
  const names = REGIONS.map(([, n]) => n);
  return [{ value: "", label: "—" }, ...(current && !names.includes(current) ? [current] : []).concat(names).map((n) => ({ value: n, label: n }))];
}
