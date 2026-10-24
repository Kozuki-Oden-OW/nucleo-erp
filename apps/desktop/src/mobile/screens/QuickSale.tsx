// Venta rápida: elegir productos con el dedo, la forma de pago y listo.
// El celular la guarda como borrador; el computador la confirma (numera, descuenta stock y registra el
// pago) al sincronizar, porque el escritorio es la autoridad de los documentos (D-SYNC-01).
import { useEffect, useMemo, useState } from "react";
import { Check, Search, ShoppingBag, Trash2, User, X } from "lucide-react";
import { errorMessage, useBackend, type Customer, type Product, type SalePayment } from "../../data";
import { EMPTY_TERMS } from "../../data/saleTerms";
import { addDays, formatMoney, todayIso } from "../../lib/format";
import { useToast } from "../../ui/overlay";
import { cx } from "../../ui/kit";
import { outbox } from "../outbox";
import { BigButton, Chip, Empty, Panel, Row, Sheet, Stepper, TopBar } from "../ui";

const PAYMENTS: { value: Exclude<SalePayment, "">; label: string; method: string }[] = [
  { value: "efectivo", label: "Efectivo", method: "Efectivo" },
  { value: "transferencia", label: "Transferencia", method: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta", method: "Tarjeta de débito" },
  { value: "credito", label: "Fiado (a crédito)", method: "" },
];

export function QuickSale() {
  const backend = useBackend();
  const toast = useToast();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [payment, setPayment] = useState<Exclude<SalePayment, "">>("efectivo");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taxPpm, setTaxPpm] = useState(190_000);

  useEffect(() => {
    backend.searchProducts("").then(setProducts).catch(() => setProducts([]));
    backend.ruleValue("IVA_TASA_GENERAL_PPM").then((r) => { if (r) setTaxPpm(r.value); }).catch(() => {});
  }, [backend]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (products ?? []).filter((p) => !q || `${p.name} ${p.sku}`.toLowerCase().includes(q)).slice(0, 60);
  }, [products, query]);
  const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([uid, n]) => ({ p: products!.find((x) => x.uid === uid)!, n })).filter((l) => l.p);
  const gross = (p: Product) => (p.taxable ? Math.round((p.price_minor * (1_000_000 + taxPpm)) / 1_000_000) : p.price_minor);
  const total = lines.reduce((a, l) => a + gross(l.p) * l.n, 0);
  const count = lines.reduce((a, l) => a + l.n, 0);
  const add = (uid: string, d = 1) => setCart((c) => ({ ...c, [uid]: Math.max(0, (c[uid] ?? 0) + d) }));

  async function save() {
    if (payment === "credito" && !customer) { toast("warning", "Para vender fiado elige el cliente: así sabes quién te debe."); setPickCustomer(true); return; }
    setBusy(true);
    try {
      const today = todayIso();
      const sale = await backend.saveSale({
        doc_type: "VEN", customer_uid: customer?.uid ?? null, issue_date: today,
        lines: lines.map((l) => ({ product_uid: l.p.uid, description: l.p.name, qty_milli: l.n * 1000, unit_price_minor: l.p.price_minor, discount_ppm: 0, taxable: l.p.taxable })),
        notes: "Venta rápida desde el celular",
        terms: { ...EMPTY_TERMS, payment, due_date: payment === "credito" ? addDays(today, 30) : null, credit_days: payment === "credito" ? 30 : null },
      });
      const method = PAYMENTS.find((x) => x.value === payment)!;
      outbox.add("venta", `Venta ${customer ? `a ${customer.name}` : "rápida"} · ${count} ${count === 1 ? "producto" : "productos"}`, sale.total_minor, async () => {
        // Lo que hace el computador al recibirla: confirma la venta con su forma de pago.
        await backend.effectSale(sale.uid, payment === "credito"
          ? { mode: "credito", method: "", due_date: addDays(today, 30) }
          : { mode: "contado", method: method.method, due_date: null });
      });
      toast("success", "Venta guardada. Se confirma en el computador al sincronizar.");
      setCart({}); setCustomer(null); setReview(false); setPayment("efectivo");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <TopBar title="Venta rápida" />
      <div className="sticky top-14 z-10 bg-bg px-4 pb-2 pt-3">
        <label className="flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5">
          <Search size={18} className="text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto o código" className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-faint focus:outline-none" />
          {query && <button onClick={() => setQuery("")} aria-label="Limpiar"><X size={18} className="text-muted" /></button>}
        </label>
      </div>
      <div className="px-4">
        {!products ? <p className="py-8 text-center text-muted">Cargando productos…</p> : shown.length === 0 ? <Empty icon={Search} title="Sin resultados">Prueba con otra palabra o el código.</Empty> : (
          <Panel>
            {shown.map((p) => {
              const n = cart[p.uid] ?? 0;
              const low = p.kind === "producto" && p.on_hand_milli <= 0;
              return (
                <div key={p.uid} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <button className="m-press min-w-0 flex-1 text-left" onClick={() => add(p.uid)}>
                    <span className="block truncate text-[15px] font-medium text-ink">{p.name}</span>
                    <span className="block text-[13px] text-muted">
                      <span className="num font-semibold text-ink">{formatMoney(gross(p))}</span>
                      {p.kind === "producto" && <span className={cx("ml-2", low && "text-danger")}>· stock {p.on_hand_milli / 1000}</span>}
                    </span>
                  </button>
                  {n > 0 ? <Stepper value={n} onChange={(v) => setCart((c) => ({ ...c, [p.uid]: v }))} /> : (
                    <button onClick={() => add(p.uid)} className="m-press rounded-full bg-accent-soft px-4 py-2 text-[14px] font-semibold text-accent">Agregar</button>
                  )}
                </div>
              );
            })}
          </Panel>
        )}
      </div>

      {count > 0 && (
        <div className="pb-safe fixed inset-x-0 bottom-16 z-20 px-4 pb-3">
          <button onClick={() => setReview(true)} className="m-press mx-auto flex h-14 w-full max-w-[528px] items-center gap-3 m-hero rounded-2xl px-4 shadow-pop">
            <span className="grid h-8 min-w-8 place-items-center rounded-full bg-white/15 px-2 text-[14px] font-bold" style={{ background: "rgb(255 255 255 / 0.15)" }}>{count}</span>
            <span className="flex-1 text-left text-[16px] font-semibold">Revisar venta</span>
            <span className="num text-[17px] font-bold">{formatMoney(total)}</span>
          </button>
        </div>
      )}

      <Sheet open={review} onClose={() => setReview(false)} title="Revisar venta">
        <Panel>
          {lines.map((l) => (
            <div key={l.p.uid} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">{l.p.name}</span>
                <span className="num block text-[13px] text-muted">{l.n} × {formatMoney(gross(l.p))}</span>
              </span>
              <Stepper value={l.n} onChange={(v) => setCart((c) => ({ ...c, [l.p.uid]: v }))} />
              <button aria-label="Quitar" onClick={() => setCart((c) => ({ ...c, [l.p.uid]: 0 }))} className="text-muted"><Trash2 size={18} /></button>
            </div>
          ))}
        </Panel>
        <div className="mt-4">
          <span className="mb-1.5 block text-[14px] font-medium text-ink">Cliente</span>
          <button onClick={() => setPickCustomer(true)} className="m-press flex h-12 w-full items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 text-left">
            <User size={18} className="text-muted" />
            <span className={cx("flex-1 truncate text-[16px]", customer ? "text-ink" : "text-faint")}>{customer?.name ?? "Cliente ocasional (opcional)"}</span>
            {customer && <X size={18} className="text-muted" onClick={(e) => { e.stopPropagation(); setCustomer(null); }} />}
          </button>
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-[14px] font-medium text-ink">¿Cómo te paga?</span>
          <div className="flex flex-wrap gap-2">{PAYMENTS.map((x) => <Chip key={x.value} active={payment === x.value} onClick={() => setPayment(x.value)}>{x.label}</Chip>)}</div>
        </div>
        <div className="mt-5 flex items-end justify-between">
          <span className="text-[15px] text-muted">Total con IVA</span>
          <span className="num text-[28px] font-bold text-ink">{formatMoney(total)}</span>
        </div>
        <div className="mt-4"><BigButton icon={Check} onClick={save} disabled={busy || count === 0}>{busy ? "Guardando…" : "Guardar venta"}</BigButton></div>
        <p className="mt-2 text-center text-[13px] text-muted">El computador la numera y descuenta el stock al sincronizar.</p>
      </Sheet>

      <CustomerPicker open={pickCustomer} onClose={() => setPickCustomer(false)} onPick={(c) => { setCustomer(c); setPickCustomer(false); }} />
    </>
  );
}

export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const backend = useBackend();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Customer[]>([]);
  useEffect(() => { if (open) backend.searchCustomers(q).then(setRows).catch(() => {}); }, [backend, q, open]);
  return (
    <Sheet open={open} onClose={onClose} title="Elegir cliente">
      <label className="mb-3 flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5">
        <Search size={18} className="text-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o RUT" className="h-full min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none" />
      </label>
      {rows.length === 0 ? <Empty icon={ShoppingBag} title="Sin clientes con ese nombre" /> : (
        <Panel>{rows.slice(0, 40).map((c) => <Row key={c.uid} icon={User} title={c.name} sub={c.phone ?? c.email ?? undefined} onClick={() => onPick(c)} />)}</Panel>
      )}
    </Sheet>
  );
}
