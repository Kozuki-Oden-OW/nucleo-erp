// App de NÚCLEO para el celular (fase S2 del diseño de sincronización, docs/SINCRONIZACION.md).
// Usa el mismo backend que el escritorio: en el navegador, la demostración; en la app instalada, la
// base cifrada del celular. Lo que se crea aquí queda como borrador o movimiento y viaja al computador
// al sincronizar por cable o WiFi.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Boxes, Home as HomeIcon, Menu, ShoppingBag, Users } from "lucide-react";
import { BackendProvider, defaultBackend, errorMessage, useBackend, type Backend, type SessionInfo } from "../data";
import { PrefsProvider } from "../lib/prefs";
import { SessionProvider } from "../lib/session";
import { ToastProvider } from "../ui/overlay";
import { cx } from "../ui/kit";
import { Home } from "./screens/Home";
import { QuickSale } from "./screens/QuickSale";
import { Stock } from "./screens/Stock";
import { Customers } from "./screens/Customers";
import { More } from "./screens/More";
import { Expense } from "./screens/Expense";
import { Collect } from "./screens/Collect";
import { Sync } from "./screens/Sync";

export type Tab = "inicio" | "vender" | "stock" | "clientes" | "mas";
export type Page = { name: "gasto" } | { name: "cobro"; saleUid?: string } | { name: "sincronizar" };

interface Nav { tab: Tab; setTab: (t: Tab) => void; open: (p: Page) => void; back: () => void }
const NavCtx = createContext<Nav | null>(null);
export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error("NavCtx ausente");
  return n;
}

export function MobileApp() {
  const [backend] = useState<Backend>(defaultBackend);
  useEffect(() => { document.body.classList.add("movil"); }, []);
  return (
    <PrefsProvider>
      <BackendProvider backend={backend}>
        <ToastProvider>
          <Boot />
        </ToastProvider>
      </BackendProvider>
    </PrefsProvider>
  );
}

function Boot() {
  const backend = useBackend();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const info = await backend.appInfo();
        const uid = info.companies[0]?.uid;
        if (!uid) throw new Error("Este celular aún no está emparejado con un computador.");
        setSession(await backend.openCompany(uid));
      } catch (e) { setErr(errorMessage(e)); }
    })();
  }, [backend]);
  if (err) return <div className="p-6 text-[15px] text-danger">{err}</div>;
  if (!session) return <Splash />;
  return (
    <SessionProvider session={session} setSession={setSession}>
      <Shell demo={backend.kind === "demo"} business={session.company.name} />
    </SessionProvider>
  );
}

function Splash() {
  return (
    <div className="m-hero grid h-full place-items-center">
      <div className="text-center">
        <div className="text-[28px] font-extrabold tracking-wide">NÚCLEO</div>
        <div className="mt-1 text-[14px] text-white/70">Abriendo tu negocio…</div>
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: typeof HomeIcon }[] = [
  { id: "inicio", label: "Inicio", icon: HomeIcon },
  { id: "vender", label: "Vender", icon: ShoppingBag },
  { id: "stock", label: "Stock", icon: Boxes },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "mas", label: "Más", icon: Menu },
];

function Shell({ demo, business }: { demo: boolean; business: string }) {
  const [tab, setTabState] = useState<Tab>("inicio");
  const [stack, setStack] = useState<Page[]>([]);
  // Cada cambio de pestaña vuelve a cargar su pantalla (datos frescos tras vender o cobrar).
  const [version, setVersion] = useState(0);
  const setTab = useCallback((t: Tab) => { setStack([]); setTabState(t); setVersion((v) => v + 1); scrollTo(0, 0); }, []);
  const open = useCallback((p: Page) => { setStack((s) => [...s, p]); scrollTo(0, 0); }, []);
  const back = useCallback(() => { setStack((s) => s.slice(0, -1)); setVersion((v) => v + 1); }, []);
  const page = stack.at(-1);

  // Botón «atrás» de Android (y del navegador): cierra la pantalla abierta.
  useEffect(() => {
    if (!page) return;
    history.pushState({ m: stack.length }, "");
    const h = () => back();
    addEventListener("popstate", h);
    return () => removeEventListener("popstate", h);
  }, [page, stack.length, back]);

  return (
    <NavCtx.Provider value={{ tab, setTab, open, back }}>
      <div className="mx-auto flex min-h-full max-w-[560px] flex-col bg-bg">
        {page ? (
          <main className="flex-1 pb-8">
            {page.name === "gasto" && <Expense />}
            {page.name === "cobro" && <Collect saleUid={page.saleUid} />}
            {page.name === "sincronizar" && <Sync demo={demo} />}
          </main>
        ) : (
          <>
            <main key={`${tab}-${version}`} className="flex-1 pb-24">
              {tab === "inicio" && <Home business={business} demo={demo} />}
              {tab === "vender" && <QuickSale />}
              {tab === "stock" && <Stock />}
              {tab === "clientes" && <Customers />}
              {tab === "mas" && <More demo={demo} />}
            </main>
            <BottomNav tab={tab} onTab={setTab} />
          </>
        )}
      </div>
    </NavCtx.Provider>
  );
}

function BottomNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur" aria-label="Secciones">
      <div className="mx-auto grid max-w-[560px] grid-cols-5">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} onClick={() => onTab(t.id)} aria-current={on ? "page" : undefined}
              className={cx("m-press flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium", on ? "text-accent" : "text-muted")}>
              <span className={cx("grid h-8 w-14 place-items-center rounded-full", on && "bg-accent-soft")}><t.icon size={22} /></span>
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function Loading({ children }: { children?: ReactNode }) {
  return <div className="px-4 py-10 text-center text-[15px] text-muted">{children ?? "Cargando…"}</div>;
}
