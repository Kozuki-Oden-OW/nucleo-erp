// Piezas compartidas de Compras: estados, ficha y alta de proveedores.
import { useEffect, useState } from "react";
import { FilePlus2, Pencil, ShoppingCart } from "lucide-react";
import { useBackend, errorMessage, type NewSupplier, type PoStatus, type PurchaseSummary, type Supplier, type SupplierDetail } from "../../data";
import { formatDate, formatMoney, formatRut } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, DefinitionList, Field, Kpi, Notice, Spinner, type Tone } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { AttachmentsPanel } from "../documentos/Documents";

export const PO_STATUS: Record<PoStatus, [Tone, string]> = {
  borrador: ["info", "Borrador"],
  emitida: ["accent", "Emitida · por recibir"],
  parcial: ["warning", "Recibida en parte"],
  recibida: ["success", "Recibida"],
  anulada: ["neutral", "Anulada"],
};

export function PoStatusBadge({ status }: { status: PoStatus }) {
  const [tone, label] = PO_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function PurchaseStatusBadge({ c }: { c: Pick<PurchaseSummary, "status" | "payment_state" | "due_date"> }) {
  if (c.status === "anulada") return <Badge>Anulado</Badge>;
  if (c.payment_state === "pagada") return <Badge tone="success">Pagado</Badge>;
  const overdue = c.due_date !== null && c.due_date < new Date().toISOString().slice(0, 10);
  if (overdue) return <Badge tone="danger">Vencido</Badge>;
  return <Badge tone="warning">{c.payment_state === "abonada" ? "Abonado · por pagar" : "Por pagar"}</Badge>;
}

export function SupplierFormDrawer({ open, onClose, onSaved, initialName = "", editing }: { open: boolean; onClose: () => void; onSaved: (s: Supplier) => void; initialName?: string; editing?: Supplier }) {
  const backend = useBackend();
  const toast = useToast();
  const blank = () => editing
    ? { name: editing.name, rut: editing.rut ? formatRut(editing.rut) : "", email: editing.email ?? "", phone: editing.phone ?? "", terms: String(editing.payment_terms_days) }
    : { name: initialName, rut: "", email: "", phone: "", terms: "0" };
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setForm(blank()); setErr(null); } }, [open, initialName, editing?.uid]);
  async function save() {
    setBusy(true); setErr(null);
    const input: NewSupplier = { name: form.name, rut: form.rut || undefined, email: form.email || undefined, phone: form.phone || undefined, payment_terms_days: Number(form.terms) || 0 };
    try {
      const s = editing ? await backend.updateSupplier(editing.uid, input) : await backend.addSupplier(input);
      toast("success", editing ? "Proveedor actualizado." : `Proveedor ${s.name} agregado.`);
      onSaved(s);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} title={editing ? "Editar proveedor" : "Nuevo proveedor"} subtitle="Solo el nombre es obligatorio."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy || !form.name.trim()}>{editing ? "Guardar cambios" : "Guardar proveedor"}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4">
        <Field label="Nombre o razón social" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-autofocus />
        <Field label="RUT" optional value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="76.123.456-0" hint="Se valida el dígito verificador." />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Correo" optional type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field label="Teléfono" optional value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <Field label="Plazo de pago habitual" inputMode="numeric" suffix="días" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value.replace(/\D/g, "") })}
          hint="0 = pagas al contado. Se usa para calcular el vencimiento de sus facturas." className="max-w-[14rem]" inputClassName="text-right num" />
        {err && <Notice tone="danger">{err}</Notice>}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

export function SupplierDrawer({ uid, onClose, onChanged }: { uid: string; onClose: () => void; onChanged: () => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const [s, setS] = useState<SupplierDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => { backend.supplier(uid).then(setS).catch((e) => setErr(errorMessage(e))); }, [backend, uid, version]);
  if (editing && s) return <SupplierFormDrawer open editing={s} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setVersion((v) => v + 1); onChanged(); }} />;
  return (
    <Drawer open onClose={onClose} title={s?.name ?? "Proveedor"} subtitle={s?.rut ? `RUT ${formatRut(s.rut)}` : undefined} width="w-[min(640px,100vw)]"
      footer={s && (
        <>
          {can("proveedores.editar") && <Button variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Editar</Button>}
          {can("compras.crear") && <Button variant="secondary" icon={FilePlus2} onClick={() => navigate(`/compras/doc/nueva?proveedor=${s.uid}`)}>Registrar documento</Button>}
          {can("compras.crear") && <Button icon={ShoppingCart} onClick={() => navigate(`/compras/oc/nueva?proveedor=${s.uid}`)}>Orden de compra</Button>}
        </>
      )}>
      {err && <Notice tone="danger">{err}</Notice>}
      {!s && !err && <Spinner />}
      {s && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Compras" value={formatMoney(s.purchased_minor)} hint={`${s.purchases_count} documentos`} />
            <Kpi label="Dinero que le debes" value={formatMoney(s.payable_minor)} tone={s.payable_minor > 0 ? "warning" : undefined} />
          </div>
          <DefinitionList items={[
            { label: "Plazo de pago", value: s.payment_terms_days ? `${s.payment_terms_days} días` : "Contado" },
            { label: "Última compra", value: formatDate(s.last_purchase_date) },
            { label: "Correo", value: s.email ?? "—" },
            { label: "Teléfono", value: s.phone ?? "—" },
          ]} />
          <AttachmentsPanel link={{ entity: "proveedor", uid: s.uid }} />
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Últimos documentos</h3>
            {s.purchases.length === 0 ? <p className="text-sm text-muted">Sin documentos de compra todavía.</p> : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.purchases.map((c) => (
                  <li key={c.uid}>
                    <button onClick={() => navigate(`/compras/doc/${c.uid}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <span className="font-mono text-[13px]">{c.number}</span>
                      <span className="text-muted">{[c.doc_kind, c.doc_number].filter(Boolean).join(" ")}</span>
                      <span className="flex-1"><PurchaseStatusBadge c={c} /></span>
                      <span className="num font-medium">{formatMoney(c.total_minor)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {s.orders.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Órdenes de compra</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {s.orders.map((o) => (
                  <li key={o.uid}>
                    <button onClick={() => navigate(`/compras/oc/${o.uid}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <span className="font-mono text-[13px]">{o.number}</span>
                      <span className="num text-muted">{formatDate(o.issue_date)}</span>
                      <span className="flex-1"><PoStatusBadge status={o.status} /></span>
                      <span className="num font-medium">{formatMoney(o.total_minor)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
