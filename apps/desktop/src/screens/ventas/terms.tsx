// Condiciones del documento de venta: forma de pago con su detalle, referencias (OC, HES…) y
// datos del receptor que se completan desde la ficha del cliente.
import { useEffect, useState } from "react";
import { Archive, Check, Plus, Tags, Trash2, X } from "lucide-react";
import { useBackend, errorMessage, type Receiver, type ReferenceKind, type SalePayment, type SaleReference, type SaleTerms } from "../../data";
import { BANKS, CREDIT_DAYS, REFERENCE_KINDS, referenceLabel } from "../../data/saleTerms";
import { Dialog, useToast } from "../../ui/overlay";
import { addDays, formatDate } from "../../lib/format";
import { Button, Card, Checkbox, Field, IconButton, Notice, Segmented, Select, cx } from "../../ui/kit";
import { REGIONS } from "../../data/lre";

const PAYMENTS: { value: Exclude<SalePayment, "">; label: string }[] = [
  { value: "efectivo", label: "Efectivo" }, { value: "tarjeta", label: "Tarjeta" }, { value: "transferencia", label: "Transferencia" },
  { value: "credito", label: "Crédito" }, { value: "cheque", label: "Cheque" },
];

export function PaymentCard({ terms, onChange, issueDate, hasCustomer, creditWarning }: {
  terms: SaleTerms; onChange: (t: SaleTerms) => void; issueDate: string; hasCustomer: boolean; creditWarning?: string | null;
}) {
  const set = (patch: Partial<SaleTerms>) => onChange({ ...terms, ...patch });
  const days = terms.credit_days ?? 30;
  const due = terms.due_date ?? addDays(issueDate, days);
  return (
    <Card title="Forma de pago" subtitle="Se usa al marcar la venta como efectuada y aparece en el documento.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Forma de pago">
          {PAYMENTS.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={terms.payment === p.value}
              onClick={() => set({ payment: terms.payment === p.value ? "" : p.value, ...(p.value === "credito" && !terms.credit_days ? { credit_days: 30, due_date: null } : {}) })}
              className={cx("h-9 rounded-lg border px-3.5 text-sm font-medium transition-colors",
                terms.payment === p.value ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink")}>
              {p.label}
            </button>
          ))}
        </div>
        {terms.payment === "tarjeta" && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">Tipo de tarjeta</span>
              <Segmented label="Tipo de tarjeta" value={terms.card ?? "debito"} onChange={(v) => set({ card: v })} options={[{ value: "debito", label: "Débito" }, { value: "credito", label: "Crédito" }]} />
            </div>
            <Field label="N.º de operación o voucher" optional value={terms.operation ?? ""} onChange={(e) => set({ operation: e.target.value })} className="w-56" />
          </div>
        )}
        {(terms.payment === "transferencia" || terms.payment === "cheque") && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col">
              <Field label="Banco" optional list="nucleo-bancos" value={terms.bank ?? ""} onChange={(e) => set({ bank: e.target.value })} placeholder="Ej. Banco Estado" />
              <datalist id="nucleo-bancos">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            {terms.payment === "transferencia" && (
              <Field label="Fecha de la transferencia" type="date" value={terms.transfer_date ?? ""} onChange={(e) => set({ transfer_date: e.target.value || null })} />
            )}
            <Field label={terms.payment === "cheque" ? "N.º de cheque" : "N.º de operación"} optional value={terms.operation ?? ""} onChange={(e) => set({ operation: e.target.value })} />
          </div>
        )}
        {terms.payment === "credito" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <span className="w-full text-[13px] font-medium text-ink">Días de crédito</span>
              {CREDIT_DAYS.map((d) => (
                <button key={d} type="button" onClick={() => set({ credit_days: d, due_date: null })}
                  className={cx("h-8 rounded-md border px-3 text-sm", days === d && !terms.due_date ? "border-accent bg-accent-soft text-ink" : "border-line text-muted hover:text-ink")}>
                  {d} días
                </button>
              ))}
              <Field aria-label="Otros días" inputMode="numeric" className="w-28" suffix="días" inputClassName="text-right num"
                value={CREDIT_DAYS.includes(days) && !terms.due_date ? "" : String(days)} placeholder="Otro"
                onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); set({ credit_days: n || null, due_date: null }); }} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Vence el" type="date" value={due} min={issueDate} className="w-48"
                onChange={(e) => { const v = e.target.value; if (!v) return; set({ due_date: v, credit_days: Math.max(1, Math.round((Date.parse(v) - Date.parse(issueDate)) / 86_400_000)) }); }} />
              <span className="pb-2 text-sm text-muted">{days} días desde el {formatDate(issueDate)}</span>
            </div>
            {!hasCustomer && <Notice tone="warning">Para vender a crédito elige un cliente: necesitamos saber quién te debe.</Notice>}
            {hasCustomer && creditWarning && <Notice tone="warning">{creditWarning}</Notice>}
          </div>
        )}
      </div>
    </Card>
  );
}

