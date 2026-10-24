// Cobro en terreno: elegir la venta que te pagan, el monto y cómo te pagó.
import { useEffect, useMemo, useState } from "react";
import { Check, HandCoins, Search } from "lucide-react";
import { errorMessage, useBackend, type SaleSummary } from "../../data";
import { daysBetween, formatDate, formatMoney, todayIso } from "../../lib/format";
import { useToast } from "../../ui/overlay";
import { cx } from "../../ui/kit";
import { useNav } from "../MobileApp";
import { outbox } from "../outbox";
import { BigButton, Chip, Empty, MoneyInput, Panel, TopBar } from "../ui";

const METHODS = ["Efectivo", "Transferencia", "Tarjeta de débito", "Cheque"];

export function Collect({ saleUid }: { saleUid?: string }) {
  const backend = useBackend();
  const toast = useToast();
  const nav = useNav();
  const [rows, setRows] = useState<SaleSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<SaleSummary | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState("Transferencia");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.listSales({ view: "por_cobrar" }).then((r) => {
      const sorted = [...r].sort((a, b) => (a.due_date ?? a.issue_date).localeCompare(b.due_date ?? b.issue_date));
      setRows(sorted);
      const pre = saleUid ? sorted.find((s) => s.uid === saleUid) : undefined;
      if (pre) { setPick(pre); setAmount(pre.total_minor - pre.paid_minor); }
    }).catch(() => setRows([]));
  }, [backend, saleUid]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((s) => !n || `${s.customer_name} ${s.number}`.toLowerCase().includes(n));
  }, [rows, q]);
  const due = pick ? pick.total_minor - pick.paid_minor : 0;

  async function save() {
    if (!pick || !amount) return;
    setBusy(true);
    try {
      await backend.registerPayment(pick.uid, amount, method, todayIso());
      outbox.add("cobro", `Cobro de ${pick.number} · ${pick.customer_name}`, amount);
      toast("success", amount >= due ? "Cobro registrado: la venta quedó pagada." : "Abono registrado.");
      nav.back();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  if (pick) {
    return (
      <>
        <TopBar title="Registrar cobro" onBack={() => (saleUid ? nav.back() : setPick(null))} />
        <div className="space-y-5 px-4 pt-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-[13px] text-muted">{pick.number} · {formatDate(pick.issue_date)}</div>
            <div className="mt-0.5 text-[17px] font-semibold text-ink">{pick.customer_name}</div>
            <div className="mt-2 flex items-end justify-between"><span className="text-[14px] text-muted">Por cobrar</span><span className="num text-[22px] font-bold text-ink">{formatMoney(due)}</span></div>
          </div>
          <MoneyInput label="¿Cuánto te pagó?" value={amount} onValue={setAmount} />
          {amount !== null && amount > due && <p className="-mt-3 text-[13px] text-danger">Es más de lo que te debe en esta venta.</p>}
          <div>
            <span className="mb-1.5 block text-[14px] font-medium text-ink">¿Cómo te pagó?</span>
            <div className="flex flex-wrap gap-2">{METHODS.map((m) => <Chip key={m} active={method === m} onClick={() => setMethod(m)}>{m}</Chip>)}</div>
          </div>
          <BigButton icon={Check} onClick={save} disabled={busy || !amount || amount > due}>{busy ? "Guardando…" : amount !== null && amount < due ? "Registrar abono" : "Registrar cobro"}</BigButton>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="¿Quién te pagó?" onBack={nav.back} />
      <div className="px-4 pt-3">
        <label className="mb-3 flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5">
          <Search size={18} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente o número de venta" className="h-full min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none" />
        </label>
        {!rows ? <p className="py-8 text-center text-muted">Cargando…</p> : shown.length === 0 ? <Empty icon={HandCoins} title="Nadie te debe">No hay ventas por cobrar.</Empty> : (
          <Panel>
            {shown.map((s) => {
              const late = s.due_date ? daysBetween(s.due_date, todayIso()) : 0;
              return (
                <button key={s.uid} onClick={() => { setPick(s); setAmount(s.total_minor - s.paid_minor); }} className="m-press flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 active:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{s.customer_name}</span>
                    <span className={cx("block text-[13px]", late > 0 ? "font-medium text-danger" : "text-muted")}>
                      {s.number} · {late > 0 ? `atrasada ${late} ${late === 1 ? "día" : "días"}` : s.due_date ? `vence ${formatDate(s.due_date)}` : formatDate(s.issue_date)}
                    </span>
                  </span>
                  <span className="num text-[15px] font-semibold text-ink">{formatMoney(s.total_minor - s.paid_minor)}</span>
                </button>
              );
            })}
          </Panel>
        )}
      </div>
    </>
  );
}
