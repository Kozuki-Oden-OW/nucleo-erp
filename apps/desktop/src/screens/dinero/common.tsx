// Piezas compartidas de Dinero: selector de cuenta, diálogo de pago, estados y tablas de vencimientos.
import { useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { useBackend, errorMessage, type AccountKind, type DueRow, type ExpenseSummary, type MoneyAccount } from "../../data";
import { PAYMENT_METHODS } from "../../data/catalogs";
import { daysBetween, formatDate, formatMoney, todayIso } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Field, Notice, Select, type Tone } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

export const ACCOUNT_KIND: Record<AccountKind, string> = { caja: "Caja", banco: "Banco", billetera: "Billetera digital" };

/** Cuenta que NÚCLEO usaría sin elección explícita (misma regla que el backend). */
export function autoAccount(accounts: MoneyAccount[], method: string): MoneyAccount | undefined {
  const cash = method.toLowerCase().startsWith("efect");
  const order: AccountKind[] = cash ? ["caja", "banco", "billetera"] : ["banco", "billetera", "caja"];
  for (const k of order) {
    const a = accounts.find((x) => x.kind === k && !x.archived);
    if (a) return a;
  }
  return undefined;
}

export function accountLabel(a: MoneyAccount): string {
  return [a.name, a.account_label].filter(Boolean).join(" · ");
}

/** Cuentas activas, si el backend tiene Dinero y la persona puede verlas; null mientras carga o si no aplica. */
export function useAccounts(): MoneyAccount[] | null {
  const backend = useBackend();
  const { can } = useSession();
  const [accs, setAccs] = useState<MoneyAccount[] | null>(null);
  const enabled = backend.features.has("dinero") && can("dinero.ver");
  useEffect(() => {
    if (!enabled) return;
    backend.moneyAccounts().then((a) => setAccs(a.filter((x) => !x.archived))).catch(() => setAccs(null));
  }, [backend, enabled]);
  return accs;
}

/**
 * Selector "¿En qué cuenta entra/sale?". Vacío = automática según el medio de pago.
 * Con una sola cuenta no se muestra: no hay nada que elegir.
 */
export function AccountSelect({ value, onChange, method, label = "Cuenta" }: { value: string; onChange: (uid: string) => void; method: string; label?: string }) {
  const accs = useAccounts();
  if (!accs || accs.length < 2) return null;
  const auto = autoAccount(accs, method);
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[{ value: "", label: `Automática${auto ? ` (${auto.name})` : ""}` }, ...accs.map((a) => ({ value: a.uid, label: accountLabel(a) }))]}
    />
  );
}

/** Diálogo genérico para pagar o cobrar un saldo (gastos, y reutilizable). */
export function PayDialog({ title, due, onClose, onPay }: {
  title: string;
  due: number;
  onClose: () => void;
  onPay: (amount: number, method: string, date: string, accountUid?: string) => Promise<string>;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(due);
  const [method, setMethod] = useState(PAYMENT_METHODS[1]!);
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(null);
    try { toast("success", await onPay(amount ?? 0, method, date, account || undefined)); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={HandCoins} onClick={go} disabled={busy || !amount}>Registrar pago</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm"><div className="flex justify-between"><span className="text-muted">Saldo pendiente</span><span className="num font-semibold">{formatMoney(due)}</span></div></div>
        <MoneyField label="Monto" value={amount} onValue={setAmount} hint="Puedes pagar una parte (abono)." data-autofocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
          <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <AccountSelect value={account} onChange={setAccount} method={method} label="Sale de la cuenta" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

const EXPENSE_STATE: Record<ExpenseSummary["payment_state"], [string, Tone]> = {
  pagado: ["Pagado", "success"], abonado: ["Abonado", "info"], por_pagar: ["Por pagar", "warning"], anulado: ["Anulado", "neutral"],
};

export function ExpenseStateBadge({ g }: { g: Pick<ExpenseSummary, "payment_state" | "due_date"> }) {
  const [label, tone] = EXPENSE_STATE[g.payment_state];
  const late = (g.payment_state === "por_pagar" || g.payment_state === "abonado") && g.due_date && g.due_date < todayIso();
  return <Badge tone={late ? "danger" : tone}>{late ? `${label} · atrasado` : label}</Badge>;
}

/** Días de atraso como texto corto ("Hoy", "En 5 días", "Atrasado 12 días"). */
export function dueText(due: string, today = todayIso()): { text: string; tone: Tone } {
  const d = daysBetween(today, due);
  if (d < 0) return { text: `Atrasado ${-d} ${d === -1 ? "día" : "días"}`, tone: "danger" };
  if (d === 0) return { text: "Vence hoy", tone: "warning" };
  if (d <= 7) return { text: `En ${d} ${d === 1 ? "día" : "días"}`, tone: "warning" };
  return { text: `En ${d} días`, tone: "neutral" };
}

export function DueTable({ rows, kind, empty }: { rows: DueRow[]; kind: "cobro" | "pago"; empty: React.ReactNode }) {
  const cols: Column<DueRow>[] = [
    { key: "v", header: "Vence", width: "7rem", render: (r) => <span className="num text-muted">{formatDate(r.due_date)}</span> },
    { key: "s", header: "Plazo", width: "10rem", render: (r) => { const d = dueText(r.due_date); return <Badge tone={d.tone}>{d.text}</Badge>; } },
    { key: "p", header: kind === "cobro" ? "Cliente" : "A quién", render: (r) => <span className="text-ink">{r.party}</span> },
    { key: "d", header: "Documento", render: (r) => <span className="truncate text-muted">{r.document}</span> },
    { key: "m", header: "Monto", width: "8rem", align: "right", render: (r) => <span className="num text-muted">{formatMoney(r.amount_minor)}</span> },
    { key: "x", header: "Saldo", width: "8.5rem", align: "right", render: (r) => <span className="num font-medium">{formatMoney(r.pending_minor)}</span> },
  ];
  return <DataTable label={kind === "cobro" ? "Dinero que te deben" : "Dinero que debes"} columns={cols} rows={rows} rowKey={(r) => r.link + r.document} onOpen={(r) => navigate(r.link)} empty={empty} />;
}
