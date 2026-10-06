// Cuentas de dinero (cajas, bancos, billeteras): saldo, movimientos, traspasos y archivo.
import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowLeftRight, Building2, Pencil, Plus, Smartphone, Wallet } from "lucide-react";
import { useBackend, errorMessage, type AccountInput, type AccountKind, type LedgerRow, type MoneyAccount } from "../../data";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Checkbox, Field, Notice, Select, Spinner } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";
import { ACCOUNT_KIND, accountLabel } from "./common";

const ICON: Record<AccountKind, typeof Wallet> = { caja: Wallet, banco: Building2, billetera: Smartphone };
const LEDGER_KIND: Record<LedgerRow["kind"], string> = { cobro: "Cobro", pago: "Pago", traspaso_entrada: "Traspaso", traspaso_salida: "Traspaso" };

export function AccountsTab({ route, onChanged }: { route: Route; onChanged: () => void }) {
  const backend = useBackend();
  const { can } = useSession();
  const [accs, setAccs] = useState<MoneyAccount[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const viewing = route.query.get("cuenta");
  const creating = route.query.get("nueva") === "1";
  const transfer = route.query.get("traspaso") === "1";
  const write = can("dinero.registrar");
  const load = useCallback(() => { backend.moneyAccounts().then(setAccs).catch((e) => setErr(errorMessage(e))); }, [backend]);
  useEffect(load, [load]);
  const close = () => navigate("/dinero?tab=cuentas", { replace: true });
  const changed = (a: MoneyAccount[]) => { setAccs(a); onChanged(); };

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!accs) return <Spinner />;
  const archived = accs.filter((a) => a.archived);
  const shown = accs.filter((a) => showArchived || !a.archived);
  const total = accs.filter((a) => !a.archived).reduce((x, a) => x + a.balance_minor, 0);
  const current = accs.find((a) => a.uid === viewing);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">Total en cuentas activas: <strong className="num text-ink">{formatMoney(total)}</strong></span>
        <div className="flex flex-wrap items-center gap-3">
          {archived.length > 0 && <Checkbox label={`Ver archivadas (${archived.length})`} checked={showArchived} onChange={setShowArchived} />}
          {write && <Button size="sm" variant="secondary" icon={Plus} onClick={() => navigate("/dinero?tab=cuentas&nueva=1", { replace: true })}>Nueva cuenta</Button>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => {
          const I = ICON[a.kind];
          return (
            <button key={a.uid} onClick={() => navigate(`/dinero?tab=cuentas&cuenta=${a.uid}`, { replace: true })}
              className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-accent/50">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><I size={18} aria-hidden /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{a.name}</div>
                  <div className="truncate text-xs text-muted">{[ACCOUNT_KIND[a.kind], a.bank_name, a.account_label].filter(Boolean).join(" · ")}</div>
                </div>
                {a.archived && <Badge>Archivada</Badge>}
              </div>
              <div className={`num text-[22px] font-semibold leading-tight ${a.balance_minor < 0 ? "text-danger" : "text-ink"}`}>{formatMoney(a.balance_minor)}</div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">El saldo se calcula con el saldo inicial más los cobros, pagos y traspasos registrados en NÚCLEO. Compáralo con tu cartola: si no cuadra, falta registrar algo.</p>
      {current && <AccountDrawer account={current} accounts={accs} onClose={close} onChanged={changed} />}
      {(creating || (current && route.query.get("editar") === "1")) && (
        <AccountFormDialog editing={creating ? undefined : current} onClose={() => navigate(creating ? "/dinero?tab=cuentas" : `/dinero?tab=cuentas&cuenta=${current!.uid}`, { replace: true })}
          onSaved={(a) => { changed(a); navigate(creating ? "/dinero?tab=cuentas" : `/dinero?tab=cuentas&cuenta=${current!.uid}`, { replace: true }); }} />
      )}
      {transfer && <TransferDialog accounts={accs.filter((a) => !a.archived)} onClose={close} onDone={(a) => { changed(a); close(); }} />}
    </div>
  );
}

function AccountDrawer({ account, accounts, onClose, onChanged }: { account: MoneyAccount; accounts: MoneyAccount[]; onClose: () => void; onChanged: (a: MoneyAccount[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRows(null); backend.accountLedger(account.uid).then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend, account.uid, account.balance_minor]);
  const write = can("dinero.registrar") && !account.archived;
  async function archive() {
    try { onChanged(await backend.archiveMoneyAccount(account.uid)); toast("success", `${account.name} archivada.`); onClose(); }
    catch (e) { toast("danger", errorMessage(e)); }
  }
  return (
    <Drawer open onClose={onClose} title={accountLabel(account)} subtitle={`${ACCOUNT_KIND[account.kind]}${account.bank_name ? ` · ${account.bank_name}` : ""} · saldo ${formatMoney(account.balance_minor)}`}
      footer={write ? (
        <>
          <Button variant="ghost" icon={Archive} onClick={archive} disabled={accounts.filter((a) => !a.archived).length <= 1}>Archivar</Button>
          <Button variant="secondary" icon={Pencil} onClick={() => navigate(`/dinero?tab=cuentas&cuenta=${account.uid}&editar=1`, { replace: true })}>Editar</Button>
          <Button icon={ArrowLeftRight} onClick={() => navigate("/dinero?tab=cuentas&traspaso=1", { replace: true })}>Traspasar</Button>
        </>
      ) : undefined}>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Saldo inicial{account.opening_date ? ` (${formatDate(account.opening_date)})` : ""}</span><span className="num">{formatMoney(account.opening_minor)}</span></div>
          <div className="mt-1 flex justify-between font-semibold"><span>Saldo actual</span><span className="num">{formatMoney(account.balance_minor)}</span></div>
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
        {!rows ? <Spinner /> : rows.length === 0 ? <p className="text-sm text-muted">Sin movimientos todavía.</p> : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {rows.map((r, i) => (
              <li key={i} className={`flex items-start gap-3 py-2.5 ${r.status === "anulado" ? "opacity-55" : ""}`}>
                <div className="min-w-0 flex-1">
                  {r.link ? <button className="truncate text-left text-ink hover:text-accent hover:underline" onClick={() => navigate(r.link!)}>{r.detail}</button> : <div className="truncate text-ink">{r.detail}</div>}
                  <div className="num text-xs text-muted">{formatDate(r.date)} · {LEDGER_KIND[r.kind]} {r.document !== "Traspaso" && r.document}{r.status === "anulado" && " · anulado"}</div>
                </div>
                <span className={`num shrink-0 font-medium ${r.status === "anulado" ? "line-through" : r.amount_minor > 0 ? "text-success" : "text-ink"}`}>{r.amount_minor > 0 ? "+" : "−"}{formatMoney(Math.abs(r.amount_minor))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

function AccountFormDialog({ editing, onClose, onSaved }: { editing?: MoneyAccount; onClose: () => void; onSaved: (a: MoneyAccount[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [f, setF] = useState<AccountInput>(editing
    ? { kind: editing.kind, name: editing.name, bank_name: editing.bank_name ?? "", account_label: editing.account_label ?? "", opening_minor: editing.opening_minor, opening_date: editing.opening_date ?? todayIso() }
    : { kind: "banco", name: "", bank_name: "", account_label: "", opening_minor: 0, opening_date: todayIso() });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = editing ? await backend.updateMoneyAccount(editing.uid, f) : await backend.createMoneyAccount(f);
      toast("success", editing ? "Cuenta actualizada." : `Cuenta “${f.name.trim()}” creada.`);
      onSaved(r);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={editing ? `Editar ${editing.name}` : "Nueva cuenta"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy || !f.name.trim()}>{editing ? "Guardar" : "Crear cuenta"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })} options={(Object.keys(ACCOUNT_KIND) as AccountKind[]).map((k) => ({ value: k, label: ACCOUNT_KIND[k] }))} />
          <Field label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "caja" ? "Ej. Caja del local" : "Ej. Cuenta corriente"} data-autofocus />
        </div>
        {f.kind !== "caja" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banco o servicio" optional value={f.bank_name ?? ""} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
            <Field label="Referencia" optional value={f.account_label ?? ""} onChange={(e) => setF({ ...f, account_label: e.target.value })} placeholder="Ej. CC ···· 4821" hint="Solo los últimos 4 dígitos: NÚCLEO no guarda números de cuenta completos." />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Saldo inicial" value={f.opening_minor} onValue={(v) => setF({ ...f, opening_minor: v ?? 0 })} hint="Lo que había en la cuenta en la fecha de inicio." />
          <Field label="Fecha del saldo inicial" type="date" value={f.opening_date ?? ""} onChange={(e) => setF({ ...f, opening_date: e.target.value })} />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function TransferDialog({ accounts, onClose, onDone }: { accounts: MoneyAccount[]; onClose: () => void; onDone: (a: MoneyAccount[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [from, setFrom] = useState(accounts.find((a) => a.kind === "caja")?.uid ?? accounts[0]?.uid ?? "");
  const [to, setTo] = useState(accounts.find((a) => a.uid !== from && a.kind === "banco")?.uid ?? accounts.find((a) => a.uid !== from)?.uid ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const src = accounts.find((a) => a.uid === from);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await backend.transferMoney({ from_uid: from, to_uid: to, date, amount_minor: amount ?? 0, notes: notes.trim() || undefined });
      toast("success", `Traspaso de ${formatMoney(amount ?? 0)} registrado.`);
      onDone(r);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  if (accounts.length < 2) {
    return (
      <Dialog open onClose={onClose} title="Traspasar entre cuentas" footer={<Button onClick={() => navigate("/dinero?tab=cuentas&nueva=1", { replace: true })}>Crear otra cuenta</Button>}>
        <p className="text-sm text-muted">Necesitas al menos dos cuentas activas para traspasar dinero (por ejemplo, depositar el efectivo de la caja en el banco).</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title="Traspasar entre cuentas"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={ArrowLeftRight} onClick={go} disabled={busy || !amount || from === to}>Traspasar</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Mueve dinero entre tus propias cuentas: no es venta ni gasto, solo cambia dónde está.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Desde" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value === to) setTo(accounts.find((a) => a.uid !== e.target.value)?.uid ?? ""); }} options={accounts.map((a) => ({ value: a.uid, label: `${a.name} (${formatMoney(a.balance_minor)})` }))} />
          <Select label="Hacia" value={to} onChange={(e) => setTo(e.target.value)} options={accounts.filter((a) => a.uid !== from).map((a) => ({ value: a.uid, label: a.name }))} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField label="Monto" value={amount} onValue={setAmount} hint={src ? `Saldo en ${src.name}: ${formatMoney(src.balance_minor)}` : undefined} data-autofocus />
          <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Field label="Nota" optional value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. depósito del efectivo de la semana" />
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
