import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackendProvider, createDemoBackend, defaultBackend, errorMessage, useBackend, type AppInfo, type Backend, type CreatedCompany,
  type QuoteDetail, type SaleDetail, type SessionInfo,
} from "./data";
import { PrefsProvider } from "./lib/prefs";
import { SessionProvider } from "./lib/session";
import { Login } from "./screens/Login";
import { Documents } from "./screens/documentos/Documents";
import { navigate, useRoute, type Route } from "./lib/router";
import { AppShell } from "./shell/AppShell";
import { Dashboard } from "./screens/Dashboard";
import { Onboarding } from "./screens/Onboarding";
import { Proximamente } from "./screens/Proximamente";
import { RecoveryKey } from "./screens/RecoveryKey";
import { Customers } from "./screens/clientes/Customers";
import { ImportCalculator } from "./screens/comex/ImportCalculator";
import { Purchases } from "./screens/compras/Purchases";
import { Config } from "./screens/config/Config";
import { Products } from "./screens/productos/Products";
import { DocEditor } from "./screens/ventas/DocEditor";
import { QuoteView } from "./screens/ventas/QuoteView";
import { SaleView } from "./screens/ventas/SaleView";
import { SalesList } from "./screens/ventas/SalesList";
import { Notice, Spinner } from "./ui/kit";
import { ToastProvider } from "./ui/overlay";

export function App() {
  const [backend, setBackend] = useState<Backend>(defaultBackend);
  return (
    <PrefsProvider>
      <BackendProvider backend={backend}>
        <ToastProvider>
          <Root key={backend.kind} onDemo={backend.kind === "tauri" ? () => setBackend(createDemoBackend()) : undefined} />
        </ToastProvider>
      </BackendProvider>
    </PrefsProvider>
  );
}

function Root({ onDemo }: { onDemo?: () => void }) {
  const backend = useBackend();
  const route = useRoute();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pendingKey, setPendingKey] = useState<CreatedCompany | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const load = useCallback(async (openUid?: string) => {
    try {
      const i = await backend.appInfo();
      setInfo(i);
      const uid = openUid ?? session?.company.uid ?? i.companies[0]?.uid;
      if (uid) setSession(await backend.openCompany(uid));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [backend, session?.company.uid]);

  // Carga inicial una sola vez al abrir la aplicación.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  if (error) return <div className="p-8"><Notice tone="danger">{error}</Notice></div>;
  if (!info) return <div className="p-8"><Spinner label="Abriendo NÚCLEO…" /></div>;
  if (pendingKey) {
    return <RecoveryKey recoveryKey={pendingKey.recovery_key} onDone={() => { const uid = pendingKey.company.uid; setPendingKey(null); navigate("/inicio", { replace: true }); void load(uid); }} />;
  }
  if (info.companies.length === 0 || !session) return <Onboarding onCreated={setPendingKey} onDemo={onDemo} />;
  if (session.login_required) {
    return <Login info={info} session={session} locked={locked} onLogged={(s) => { setLocked(false); setSession(s); }} onSwitch={(uid) => void load(uid)} />;
  }

  return (
    <SessionProvider session={session} setSession={setSession}>
      <InactivityLock session={session} onLocked={(s) => { setLocked(true); setSession(s); }} />
      <AppShell info={info} session={session} route={route} onSwitch={(uid) => void load(uid)}>
        <Screen route={route} info={info} session={session} reload={() => void load()} />
      </AppShell>
    </SessionProvider>
  );
}

/** Bloquea la pantalla tras N minutos sin actividad, solo si el negocio usa contraseñas. */
function InactivityLock({ session, onLocked }: { session: SessionInfo; onLocked: (s: SessionInfo) => void }) {
  const backend = useBackend();
  const active = session.login_users.length > 0 && session.lock_minutes > 0;
  const cb = useRef(onLocked);
  cb.current = onLocked;
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { backend.logout().then((s) => cb.current(s)).catch(() => {}); }, session.lock_minutes * 60_000);
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [active, session.lock_minutes, backend]);
  return null;
}

