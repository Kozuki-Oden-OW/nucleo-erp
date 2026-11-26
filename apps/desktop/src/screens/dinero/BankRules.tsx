// Reglas de conciliación: «cuando la glosa diga X, es tal cliente, tal gasto…». Las manuales las
// escribe la persona; las aprendidas las anota NÚCLEO cada vez que se concilia un movimiento.
import { useEffect, useState } from "react";
import { BrainCircuit, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useBackend, errorMessage, type BankRule, type BankRuleAction, type BankRuleDirection, type BankRuleInput, type Customer, type ExpenseCategory, type MoneyAccount, type Supplier,
} from "../../data";
import { formatRut } from "../../lib/format";
import { CustomerPicker, SupplierPicker } from "../ventas/pickers";
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Notice, Select, Spinner, TextArea } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

const ACTIONS: { value: BankRuleAction; label: string }[] = [
  { value: "cliente", label: "Es el pago de un cliente" },
  { value: "proveedor", label: "Es un pago a un proveedor" },
  { value: "gasto", label: "Es un gasto de una categoría" },
  { value: "traspaso", label: "Es un traspaso entre mis cuentas" },
  { value: "ignorar", label: "No se registra (se ignora)" },
];
const DIR: Record<BankRuleDirection, string> = { abono: "Abonos", cargo: "Cargos", ambos: "Abonos y cargos" };

type Draft = BankRuleInput & { uid: string | null; customer: Customer | null; supplier: Supplier | null };
const EMPTY: Draft = { uid: null, name: "", pattern: "", rut: "", direction: "cargo", action: "gasto", customer_uid: null, supplier_uid: null, category_id: null, account_uid: null, tax_included: false, note: "", active: true, customer: null, supplier: null };

