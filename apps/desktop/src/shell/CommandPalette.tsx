// Paleta de comandos (Ctrl+K): busca registros y ejecuta acciones (Blueprint §4.3).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, FileText, Moon, Package, Plus, Search, ShoppingBag, ShoppingCart, Sun, User, Users, Calculator, type LucideIcon,
} from "lucide-react";
import { useBackend, type SearchHit } from "../data";
import { navigate } from "../lib/router";
import { usePrefs } from "../lib/prefs";
import { cx, Kbd } from "../ui/kit";
import { NAV, NAV_FOOTER } from "./nav";

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const HIT_ICON: Record<SearchHit["kind"], LucideIcon> = {
  cliente: User, producto: Package, venta: ShoppingBag, cotizacion: FileText, orden_compra: ShoppingCart,
};
const HIT_GROUP: Record<SearchHit["kind"], string> = {
  cliente: "Clientes", producto: "Productos", venta: "Ventas", cotizacion: "Cotizaciones", orden_compra: "Órdenes de compra",
};
function hitHref(h: SearchHit): string {
  switch (h.kind) {
    case "cliente": return `/clientes/${h.uid}`;
    case "producto": return `/productos?ver=${h.uid}`;
    case "venta": return `/ventas/${h.uid}`;
    case "cotizacion": return `/cotizaciones/${h.uid}`;
    case "orden_compra": return `/compras/${h.uid}`;
  }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backend = useBackend();
  const { prefs, set } = usePrefs();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setHits([]); setActive(0); }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    let alive = true;
    const t = setTimeout(() => { backend.globalSearch(q).then((h) => alive && setHits(h)).catch(() => alive && setHits([])); }, 90);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, backend]);

  const actions: Item[] = useMemo(() => {
    const go = (href: string) => () => { navigate(href); onClose(); };
    const base: Item[] = [
      { id: "a-venta", group: "Acciones", title: "Nueva venta", icon: Plus, keywords: "nueva venta vender boleta", run: go("/ventas/nueva") },
      { id: "a-fv", group: "Acciones", title: "Nueva factura interna", icon: Plus, keywords: "factura interna fv", run: go("/ventas/nueva?tipo=FV") },
      { id: "a-cot", group: "Acciones", title: "Nueva cotización", icon: Plus, keywords: "nueva cotizacion presupuesto cot", run: go("/cotizaciones/nueva") },
      { id: "a-cli", group: "Acciones", title: "Nuevo cliente", icon: Users, keywords: "nuevo cliente agregar", run: go("/clientes?nuevo=1") },
      { id: "a-pro", group: "Acciones", title: "Nuevo producto o servicio", icon: Package, keywords: "nuevo producto servicio", run: go("/productos?nuevo=1") },
      { id: "a-imp", group: "Acciones", title: "Calcular costo de importación", icon: Calculator, keywords: "comex importacion calculadora landed cif fob", run: go("/comex") },
      { id: "a-tema", group: "Preferencias", title: prefs.theme === "oscuro" ? "Usar tema claro" : "Usar tema oscuro", icon: prefs.theme === "oscuro" ? Sun : Moon, keywords: "tema oscuro claro modo noche", run: () => { set({ theme: prefs.theme === "oscuro" ? "claro" : "oscuro" }); onClose(); } },
      { id: "a-vista", group: "Preferencias", title: prefs.view === "simple" ? "Cambiar a vista Contador" : "Cambiar a vista Simple", icon: FileText, keywords: "vista contador simple contable", run: () => { set({ view: prefs.view === "simple" ? "contador" : "simple" }); onClose(); } },
    ];
    for (const n of [...NAV, ...NAV_FOOTER]) {
      base.push({ id: `n-${n.id}`, group: "Ir a", title: n.label, icon: n.icon, keywords: `ir ${n.label}`, run: go(n.href) });
      for (const c of n.children ?? []) base.push({ id: `n-${c.href}`, group: "Ir a", title: `${n.label} › ${c.label}`, icon: n.icon, keywords: `ir ${n.label} ${c.label}`, run: go(c.href) });
    }
    return base;
  }, [prefs.theme, prefs.view, set, onClose]);

  const items: Item[] = useMemo(() => {
    const nq = norm(q.trim());
    const words = nq.split(/\s+/).filter(Boolean);
    const acts = words.length ? actions.filter((a) => words.every((w) => norm(`${a.title} ${a.keywords}`).includes(w))) : actions.filter((a) => a.group !== "Ir a");
    const recs: Item[] = hits.map((h) => ({
      id: `h-${h.kind}-${h.uid}`, group: HIT_GROUP[h.kind], title: h.title, subtitle: h.subtitle, icon: HIT_ICON[h.kind], keywords: "",
      run: () => { navigate(hitHref(h)); onClose(); },
    }));
    return [...recs, ...acts].slice(0, 40);
  }, [q, hits, actions, onClose]);

  useEffect(() => { setActive(0); }, [q, hits.length]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Buscar o ejecutar" className="anim-in relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-muted" aria-hidden />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca clientes, productos, ventas… o escribe una acción"
            className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-${active}` : undefined}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={list} id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">Sin resultados para “{q}”.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{header}</div>}
                <div
                  id={`pal-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={it.run}
                  className={cx("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", i === active ? "bg-accent-soft" : "")}
                >
                  <it.icon size={16} className={i === active ? "text-accent" : "text-muted"} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{it.title}</div>
                    {it.subtitle && <div className="truncate text-xs text-muted">{it.subtitle}</div>}
                  </div>
                  {i === active && <ArrowRight size={14} className="text-accent" aria-hidden />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-muted">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> moverse</span>
          <span><Kbd>Enter</Kbd> abrir</span>
          <span className="ml-auto">Todo se busca en tu computador</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