export function ReferencesCard({ refs, onChange }: { refs: SaleReference[]; onChange: (r: SaleReference[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [kinds, setKinds] = useState<ReferenceKind[]>(REFERENCE_KINDS.map((k) => ({ code: k.value, label: k.label, custom_id: null })));
  const [adding, setAdding] = useState<{ row: number; name: string } | null>(null);
  const [managing, setManaging] = useState(false);
  useEffect(() => { backend.referenceKinds().then(setKinds).catch(() => {}); }, [backend]);
  const put = (i: number, patch: Partial<SaleReference>) => onChange(refs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const options = (current: string) => [
    ...kinds.map((k) => ({ value: k.code, label: k.label })),
    // Un tipo propio ya archivado se sigue mostrando en los documentos que lo usan.
    ...(current && !kinds.some((k) => k.code === current) ? [{ value: current, label: referenceLabel(current) }] : []),
    { value: "__nuevo", label: "+ Nuevo tipo…" },
  ];
  async function create() {
    if (!adding?.name.trim()) return;
    try {
      const list = await backend.addReferenceKind(adding.name);
      setKinds(list);
      const made = list.find((k) => k.custom_id !== null && k.label.toLowerCase() === adding.name.trim().toLowerCase());
      if (made && adding.row >= 0) put(adding.row, { kind: made.code });
      setAdding(null);
    } catch (e) { toast("danger", errorMessage(e)); }
  }
  const own = kinds.filter((k) => k.custom_id !== null);
  return (
    <Card title="Referencias" subtitle="Orden de compra, HES, guía de despacho, Mercado Libre, pedido de internet… o un tipo propio."
      actions={<>
        <Button size="sm" variant="ghost" icon={Tags} onClick={() => setManaging(true)}>Tipos</Button>
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...refs, { kind: refs.length ? "HES" : "801", folio: "", date: null, note: null }])}>Agregar referencia</Button>
      </>}>
      {refs.length === 0 ? <p className="text-sm text-muted">Sin referencias. Agrega la orden de compra, la HES o el número del pedido de Mercado Libre o de tu tienda online.</p> : (
        <div className="flex flex-col gap-2">
          {refs.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
              {adding?.row === i ? (
                <div className="flex items-end gap-1.5">
                  <Field label={i === 0 ? "Nuevo tipo" : undefined} aria-label="Nombre del nuevo tipo" value={adding.name} autoFocus placeholder="Ej. Falabella"
                    onChange={(e) => setAdding({ row: i, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } if (e.key === "Escape") setAdding(null); }} className="min-w-0 flex-1" />
                  <IconButton icon={Check} label="Crear tipo" size={15} onClick={() => void create()} />
                  <IconButton icon={X} label="Cancelar" size={15} onClick={() => setAdding(null)} />
                </div>
              ) : (
                <Select label={i === 0 ? "Tipo" : undefined} aria-label="Tipo de referencia" value={r.kind}
                  onChange={(e) => e.target.value === "__nuevo" ? setAdding({ row: i, name: "" }) : put(i, { kind: e.target.value })} options={options(r.kind)} />
              )}
              <Field label={i === 0 ? "N.º o folio" : undefined} aria-label="Número o folio" value={r.folio} onChange={(e) => put(i, { folio: e.target.value })} placeholder="Ej. 4500012345" />
              <Field label={i === 0 ? "Fecha" : undefined} aria-label="Fecha de la referencia" type="date" value={r.date ?? ""} onChange={(e) => put(i, { date: e.target.value || null })} />
              <Field label={i === 0 ? "Detalle" : undefined} aria-label="Detalle" optional value={r.note ?? ""} onChange={(e) => put(i, { note: e.target.value })} placeholder="Opcional" />
              <IconButton icon={Trash2} label="Quitar referencia" size={15} onClick={() => onChange(refs.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
      <Dialog open={managing} onClose={() => { setManaging(false); setAdding(null); }} size="sm" title="Tipos de referencia propios"
        footer={<Button variant="ghost" onClick={() => { setManaging(false); setAdding(null); }}>Cerrar</Button>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">Además de los del SII, Mercado Libre, pedido de internet, WhatsApp y redes sociales, puedes crear los tuyos: Falabella, Ripley, feria, tienda física…</p>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <Field label="Nuevo tipo" value={adding?.row === -1 ? adding.name : ""} onChange={(e) => setAdding({ row: -1, name: e.target.value })} placeholder="Ej. Falabella" className="flex-1" />
            <Button type="submit" icon={Plus} disabled={!(adding?.row === -1 && adding.name.trim())}>Crear</Button>
          </form>
          {own.length === 0 ? <p className="text-sm text-muted">Aún no tienes tipos propios.</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {own.map((k) => (
                <li key={k.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-ink">{k.label}</span>
                  <IconButton icon={Archive} label={`Archivar ${k.label}`} size={15}
                    onClick={async () => { try { setKinds(await backend.archiveReferenceKind(k.custom_id!)); } catch (e) { toast("danger", errorMessage(e)); } }} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Archivar no cambia los documentos que ya lo usan.</p>
        </div>
      </Dialog>
    </Card>
  );
}

export function ReceiverCard({ receiver, onChange, saveToCustomer, onSaveToCustomer, canSave }: {
  receiver: Receiver; onChange: (r: Receiver) => void; saveToCustomer: boolean; onSaveToCustomer: (v: boolean) => void; canSave: boolean;
}) {
  const set = (patch: Partial<Receiver>) => onChange({ ...receiver, ...patch });
  const f = (k: keyof Receiver) => receiver[k] ?? "";
  return (
    <Card title="Datos del receptor" subtitle="Se completan solos desde la ficha del cliente. Puedes corregirlos para este documento.">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label="RUT" value={f("rut")} onChange={(e) => set({ rut: e.target.value })} placeholder="12.345.678-5" />
          <Field label="Razón social" value={f("name")} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <Field label="Giro" value={f("activity")} onChange={(e) => set({ activity: e.target.value })} />
        <Field label="Dirección" value={f("address")} onChange={(e) => set({ address: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Comuna" value={f("commune")} onChange={(e) => set({ commune: e.target.value })} />
          <Field label="Ciudad" value={f("city")} onChange={(e) => set({ city: e.target.value })} />
          <Select label="Región" value={f("region")} onChange={(e) => set({ region: e.target.value || null })}
            options={regionOptions(f("region"))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Contacto" optional value={f("contact")} onChange={(e) => set({ contact: e.target.value })} />
          <Field label="Correo" optional value={f("email")} onChange={(e) => set({ email: e.target.value })} />
          <Field label="Teléfono" optional value={f("phone")} onChange={(e) => set({ phone: e.target.value })} />
        </div>
        {canSave && <Checkbox label="Guardar estos datos en la ficha del cliente" hint="Así se completan solos la próxima vez." checked={saveToCustomer} onChange={onSaveToCustomer} />}
      </div>
    </Card>
  );
}

/** Regiones de Chile; conserva un valor anterior que no esté en la lista. */
function regionOptions(current: string): { value: string; label: string }[] {
  const names = REGIONS.map(([, n]) => n);
  return [{ value: "", label: "—" }, ...(current && !names.includes(current) ? [current] : []).concat(names).map((n) => ({ value: n, label: n }))];
}