function Screen({ route, info, session, reload }: { route: Route; info: AppInfo; session: SessionInfo; reload: () => void }) {
  const backend = useBackend();
  const [section = "inicio", a, b] = route.path;
  const has = backend.features;

  switch (section) {
    case "inicio":
      return has.has("dashboard") ? <Dashboard session={session} /> : <DesktopHome session={session} />;
    case "ventas":
      if (!has.has("ventas")) return <Proximamente id="vender" />;
      if (a === "nueva") return <DocEditor key={route.raw} kind={route.query.get("tipo") === "FV" ? "FV" : "VEN"} initialCustomerUid={route.query.get("cliente")} />;
      if (a && b === "editar") return <EditLoader kind="sale" uid={a} />;
      if (a) return <SaleView key={a} uid={a} />;
      return <SalesList route={route} />;
    case "cotizaciones":
      if (!has.has("ventas")) return <Proximamente id="vender" />;
      if (a === "nueva") return <DocEditor key={route.raw} kind="COT" initialCustomerUid={route.query.get("cliente")} />;
      if (a && b === "editar") return <EditLoader kind="quote" uid={a} />;
      if (a) return <QuoteView key={a} uid={a} />;
      navigate("/ventas?tab=cotizaciones", { replace: true });
      return null;
    case "clientes":
      return <Customers route={route} />;
    case "productos":
      return has.has("productos") ? <Products route={route} /> : <Proximamente id="productos" />;
    case "compras":
      return has.has("compras") ? <Purchases route={route} /> : <Proximamente id="comprar" />;
    case "comex":
      return has.has("comex") ? <ImportCalculator /> : <Proximamente id="comex" />;
    case "config":
      return <Config route={route} info={info} session={session} onChanged={reload} />;
    case "documentos":
      return has.has("documentos") ? <Documents route={route} /> : <Proximamente id="documentos" />;
    case "proximamente":
      return <Proximamente id={a ?? ""} />;
    default:
      return <Proximamente id={section} />;
  }
}

function EditLoader({ kind, uid }: { kind: "sale" | "quote"; uid: string }) {
  const backend = useBackend();
  const [doc, setDoc] = useState<SaleDetail | QuoteDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (kind === "sale" ? backend.sale(uid) : backend.quote(uid)).then(setDoc).catch((e) => setErr(errorMessage(e)));
  }, [backend, kind, uid]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!doc) return <Spinner />;
  const docKind = kind === "quote" ? "COT" : (doc as SaleDetail).doc_type;
  return <DocEditor kind={docKind} existing={doc} />;
}

/** Inicio del escritorio mientras el dashboard real (Fase 12) no existe. */
function DesktopHome({ session }: { session: SessionInfo }) {
  return (
    <div className="anim-in flex flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{session.company.name}</h1>
        <p className="mt-1 text-sm text-muted">Tu negocio está creado y cifrado en este computador. Los módulos se habilitan fase a fase.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Clientes</div><div className="num mt-2 text-[22px] font-semibold">{session.customers}</div></div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Cifrado</div><div className="mt-2 text-[17px] font-semibold text-success">SQLCipher {session.cipher_version.split(" ")[0]}</div></div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card"><div className="text-xs font-semibold uppercase tracking-wide text-muted">Auditoría</div><div className={`mt-2 text-[17px] font-semibold ${session.audit.ok ? "text-success" : "text-danger"}`}>{session.audit.ok ? `Íntegra (${session.audit.entries})` : "Alterada"}</div></div>
      </div>
      <Notice tone="info" title="Tus datos están en este computador">
        NÚCLEO no envía información a ningún servidor, no pide credenciales tributarias y funciona sin Internet. Crea respaldos periódicos
        desde Configuración → Respaldos.
      </Notice>
    </div>
  );
}
