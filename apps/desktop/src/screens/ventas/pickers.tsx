// Buscadores con teclado para elegir cliente y producto mientras se digita un documento.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Package, Search, Truck, User, UserPlus, X } from "lucide-react";
import { useBackend, type Customer, type Product, type Supplier } from "../../data";
import { formatMoney, formatQty, formatRut } from "../../lib/format";
import { cx } from "../../ui/kit";

/** Resultados de búsqueda con espera corta; `forQuery` dice a qué texto corresponden. */
function useDebounced<T>(fn: (q: string) => Promise<T[]>, q: string, enabled: boolean): { rows: T[]; forQuery: string | null } {
  const [state, setState] = useState<{ rows: T[]; forQuery: string | null }>({ rows: [], forQuery: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const t = setTimeout(() => { fn(q).then((r) => alive && setState({ rows: r, forQuery: q })).catch(() => alive && setState({ rows: [], forQuery: q })); }, 80);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, enabled]);
  return state;
}

function Listbox<T>({ items, active, render, onPick, id }: { items: T[]; active: number; render: (t: T) => React.ReactNode; onPick: (t: T) => void; id: string }) {
  return (
    <div id={id} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
      {items.map((it, i) => (
        <div
          key={i}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => { e.preventDefault(); onPick(it); }}
          className={cx("cursor-pointer rounded-md px-3 py-2 text-sm", i === active ? "bg-accent-soft" : "hover:bg-surface-2")}
        >
          {render(it)}
        </div>
      ))}
    </div>
  );
}