export function BankRulesDialog({ open, onClose, cats, accounts, seed }: {
  open: boolean; onClose: () => void; cats: ExpenseCategory[]; accounts: MoneyAccount[];
  /** Texto de un movimiento para partir una regla nueva. */
  seed?: { pattern: string; direction: BankRuleDirection } | null;
}) {
  const backend = useBackend();
  const toast = useToast();
  const [rules, setRules] = useState<BankRule[] | null>(null);
  const [f, setF] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(seed ? { ...EMPTY, pattern: seed.pattern, direction: seed.direction, action: seed.direction === "abono" ? "cliente" : "gasto" } : null);
    backend.bankRules().then(setRules).catch((e) => setErr(errorMessage(e)));
  }, [backend, open, seed]);

  async function edit(r: BankRule) {
    const [customer, supplier] = await Promise.all([
      r.customer_uid ? backend.searchCustomers(r.target).then((x) => x.find((c) => c.uid === r.customer_uid) ?? null).catch(() => null) : null,
      r.supplier_uid ? backend.searchSuppliers(r.target).then((x) => x.find((c) => c.uid === r.supplier_uid) ?? null).catch(() => null) : null,
    ]);
    setErr(null);
    setF({ uid: r.uid, name: r.name, pattern: r.pattern, rut: r.rut ?? "", direction: r.direction, action: r.action, customer_uid: r.customer_uid, supplier_uid: r.supplier_uid, category_id: r.category_id, account_uid: r.account_uid, tax_included: r.tax_included ?? false, note: r.note ?? "", active: r.active, customer, supplier });
  }
  async function save() {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const { uid, customer, supplier, ...input } = f;
      setRules(await backend.saveBankRule({ ...input, customer_uid: customer?.uid ?? f.customer_uid, supplier_uid: supplier?.uid ?? f.supplier_uid, rut: f.rut?.trim() || null, name: uid ? f.name : "" }, uid));
      toast("success", "Regla guardada. Se aplica a los movimientos por revisar.");
      setF(null);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove(r: BankRule) {
    try { setRules(await backend.deleteBankRule(r.uid)); toast("success", "Regla eliminada."); } catch (e) { toast("danger", errorMessage(e)); }
  }
  const setAction = (a: BankRuleAction) => f && setF({ ...f, action: a, direction: a === "cliente" ? "abono" : a === "proveedor" || a === "gasto" ? "cargo" : f.direction });

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={<span className="inline-flex items-center gap-2"><BrainCircuit size={18} aria-hidden />Reglas de conciliación</span>}
      footer={f
        ? <><Button variant="ghost" onClick={() => setF(null)}>Volver</Button><Button onClick={save} disabled={busy}>Guardar regla</Button></>
        : <><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button icon={Plus} onClick={() => { setErr(null); setF(EMPTY); }}>Nueva regla</Button></>}>
      {f ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cuando la glosa diga" value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })} placeholder="Ej. LIPIGAS, COMISION MANTENCION" hint="Basta una parte del texto; no importan mayúsculas ni tildes." data-autofocus />
            <Field label="o el RUT de quien transfiere sea" optional value={f.rut ?? ""} onChange={(e) => setF({ ...f, rut: e.target.value })} placeholder="76.123.456-7" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Entonces" value={f.action} onChange={(e) => setAction(e.target.value as BankRuleAction)} options={ACTIONS} />
            <Select label="Aplica a" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as BankRuleDirection })}
              options={(Object.keys(DIR) as BankRuleDirection[]).filter((d) => (f.action === "cliente" ? d !== "cargo" : f.action === "proveedor" || f.action === "gasto" ? d !== "abono" : true)).map((d) => ({ value: d, label: DIR[d] }))} />
          </div>
          {f.action === "cliente" && <div><span className="mb-1.5 block text-[13px] font-medium text-ink">Cliente</span><CustomerPicker value={f.customer} onChange={(c) => setF({ ...f, customer: c, customer_uid: c?.uid ?? null })} allowWalkIn={false} onCreate={() => {}} /></div>}
          {f.action === "proveedor" && <div><span className="mb-1.5 block text-[13px] font-medium text-ink">Proveedor</span><SupplierPicker value={f.supplier} onChange={(s) => setF({ ...f, supplier: s, supplier_uid: s?.uid ?? null })} onCreate={() => {}} /></div>}
          {f.action === "gasto" && (
            <>
              <Select label="Categoría del gasto" value={f.category_id ? String(f.category_id) : ""} onChange={(e) => setF({ ...f, category_id: e.target.value ? Number(e.target.value) : null })}
                options={[{ value: "", label: "Elige una categoría…" }, ...cats.filter((c) => !c.archived).map((c) => ({ value: String(c.id), label: c.name }))]} />
              <Checkbox label="El monto incluye IVA" checked={!!f.tax_included} onChange={(v) => setF({ ...f, tax_included: v })} />
            </>
          )}
          {f.action === "traspaso" && <Select label="La otra cuenta" value={f.account_uid ?? ""} onChange={(e) => setF({ ...f, account_uid: e.target.value || null })} options={[{ value: "", label: "Elige una cuenta…" }, ...accounts.map((a) => ({ value: a.uid, label: a.name }))]} />}
          {f.action === "ignorar" && <TextArea label="Nota que queda en cada movimiento ignorado" rows={2} value={f.note ?? ""} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ej. comisión del banco, ya va en el gasto mensual" />}
          {f.uid && <Checkbox label="Regla activa" checked={f.active ?? true} onChange={(v) => setF({ ...f, active: v })} />}
          <p className="text-xs text-muted">Una regla no registra nada por su cuenta: pone la sugerencia correcta arriba para que la confirmes con un clic.</p>
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
      ) : err ? <Notice tone="danger">{err}</Notice> : !rules ? <Spinner /> : rules.length === 0 ? (
        <EmptyState icon={BrainCircuit} title="Aún no hay reglas">
          NÚCLEO las anota solo: cada vez que concilias un movimiento, recuerda quién era o qué gasto era, y la próxima vez lo propone arriba. También puedes escribir las tuyas.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.uid} className={`flex items-center gap-3 py-2.5 ${r.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{r.pattern ? `«${r.pattern}»` : `RUT ${formatRut(r.rut ?? "")}`}</span>
                  <span className="text-sm text-muted">→ {r.target}</span>
                  <Badge tone={r.origin === "manual" ? "accent" : "neutral"}>{r.origin === "manual" ? "Tuya" : "Aprendida"}</Badge>
                  {!r.active && <Badge>Pausada</Badge>}
                </div>
                <div className="text-xs text-muted">{DIR[r.direction]} · usada {r.hits} {r.hits === 1 ? "vez" : "veces"}{r.note ? ` · ${r.note}` : ""}</div>
              </div>
              <IconButton icon={Pencil} label={`Editar la regla ${r.name}`} size={15} onClick={() => void edit(r)} />
              <IconButton icon={Trash2} label={`Eliminar la regla ${r.name}`} size={15} onClick={() => void remove(r)} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
