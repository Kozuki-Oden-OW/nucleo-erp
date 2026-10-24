import { useEffect, useMemo, useState } from "react";
import { HandCoins, Mail, MessageCircle, Phone, Search, UserPlus, Users, X } from "lucide-react";
import { errorMessage, useBackend, type Customer, type CustomerDetail, type SaleSummary } from "../../data";
import { formatDate, formatMoney } from "../../lib/format";
import { useToast } from "../../ui/overlay";
import { useNav } from "../MobileApp";
import { outbox } from "../outbox";
import { BigButton, Chip, Empty, Input, Panel, Row, Sheet, TopBar } from "../ui";

export function Customers() {
  const backend = useBackend();
  const toast = useToast();
  const nav = useNav();
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [debts, setDebts] = useState<SaleSummary[]>([]);
  const [q, setQ] = useState("");
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [open, setOpen] = useState<CustomerDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const load = () => {
    backend.searchCustomers("").then(setRows).catch(() => setRows([]));
    backend.listSales({ view: "por_cobrar" }).then(setDebts).catch(() => {});
  };
  useEffect(load, [backend]);

  const debtBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of debts) m.set(s.customer_name, (m.get(s.customer_name) ?? 0) + s.total_minor - s.paid_minor);
    return m;
  }, [debts]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((c) => (!n || `${c.name} ${c.rut ?? ""}`.toLowerCase().includes(n)) && (!onlyDebt || (debtBy.get(c.name) ?? 0) > 0));
  }, [rows, q, onlyDebt, debtBy]);

  async function add() {
    try {
      const c = await backend.addCustomer({ name: form.name.trim(), phone: form.phone.trim() || undefined, email: form.email.trim() || undefined });
      outbox.add("cliente", `Cliente nuevo: ${c.name}`, null);
      toast("success", `${c.name} agregado.`);
      setAdding(false); setForm({ name: "", phone: "", email: "" }); load();
    } catch (e) { toast("danger", errorMessage(e)); }
  }

  const phoneDigits = (p: string) => p.replace(/\D/g, "");
  const waNumber = (p: string) => { const d = phoneDigits(p); return d.startsWith("56") ? d : d.length === 9 ? `56${d}` : d; };

  return (
    <>
      <TopBar title="Clientes" right={<button onClick={() => setAdding(true)} aria-label="Nuevo cliente" className="m-press grid h-10 w-10 place-items-center rounded-full text-accent"><UserPlus size={22} /></button>} />
      <div className="sticky top-14 z-10 space-y-2 bg-bg px-4 pb-2 pt-3">
        <label className="flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5">
          <Search size={18} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o RUT" className="h-full min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none" />
          {q && <button onClick={() => setQ("")} aria-label="Limpiar"><X size={18} className="text-muted" /></button>}
        </label>
        <div className="flex gap-2">
          <Chip active={!onlyDebt} onClick={() => setOnlyDebt(false)}>Todos</Chip>
          <Chip active={onlyDebt} onClick={() => setOnlyDebt(true)}>Me deben · {[...debtBy.values()].filter((v) => v > 0).length}</Chip>
        </div>
      </div>
      <div className="px-4">
        {!rows ? <p className="py-8 text-center text-muted">Cargando…</p> : shown.length === 0 ? <Empty icon={Users} title="Sin clientes aquí" /> : (
          <Panel>
            {shown.map((c) => {
              const debt = debtBy.get(c.name) ?? 0;
              return (
                <Row key={c.uid} title={c.name} sub={c.phone ?? c.email ?? c.rut ?? "Sin contacto"}
                  right={debt > 0 ? <span className="num text-[15px] font-semibold text-warning">{formatMoney(debt)}</span> : undefined}
                  onClick={() => backend.customer(c.uid).then(setOpen).catch((e) => toast("danger", errorMessage(e)))} />
              );
            })}
          </Panel>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Contact href={open.phone ? `tel:${phoneDigits(open.phone)}` : undefined} icon={Phone} label="Llamar" />
              <Contact href={open.phone ? `https://wa.me/${waNumber(open.phone)}` : undefined} icon={MessageCircle} label="WhatsApp" />
              <Contact href={open.email ? `mailto:${open.email}` : undefined} icon={Mail} label="Correo" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-line p-3"><div className="text-[12px] text-muted">Te debe</div><div className="num mt-0.5 text-[18px] font-bold text-ink">{formatMoney(open.receivable_minor)}</div></div>
              <div className="rounded-xl border border-line p-3"><div className="text-[12px] text-muted">Última compra</div><div className="mt-0.5 text-[16px] font-semibold text-ink">{open.last_sale_date ? formatDate(open.last_sale_date) : "—"}</div></div>
            </div>
            {open.receivable_minor > 0 && <BigButton icon={HandCoins} onClick={() => { const c = open; setOpen(null); nav.open({ name: "cobro", saleUid: debts.find((s) => s.customer_name === c.name)?.uid }); }}>Registrar un cobro</BigButton>}
            {open.recent.length > 0 && (
              <div>
                <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Últimas ventas</div>
                <Panel>{open.recent.slice(0, 5).map((s) => <Row key={s.uid} title={s.number} sub={formatDate(s.issue_date)} right={<span className="num text-[15px] font-semibold">{formatMoney(s.total_minor)}</span>} />)}</Panel>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Nuevo cliente">
        <div className="space-y-3">
          <Input label="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus placeholder="Ej. Juan Pérez" />
          <Input label="Celular" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+56 9 1234 5678" />
          <Input label="Correo" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Opcional" />
          <BigButton icon={UserPlus} onClick={add} disabled={!form.name.trim()}>Guardar cliente</BigButton>
        </div>
      </Sheet>
    </>
  );
}

function Contact({ href, icon: Icon, label }: { href?: string; icon: typeof Phone; label: string }) {
  const cls = "m-press flex flex-col items-center gap-1.5 rounded-2xl border border-line py-3 text-[13px] font-medium";
  return href
    ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={`${cls} text-ink`}><Icon size={20} className="text-accent" />{label}</a>
    : <span className={`${cls} text-faint`}><Icon size={20} />{label}</span>;
}