export function CustomerPicker({
  value,
  onChange,
  allowWalkIn,
  prospect,
  onProspect,
  onCreate,
}: {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  allowWalkIn: boolean;
  prospect?: string;
  onProspect?: (name: string) => void;
  onCreate: (name: string) => void;
}) {
  const backend = useBackend();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { rows, forQuery } = useDebounced((x) => backend.searchCustomers(x).then((r) => r.slice(0, 8)), q, open);
  const pendingEnter = useRef(false);
  type Opt = { kind: "c"; c: Customer } | { kind: "new" } | { kind: "prospect" };
  const opts: Opt[] = [...rows.map((c) => ({ kind: "c" as const, c })), ...(q.trim() ? [{ kind: "new" as const }] : []), ...(q.trim() && onProspect ? [{ kind: "prospect" as const }] : [])];

  function pick(o: Opt) {
    if (o.kind === "c") onChange(o.c);
    else if (o.kind === "new") onCreate(q.trim());
    else onProspect?.(q.trim());
    setOpen(false); setQ("");
  }
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (pendingEnter.current && forQuery === q && opts[0]) { pendingEnter.current = false; pick(opts[0]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forQuery, q]);

  if (value) {
    return (
      <div className="flex h-ctl items-center gap-3 rounded-lg border border-line-strong bg-surface px-3">
        <User size={16} className="text-accent" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium text-ink">{value.name}</span>
          {value.rut && <span className="ml-2 text-muted">{formatRut(value.rut)}</span>}
        </div>
        <button className="text-muted hover:text-ink" aria-label="Cambiar cliente" onClick={() => onChange(null)}><X size={16} /></button>
      </div>
    );
  }
  if (prospect) {
    return (
      <div className="flex h-ctl items-center gap-3 rounded-lg border border-line-strong bg-surface px-3">
        <User size={16} className="text-muted" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-sm"><span className="text-ink">{prospect}</span> <span className="text-muted">(interesado sin ficha)</span></div>
        <button className="text-muted hover:text-ink" aria-label="Cambiar" onClick={() => onProspect?.("")}><X size={16} /></button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="cust-list"
          aria-label="Cliente"
          placeholder={allowWalkIn ? "Buscar cliente por nombre o RUT… (vacío = cliente ocasional)" : "Buscar cliente por nombre o RUT…"}
          className="h-ctl w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(opts.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && q.trim() && forQuery !== q) { e.preventDefault(); pendingEnter.current = true; }
            else if (e.key === "Enter" && opts[active]) { e.preventDefault(); pick(opts[active]!); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && opts.length > 0 && (forQuery === q || !q) && (
        <Listbox
          id="cust-list"
          items={opts}
          active={active}
          onPick={pick}
          render={(o) =>
            o.kind === "c" ? (
              <div className="flex items-center justify-between gap-3"><span className="truncate text-ink">{o.c.name}</span><span className="shrink-0 text-xs text-muted">{formatRut(o.c.rut)}</span></div>
            ) : o.kind === "new" ? (
              <div className="flex items-center gap-2 text-accent"><UserPlus size={15} aria-hidden /> Crear cliente “{q.trim()}”</div>
            ) : (
              <div className="text-muted">Cotizar a “{q.trim()}” sin crear ficha</div>
            )
          }
        />
      )}
    </div>
  );
}

export interface ProductPickerHandle { focus: () => void }

export const ProductPicker = forwardRef<ProductPickerHandle, { onPick: (p: Product | null, text: string) => void }>(function ProductPicker({ onPick }, ref) {
  const backend = useBackend();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));
  const { rows, forQuery } = useDebounced((x) => backend.searchProducts(x).then((r) => r.slice(0, 10)), q, open && q.trim().length > 0);
  type Opt = { kind: "p"; p: Product } | { kind: "free" };
  const opts: Opt[] = q.trim() ? [...rows.map((p) => ({ kind: "p" as const, p })), { kind: "free" as const }] : [];
  // Si la persona presiona Enter antes de que lleguen los resultados, se elige el primero cuando lleguen
  // (digitación rápida: nunca se crea una línea libre por accidente).
  const pendingEnter = useRef(false);
  useEffect(() => setActive(0), [q, rows.length]);
  useEffect(() => {
    if (pendingEnter.current && forQuery === q && opts[0]) { pendingEnter.current = false; pick(opts[0]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forQuery, q]);

  const pick = (o: Opt) => {
    onPick(o.kind === "p" ? o.p : null, q.trim());
    setQ(""); setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Package size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls="prod-list"
          aria-label="Agregar producto o servicio"
          placeholder="Agregar producto: escribe nombre o código y presiona Enter"
          className="h-ctl w-full rounded-lg border border-dashed border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-solid focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(opts.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && q.trim() && forQuery !== q) { e.preventDefault(); pendingEnter.current = true; }
            else if (e.key === "Enter" && opts[active]) { e.preventDefault(); pick(opts[active]!); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && opts.length > 0 && forQuery === q && (
        <Listbox
          id="prod-list"
          items={opts}
          active={active}
          onPick={pick}
          render={(o) =>
            o.kind === "p" ? (
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 font-mono text-xs text-muted">{o.p.sku}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{o.p.name}</span>
                {o.p.kind === "producto" && <span className={cx("shrink-0 text-xs", o.p.on_hand_milli <= 0 ? "text-danger" : "text-muted")}>stock {formatQty(o.p.on_hand_milli)}</span>}
                <span className="num w-20 shrink-0 text-right text-ink">{formatMoney(o.p.price_minor)}</span>
              </div>
            ) : (
              <div className="text-muted">Agregar “{q.trim()}” como línea libre (sin producto)</div>
            )
          }
        />
      )}
    </div>
  );
});

/** Buscador de proveedor (compras). Permite crear uno nuevo sin salir del documento. */
export function SupplierPicker({ value, onChange, onCreate }: { value: Supplier | null; onChange: (s: Supplier | null) => void; onCreate: (name: string) => void }) {
  const backend = useBackend();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { rows, forQuery } = useDebounced((x) => backend.searchSuppliers(x).then((r) => r.slice(0, 8)), q, open);
  const pendingEnter = useRef(false);
  type Opt = { kind: "s"; s: Supplier } | { kind: "new" };
  const opts: Opt[] = [...rows.map((s) => ({ kind: "s" as const, s })), ...(q.trim() ? [{ kind: "new" as const }] : [])];
  function pick(o: Opt) {
    if (o.kind === "s") onChange(o.s); else onCreate(q.trim());
    setOpen(false); setQ("");
  }
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (pendingEnter.current && forQuery === q && opts[0]) { pendingEnter.current = false; pick(opts[0]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forQuery, q]);
  if (value) {
    return (
      <div className="flex h-ctl items-center gap-3 rounded-lg border border-line-strong bg-surface px-3">
        <Truck size={16} className="text-accent" aria-hidden />
        <div className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium text-ink">{value.name}</span>
          {value.rut && <span className="ml-2 text-muted">{formatRut(value.rut)}</span>}
          {value.payment_terms_days > 0 && <span className="ml-2 text-muted">· paga a {value.payment_terms_days} días</span>}
        </div>
        <button className="text-muted hover:text-ink" aria-label="Cambiar proveedor" onClick={() => onChange(null)}><X size={16} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search size={15} className="pointer-events-none absolute left-3 text-muted" aria-hidden />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="supp-list"
          aria-label="Proveedor"
          placeholder="Buscar proveedor por nombre o RUT…"
          className="h-ctl w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(opts.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && q.trim() && forQuery !== q) { e.preventDefault(); pendingEnter.current = true; }
            else if (e.key === "Enter" && opts[active]) { e.preventDefault(); pick(opts[active]!); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && opts.length > 0 && (forQuery === q || !q) && (
        <Listbox
          id="supp-list"
          items={opts}
          active={active}
          onPick={pick}
          render={(o) => o.kind === "s" ? (
            <div className="flex items-center justify-between gap-3"><span className="truncate text-ink">{o.s.name}</span><span className="shrink-0 text-xs text-muted">{formatRut(o.s.rut)}</span></div>
          ) : (
            <div className="flex items-center gap-2 text-accent"><UserPlus size={15} aria-hidden /> Crear proveedor “{q.trim()}”</div>
          )}
        />
      )}
    </div>
  );
}
