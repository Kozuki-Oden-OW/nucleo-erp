// Estructura de pantalla (Blueprint §4.1): menú lateral, barra superior y área de trabajo.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell, ChevronsLeft, ChevronsRight, FlaskConical, Monitor, Moon, PanelLeft, Plus, Search, Sun, TriangleAlert, FileWarning,
} from "lucide-react";
import { useBackend, type AppInfo, type Dashboard, type SessionInfo } from "../data";
import { navigate, type Route } from "../lib/router";
import { usePrefs, type Theme } from "../lib/prefs";
import { PROFILE_LABEL } from "../lib/format";
import { Button, cx, IconButton, Kbd, Segmented } from "../ui/kit";
import { CommandPalette } from "./CommandPalette";
import { NAV_FOOTER, hiddenNav, visibleNav, type NavItem } from "./nav";
import simbolo from "../assets/simbolo.png";

function isActive(item: NavItem, route: Route): boolean {
  const first = route.path[0] ?? "inicio";
  const target = item.href.split(/[/?]/).filter(Boolean)[0];
  if (item.id === "vender") return first === "ventas" || first === "cotizaciones";
  if (item.id === "config") return first === "config" && route.path[1] !== "negocio";
  if (item.id === "negocio") return first === "config" && route.path[1] === "negocio";
  return first === target;
}

