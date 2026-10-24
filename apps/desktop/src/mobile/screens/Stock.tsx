import { useEffect, useMemo, useState } from "react";
import { Boxes, Package, Search, X } from "lucide-react";
import { useBackend, type Product } from "../../data";
import { formatMoney, formatQty } from "../../lib/format";
import { useSession } from "../../lib/session";
import { cx } from "../../ui/kit";
import { Chip, Empty, Panel, Sheet, TopBar } from "../ui";

type Filter = "todos" | "poco" | "sin";

export function Stock() {
  const backend = useBackend();
  const { can } = useSession();
  const [rows, setRows] = useState<Product[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [open, setOpen] = useState<Product | null>(null);
  useEffect(() => { backend.searchProducts("").then((r) => setRows(r.filter((p) => p.kind === "producto"))).catch(() => setRows([])); }, [backend]);

  const state = (p: Product) => (p.on_hand_milli <= 0 ? "sin" : p.min_milli > 0 && p.on_hand_milli <= p.min_milli ? "poco" : "ok");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((p) => (!n || `${p.name} ${p.sku}`.toLowerCase().includes(n)) && (filter === "todos" || state(p) === filter));
  }, [rows, q, filter]);
  const counts = { poco: (rows ?? []).filter((p) => state(p) === "poco").length, sin: (rows ?? []).filter((p) => state(p) === "sin").length };

  return (
    <>
      <TopBar title="Stock" />
      <div className="sticky top-14 z-10 space-y-2 bg-bg px-4 pb-2 pt-3">
        <label className="flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5">
          <Search size={18} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o código" className="h-full min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none" />
          {q && <button onClick={() => setQ("")} aria-label="Limpiar"><X size={18} className="text-muted" /></button>}
        </label>
        <div className="m-scroll -mx-4 flex gap-2 px-4">
          <Chip active={filter === "todos"} onClick={() => setFilter("todos")}>Todos</Chip>
          <Chip active={filter === "poco"} onClick={() => setFilter("poco")}>Poco stock · {counts.poco}</Chip>
          <Chip active={filter === "sin"} onClick={() => setFilter("sin")}>Sin stock · {counts.sin}</Chip>
        </div>
      </div>
      <div className="px-4">
        {!rows ? <p className="py-8 text-center text-muted">Cargando…</p> : shown.length === 0 ? <Empty icon={Boxes} title="Nada por aquí">No hay productos con ese filtro.</Empty> : (
          <Panel>
            {shown.map((p) => {
              const s = state(p);
              return (
                <button key={p.uid} onClick={() => setOpen(p)} className="m-press flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 active:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{p.name}</span>
                    <span className="block text-[13px] text-muted">{p.sku}{p.min_milli > 0 && ` · mínimo ${formatQty(p.min_milli)}`}</span>
                  </span>
                  <span className={cx("num rounded-lg px-2.5 py-1 text-[15px] font-semibold", s === "sin" ? "bg-danger-soft text-danger" : s === "poco" ? "bg-warning-soft text-warning" : "text-ink")}>
                    {formatQty(p.on_hand_milli)} <span className="text-[12px] font-normal">{p.unit}</span>
                  </span>
                </button>
              );
            })}
          </Panel>
        )}
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent"><Package size={24} /></span>
              <div>
                <div className="text-[13px] text-muted">Stock disponible</div>
                <div className="num text-[26px] font-bold text-ink">{formatQty(open.on_hand_milli)} {open.unit}</div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2.5">
              <Fact label="Precio neto" value={formatMoney(open.price_minor)} />
              {can("costos.ver") && <Fact label="Costo" value={formatMoney(Math.round(open.cost_e4 / 10_000))} />}
              <Fact label="Stock mínimo" value={open.min_milli ? `${formatQty(open.min_milli)} ${open.unit}` : "—"} />
              <Fact label="Código" value={open.sku} />
            </dl>
          </div>
        )}
      </Sheet>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="num mt-0.5 truncate text-[16px] font-semibold text-ink">{value}</dd>
    </div>
  );
}
