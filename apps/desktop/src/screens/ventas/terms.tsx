// Condiciones del documento de venta: forma de pago con su detalle, referencias (OC, HES…) y
// datos del receptor que se completan desde la ficha del cliente.
import { Plus, Trash2 } from "lucide-react";
import type { Receiver, SalePayment, SaleReference, SaleTerms } from "../../data";
import { BANKS, CREDIT_DAYS, REFERENCE_KINDS } from "../../data/saleTerms";
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
  const put = (i: number, patch: Partial<SaleReference>) => onChange(refs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card title="Referencias" subtitle="Orden de compra, HES, nota de venta, guía de despacho… como en el facturador del SII."
      actions={<Button size="sm" variant="secondary" icon={Plus} onClick={() => onChange([...refs, { kind: refs.length ? "HES" : "801", folio: "", date: null, note: null }])}>Agregar referencia</Button>}>
      {refs.length === 0 ? <p className="text-sm text-muted">Sin referencias. Agrega la orden de compra o la HES si tu cliente la exige.</p> : (
        <div className="flex flex-col gap-2">
          {refs.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
              <Select label={i === 0 ? "Tipo" : undefined} aria-label="Tipo de referencia" value={r.kind} onChange={(e) => put(i, { kind: e.target.value })} options={REFERENCE_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              <Field label={i === 0 ? "N.º o folio" : undefined} aria-label="Número o folio" value={r.folio} onChange={(e) => put(i, { folio: e.target.value })} placeholder="Ej. 4500012345" />
              <Field label={i === 0 ? "Fecha" : undefined} aria-label="Fecha de la referencia" type="date" value={r.date ?? ""} onChange={(e) => put(i, { date: e.target.value || null })} />
              <Field label={i === 0 ? "Detalle" : undefined} aria-label="Detalle" optional value={r.note ?? ""} onChange={(e) => put(i, { note: e.target.value })} placeholder="Opcional" />
              <IconButton icon={Trash2} label="Quitar referencia" size={15} onClick={() => onChange(refs.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
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
