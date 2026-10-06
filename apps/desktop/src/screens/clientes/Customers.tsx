import { useEffect, useState } from "react";
import { FilePlus2, Pencil, Plus, Search, ShoppingBag, UserPlus, Users } from "lucide-react";
import { useBackend, errorMessage, type Customer, type CustomerDetail } from "../../data";
import { formatDate, formatMoney, formatRut } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { navigate, type Route } from "../../lib/router";
import { SaleStatus } from "../../ui/doc";
import { Button, DefinitionList, EmptyState, Field, Kpi, Notice, PageHeader, Spinner } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";
import { AttachmentsPanel } from "../documentos/Documents";
import { useSession } from "../../lib/session";

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

export function NewCustomerDrawer({ open, onClose, onCreated, initialName = "", editing }: { open: boolean; onClose: () => void; onCreated: (c: Customer) => void; initialName?: string; editing?: Customer }) {
  const backend = useBackend();
  const toast = useToast();
  const blank = () => editing
    ? { name: editing.name, rut: editing.rut ? formatRut(editing.rut) : "", email: editing.email ?? "", phone: editing.phone ?? "" }
    : { name: initialName, rut: "", email: "", phone: "" };
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setForm(blank()); setErr(null); } }, [open, initialName, editing?.uid]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const input = { name: form.name, rut: form.rut || undefined, email: form.email || undefined, phone: form.phone || undefined };
      const c = editing ? await backend.updateCustomer(editing.uid, input) : await backend.addCustomer(input);
      toast("success", editing ? "Cliente actualizado." : `Cliente ${c.name} agregado.`);
      onCreated(c);
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? "Editar cliente" : "Nuevo cliente"}
      subtitle={editing ? "Los cambios no alteran documentos ya emitidos." : "Solo el nombre es obligatorio. Puedes completar el resto después."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => save()} disabled={busy || !form.name.trim()}>{editing ? "Guardar cambios" : "Guardar cliente"}</Button></>}
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Nombre o razón social" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-autofocus />
        <Field label="RUT" optional value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="12.345.678-5" hint="Se valida el dígito verificador." />
        <Field label="Correo" optional type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field label="Teléfono" optional value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
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
          <DefinitionList items={[{ label: "Correo", value: c.email ?? "—" }, { label: "Teléfono", value: c.phone ?? "—" }]} />
          <AttachmentsPanel link={{ entity: "cliente", uid: c.uid }} />
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
