// Diálogos del ciclo de venta: efectuar, cobrar, documentar y anular.
import { useState } from "react";
import { BadgeCheck, Ban, CreditCard, HandCoins } from "lucide-react";
import { useBackend, errorMessage, type SaleDetail } from "../../data";
import { EXTERNAL_DOC_KINDS, PAYMENT_METHODS } from "../../data/catalogs";
import { addDays, formatMoney, todayIso } from "../../lib/format";
import { MoneyField } from "../../ui/doc";
import { Button, Field, Notice, Segmented, Select, TextArea } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

type Done = (s: SaleDetail) => void;

export function EffectDialog({ sale, open, onClose, onDone }: { sale: SaleDetail; open: boolean; onClose: () => void; onDone: Done }) {
  const backend = useBackend();
  const toast = useToast();
  const [mode, setMode] = useState<"contado" | "credito">("contado");
  const [method, setMethod] = useState(PAYMENT_METHODS[0]!);
  const [due, setDue] = useState(addDays(todayIso(), 30));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const s = await backend.effectSale(sale.uid, { mode, method, due_date: mode === "credito" ? due : null });
      toast("success", `${s.number} efectuada.${s.documentation_state === "pendiente" ? " Quedó pendiente de documentación tributaria." : ""}`);
      onDone(s); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Marcar venta como efectuada"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={BadgeCheck} onClick={go} disabled={busy}>{busy ? "Registrando…" : "Confirmar venta"}</Button></>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Al confirmar se descuenta el stock, se fijan el costo y la ganancia de cada línea y se registra el cobro o la deuda del cliente.
          Los montos ya no se podrán editar (solo anular).
        </p>
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">{sale.number} · {sale.customer_name}</span><span className="num font-semibold text-ink">{formatMoney(sale.total_minor)}</span></div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">¿Cómo te paga?</span>
          <Segmented label="Forma de pago" value={mode} onChange={setMode} options={[{ value: "contado", label: "Al contado", icon: HandCoins }, { value: "credito", label: "A crédito", icon: CreditCard }]} />
        </div>
        {mode === "contado" ? (
          <Select label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
        ) : (
          <Field label="Fecha en que te pagará" type="date" value={due} onChange={(e) => setDue(e.target.value)} hint="Aparecerá en “Dinero que te deben” y en el calendario de cobros." />
        )}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function PaymentDialog({ sale, open, onClose, onDone }: { sale: SaleDetail; open: boolean; onClose: () => void; onDone: Done }) {
  const backend = useBackend();
  const toast = useToast();
  const due = sale.total_minor - sale.paid_minor;
  const [amount, setAmount] = useState<number | null>(due);
  const [method, setMethod] = useState(PAYMENT_METHODS[1]!);
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!amount) return;
    setBusy(true); setErr(null);
    try {
      const s = await backend.registerPayment(sale.uid, amount, method, date);
      toast("success", amount === due ? "Pago registrado: la venta quedó pagada." : `Abono de ${formatMoney(amount)} registrado.`);
      onDone(s); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Registrar pago" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={HandCoins} onClick={go} disabled={busy || !amount}>Registrar</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Saldo pendiente de {sale.number}: <strong className="num text-ink">{formatMoney(due)}</strong>. Puedes registrar un abono menor.</p>
        <MoneyField label="Monto recibido" value={amount} onValue={setAmount} data-autofocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
          <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function DocumentDialog({ sale, open, onClose, onDone }: { sale: SaleDetail; open: boolean; onClose: () => void; onDone: Done }) {
  const backend = useBackend();
  const toast = useToast();
  const [kind, setKind] = useState(EXTERNAL_DOC_KINDS[0]!);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayIso());
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const s = await backend.markDocumented(sale.uid, { doc_kind: kind, external_number: number || undefined, issue_date: date || undefined, observation: obs || undefined });
      toast("success", `${s.number} quedó documentada.`);
      onDone(s); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Marcar como documentada" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={BadgeCheck} onClick={go} disabled={busy}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Notice tone="info">
          Anota el documento que emitiste en el sistema oficial. <strong>Todos los campos son opcionales.</strong> NÚCLEO solo guarda esta referencia:
          no emite, no envía nada y no se conecta con ningún sistema tributario.
        </Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Tipo de documento" value={kind} onChange={(e) => setKind(e.target.value)} options={EXTERNAL_DOC_KINDS.map((k) => ({ value: k, label: k }))} />
          <Field label="Número o folio externo" optional value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ej. 563" data-autofocus />
          <Field label="Fecha de emisión" optional type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <TextArea label="Observación" optional value={obs} onChange={(e) => setObs(e.target.value)} />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

export function VoidDialog({ sale, open, onClose, onDone }: { sale: SaleDetail; open: boolean; onClose: () => void; onDone: Done }) {
  const backend = useBackend();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const effected = sale.commercial_state === "efectuada" || sale.commercial_state === "cerrada";
  async function go() {
    setBusy(true); setErr(null);
    try {
      const s = await backend.voidSale(sale.uid, reason);
      toast("info", `${s.number} anulada.`);
      onDone(s); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={`Anular ${sale.number}`} size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon={Ban} onClick={go} disabled={busy || !reason.trim()}>Anular venta</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {effected ? "Se devolverá el stock y la venta dejará de contar en tus números. " : ""}
          La venta no se borra: queda anulada, con su motivo, en la auditoría.
          {sale.documentation_state === "documentada" ? " Recuerda anular también el documento tributario en el sistema oficial, si corresponde." : ""}
        </p>
        <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. el cliente desistió de la compra" data-autofocus />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