export function AppShell({
  info,
  session,
  route,
  onSwitch,
  children,
}: {
  info: AppInfo;
  session: SessionInfo;
  route: Route;
  onSwitch: (uid: string) => void;
  children: ReactNode;
}) {
  const backend = useBackend();
  const { prefs, set } = usePrefs();
  const [palette, setPalette] = useState(false);
  const [alerts, setAlerts] = useState<Dashboard | null>(null);
  const [bell, setBell] = useState(false);
  // En pantallas angostas (notebooks de 1024–1280 px) el menú se contrae solo para dar espacio a las tablas.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1200);
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const on = () => { setNarrow(window.innerWidth < 1200); setOverride(null); };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const collapsed = override ?? (prefs.sidebarCollapsed || narrow);
  const toggleSidebar = () => (narrow ? setOverride(!collapsed) : set({ sidebarCollapsed: !collapsed }));
  const profile = session.company.profile;
  const items = visibleNav(profile, prefs.extraModules);
  const hidden = hiddenNav(profile, prefs.extraModules);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "k") { e.preventDefault(); setPalette(true); }
      else if ((e.ctrlKey || e.metaKey) && k === "b") { e.preventDefault(); toggleSidebar(); }
      else if (e.altKey && k === "n" && backend.features.has("ventas")) { e.preventDefault(); navigate("/ventas/nueva"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!backend.features.has("dashboard")) return;
    backend.dashboard().then(setAlerts).catch(() => setAlerts(null));
  }, [backend, route.raw]);

  const alertCount = (alerts?.pending_documentation ?? 0) + (alerts?.low_stock.length ?? 0) + (alerts?.receivable_overdue_minor ? 1 : 0);

  const navButton = (n: NavItem) => {
    const ready = !n.feature || backend.features.has(n.feature);
    const active = isActive(n, route);
    return (
      <button
        key={n.id}
        onClick={() => navigate(ready ? n.href : `/proximamente/${n.id}`)}
        title={collapsed ? n.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cx(
          "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
          active ? "bg-accent-soft font-medium text-accent" : ready ? "text-ink hover:bg-surface-2" : "text-faint hover:bg-surface-2",
          collapsed && "justify-center px-0",
        )}
      >
        <n.icon size={18} className="shrink-0" aria-hidden />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{n.label}</span>}
        {!collapsed && !ready && <span className="text-[10px] font-medium uppercase tracking-wide text-faint">Fase {n.phase}</span>}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {backend.kind === "demo" && (
        <div className="no-print flex items-center justify-center gap-2 bg-[#001a3c] px-4 py-1.5 text-center text-xs text-white">
          <FlaskConical size={14} aria-hidden />
          <span>Demostración con datos ficticios · nada de lo que hagas aquí se guarda</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className={cx("no-print flex shrink-0 flex-col border-r border-line bg-surface transition-[width]", collapsed ? "w-[68px]" : "w-64")}>
          <div className={cx("border-b border-line", collapsed ? "p-3" : "p-4")}>
            <div className={cx("flex items-center gap-2", collapsed && "justify-center")}>
              <img src={simbolo} alt="NÚCLEO ERP" width={30} height={30} />
              {!collapsed && <span className="text-sm font-bold tracking-wide text-brand">NÚCLEO <span className="text-accent">ERP</span></span>}
            </div>
            {!collapsed && (
              <>
                <select
                  aria-label="Negocio activo"
                  className="mt-3 h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-sm font-medium text-ink"
                  value={session.company.uid}
                  onChange={(e) => onSwitch(e.target.value)}
                >
                  {info.companies.map((c) => <option key={c.uid} value={c.uid}>{c.name}</option>)}
                </select>
                <div className="mt-1.5 px-0.5 text-xs text-muted">Perfil {PROFILE_LABEL[profile]}</div>
              </>
            )}
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Módulos">
            {items.map(navButton)}
            {!collapsed && hidden.length > 0 && (
              <details className="mt-3 px-3 text-xs text-muted">
                <summary className="cursor-pointer select-none py-1 hover:text-ink">Más módulos ({hidden.length})</summary>
                <p className="mt-1">Ocultos por el perfil {PROFILE_LABEL[profile]}. Puedes mostrarlos igual:</p>
                <div className="mt-2 flex flex-col gap-1">
                  {hidden.map((h) => (
                    <button key={h.id} className="flex items-center gap-2 rounded px-1 py-1 text-left text-ink hover:bg-surface-2" onClick={() => set({ extraModules: [...prefs.extraModules, h.id] })}>
                      <Plus size={13} aria-hidden /> {h.label}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </nav>
          <div className="space-y-0.5 border-t border-line p-2">
            {NAV_FOOTER.map(navButton)}
            <button
              onClick={toggleSidebar}
              className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface-2 hover:text-ink", collapsed && "justify-center px-0")}
              title="Contraer o expandir el menú (Ctrl+B)"
            >
              {collapsed ? <ChevronsRight size={18} aria-hidden /> : <ChevronsLeft size={18} aria-hidden />}
              {!collapsed && <span>Contraer menú</span>}
            </button>
          </div>
          {!collapsed && <div className="px-4 pb-3 text-[11px] text-faint">Versión {info.version} · Gratis y local</div>}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur lg:px-6">
            <IconButton icon={PanelLeft} label="Menú (Ctrl+B)" className="lg:hidden" onClick={toggleSidebar} />
            <button
              onClick={() => setPalette(true)}
              className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 text-left text-sm text-faint transition-colors hover:border-line-strong"
            >
              <Search size={16} aria-hidden />
              <span className="flex-1 truncate">Buscar o hacer cualquier cosa…</span>
              <Kbd>Ctrl K</Kbd>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {backend.features.has("ventas") && (
                <Button size="sm" icon={Plus} onClick={() => navigate("/ventas/nueva")} title="Nueva venta (Alt+N)">
                  <span className="hidden sm:inline">Nueva venta</span>
                </Button>
              )}
              <div className="hidden md:block">
                <Segmented
                  label="Vista"
                  value={prefs.view}
                  onChange={(v) => set({ view: v })}
                  options={[{ value: "simple", label: "Simple" }, { value: "contador", label: "Contador" }]}
                />
              </div>
              <ThemeMenu theme={prefs.theme} onChange={(t) => set({ theme: t })} />
              <div className="relative">
                <IconButton icon={Bell} label={`Alertas (${alertCount})`} onClick={() => setBell((b) => !b)} />
                {alertCount > 0 && (
                  <span className="num pointer-events-none absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{alertCount}</span>
                )}
                {bell && <AlertsPopover data={alerts} onClose={() => setBell(false)} />}
              </div>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1280px] px-4 py-6 lg:px-8">{children}</div>
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function ThemeMenu({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const order: Theme[] = ["sistema", "claro", "oscuro"];
  const icon = theme === "claro" ? Sun : theme === "oscuro" ? Moon : Monitor;
  const label = { sistema: "Tema: igual que Windows", claro: "Tema: claro", oscuro: "Tema: oscuro" }[theme];
  return <IconButton icon={icon} label={`${label} (clic para cambiar)`} onClick={() => onChange(order[(order.indexOf(theme) + 1) % 3]!)} />;
}

function AlertsPopover({ data, onClose }: { data: Dashboard | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    setTimeout(() => window.addEventListener("mousedown", h), 0);
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [onClose]);
  const go = (href: string) => { navigate(href); onClose(); };
  const rows: { icon: typeof Bell; tone: string; text: string; href: string }[] = [];
  if (data?.pending_documentation) rows.push({ icon: FileWarning, tone: "text-warning", text: `${data.pending_documentation} ventas pendientes de documentación tributaria`, href: "/ventas?tab=pendientes_doc" });
  if (data?.receivable_overdue_minor) rows.push({ icon: TriangleAlert, tone: "text-danger", text: "Tienes cobros atrasados", href: "/ventas?tab=por_cobrar" });
  if (data?.low_stock.length) rows.push({ icon: TriangleAlert, tone: "text-warning", text: `${data.low_stock.length} productos con poco stock`, href: "/productos?filtro=bajo" });
  return (
    <div ref={ref} className="anim-in absolute right-0 top-11 z-30 w-80 rounded-xl border border-line bg-surface p-2 shadow-pop">
      <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Alertas</div>
      {rows.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted">Todo en orden.</div>}
      {rows.map((r) => (
        <button key={r.text} onClick={() => go(r.href)} className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2">
          <r.icon size={16} className={cx("mt-0.5 shrink-0", r.tone)} aria-hidden />
          <span className="text-ink">{r.text}</span>
        </button>
      ))}
    </div>
  );
}
