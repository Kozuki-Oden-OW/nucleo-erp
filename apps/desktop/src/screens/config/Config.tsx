import { useEffect, useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { Building2, Coins, DatabaseBackup, Hash, Lock, Palette, ShieldCheck, Users } from "lucide-react";
import { useBackend, errorMessage, type AppInfo, type BackupDone, type BusinessProfile, type BusinessSettings, type SessionInfo } from "../../data";
import { formatBytes, formatPpm, parsePercent } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { usePrefs } from "../../lib/prefs";
import { Button, Card, Checkbox, Field, Notice, PageHeader, Segmented, Spinner, cx } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { useSession } from "../../lib/session";
import { CurrenciesSection, NumberingSection, SecuritySection } from "./Catalogs";
import { UsersSection } from "./Users";

type Section = "negocio" | "usuarios" | "numeracion" | "monedas" | "respaldos" | "seguridad" | "apariencia";
const SECTIONS: { id: Section; label: string; icon: typeof Building2; feature?: string }[] = [
  { id: "negocio", label: "Mi negocio", icon: Building2, feature: "negocio" },
  { id: "usuarios", label: "Usuarios y roles", icon: Users, feature: "usuarios" },
  { id: "numeracion", label: "Numeración", icon: Hash, feature: "numeracion" },
  { id: "monedas", label: "Monedas", icon: Coins, feature: "monedas" },
  { id: "respaldos", label: "Respaldos", icon: DatabaseBackup },
  { id: "seguridad", label: "Seguridad y auditoría", icon: ShieldCheck },
  { id: "apariencia", label: "Apariencia", icon: Palette },
];

export function Config({ route, info, session, onChanged }: { route: Route; info: AppInfo; session: SessionInfo; onChanged: () => void }) {
  const backend = useBackend();
  const section = (route.path[1] as Section) || "negocio";
  return (
    <div className="anim-in">
      <PageHeader title="Configuración" />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Secciones de configuración">
          {SECTIONS.map((s) => {
            const ready = !s.feature || backend.features.has(s.feature as never);
            return (
              <button
                key={s.id}
                onClick={() => navigate(`/config/${s.id}`)}
                className={cx("flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm", section === s.id ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-2", !ready && "text-faint")}
              >
                <s.icon size={16} aria-hidden /> {s.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">
          {section === "negocio" && <BusinessSection onChanged={onChanged} />}
          {section === "usuarios" && <UsersSection />}
          {section === "numeracion" && <NumberingSection />}
          {section === "monedas" && <CurrenciesSection />}
          {section === "respaldos" && <BackupsSection info={info} onRestored={onChanged} />}
          {section === "seguridad" && <SecuritySection session={session} />}
          {section === "apariencia" && <AppearanceSection />}
        </div>
      </div>
    </div>
  );
}

const PROFILES: { value: BusinessProfile; title: string; text: string }[] = [
  { value: "emprendedor", title: "Emprendedor", text: "Estoy comenzando. Productos, precios, cotizaciones, ventas, gastos y caja. Sin datos tributarios obligatorios." },
  { value: "negocio", title: "Negocio", text: "Vendo con regularidad. Agrega compras, stock, cuentas por cobrar y pagar, bancos y reportes." },
  { value: "empresa", title: "Empresa", text: "Empresa constituida. Varios usuarios, bodegas, contabilidad interna, comercio exterior y más." },
];

function BusinessSection({ onChanged }: { onChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [b, setB] = useState<BusinessSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rateText, setRateText] = useState<string | null>(null);
  useEffect(() => { backend.business().then(setB).catch((e) => setErr(errorMessage(e))); }, [backend]);
  if (err) return <Notice tone="info" title="Próximamente">{err}</Notice>;
  if (!b) return <Spinner />;
  const set = (patch: Partial<BusinessSettings>) => setB({ ...b, ...patch });
  const userRate = rateText ?? (b.tax_rate_user_ppm ? String(b.tax_rate_user_ppm / 10_000).replace(".", ",") : "");
  const fromPackage = b.tax_rate_ppm !== null && b.tax_rate_ppm !== b.tax_rate_user_ppm;
  async function save() {
    const patch: Partial<BusinessSettings> = { ...b! };
    if (rateText !== null) {
      const ppm = rateText.trim() === "" ? null : parsePercent(rateText);
      if (rateText.trim() !== "" && (ppm === null || ppm <= 0 || ppm >= 1_000_000)) { toast("danger", "Escribe la tasa como porcentaje, por ejemplo 12,5."); return; }
      patch.tax_rate_user_ppm = ppm;
    }
    try { setB(await backend.updateBusiness(patch)); setRateText(null); toast("success", "Datos del negocio guardados."); onChanged(); }
    catch (e) { toast("danger", errorMessage(e)); }
  }
  return (
    <div className="flex flex-col gap-6">
      <Card title="Perfil de operación" subtitle="Decide qué módulos ves en el menú. Puedes cambiarlo cuando quieras sin perder nada.">
        <div className="grid gap-3 md:grid-cols-3">
          {PROFILES.map((p) => (
            <button key={p.value} onClick={() => set({ profile: p.value })} aria-pressed={b.profile === p.value}
              className={cx("rounded-xl border p-4 text-left transition-colors", b.profile === p.value ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
              <div className="font-semibold text-ink">{p.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted">{p.text}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Datos del negocio" subtitle="Aparecen en tus cotizaciones y documentos internos. Solo el nombre es obligatorio.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre del negocio" value={b.name} onChange={(e) => set({ name: e.target.value })} />
          <Field label="Razón social" optional value={b.legal_name ?? ""} onChange={(e) => set({ legal_name: e.target.value || null })} />
          <Field label="RUT" optional value={b.rut ?? ""} onChange={(e) => set({ rut: e.target.value || null })} />
          <Field label="Giro o actividad" optional value={b.activity ?? ""} onChange={(e) => set({ activity: e.target.value || null })} />
          <Field label="Dirección" optional value={b.address ?? ""} onChange={(e) => set({ address: e.target.value || null })} />
          <Field label="Teléfono" optional value={b.phone ?? ""} onChange={(e) => set({ phone: e.target.value || null })} />
          <Field label="Correo" optional value={b.email ?? ""} onChange={(e) => set({ email: e.target.value || null })} />
        </div>
      </Card>
      <Card title="Documentación tributaria e impuestos" subtitle="NÚCLEO no es un sistema tributario: no emite ni envía nada. Solo te recuerda y calcula referencias.">
        <div className="flex flex-col gap-4">
          <Checkbox
            label="Recordarme documentar mis ventas"
            hint="Cada venta efectuada queda “pendiente de documentación” hasta que anotes la factura o boleta que emitiste en el sistema oficial."
            checked={b.documentation_reminder}
            onChange={(v) => set({ documentation_reminder: v })}
          />
          <Checkbox
            label="Calcular IVA en mis documentos (informativo)"
            hint={b.tax_rate_ppm ? `Tasa aplicada: ${formatPpm(b.tax_rate_ppm, 1)} · ${b.tax_rule_source ?? ""}` : "Anota abajo la tasa que aplicas. Sin una tasa, los documentos no calculan IVA."}
            checked={b.tax_enabled}
            onChange={(v) => set({ tax_enabled: v })}
          />
          {b.tax_enabled && (
            <div className="flex max-w-md flex-col gap-1.5">
              <Field label="Tasa de IVA que aplicas" optional suffix="%" inputMode="decimal" value={userRate} disabled={!editable}
                onChange={(e) => setRateText(e.target.value)} className="w-60" inputClassName="text-right num" />
              <p className="text-xs leading-relaxed text-muted">
                {fromPackage
                  ? "Hay un paquete normativo vigente: su tasa tiene prioridad sobre la que anotes aquí."
                  : "Verifica la tasa vigente en el sitio oficial del SII. NÚCLEO no la descarga ni la cambia por ti; el cálculo es solo informativo."}
              </p>
            </div>
          )}
        </div>
      </Card>
      {editable ? <div><Button onClick={save}>Guardar cambios</Button></div> : <Notice tone="info">Solo el dueño o un administrador puede cambiar estos datos.</Notice>}
    </div>
  );
}

function BackupsSection({ info, onRestored }: { info: AppInfo; onRestored: () => void }) {
  const backend = useBackend();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BackupDone | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [rpw, setRpw] = useState("");
  const { can } = useSession();
  const demo = backend.kind === "demo";

  async function create() {
    setBusy(true); setMsg(null); setDone(null);
    try { setDone(await backend.createBackup(pw)); setPw(""); setPw2(""); }
    catch (e) { setMsg({ tone: "danger", text: errorMessage(e) }); } finally { setBusy(false); }
  }
  async function pick() {
    const f = await openFile({ multiple: false, directory: false, filters: [{ name: "Respaldo NÚCLEO", extensions: ["erpbackup"] }] });
    if (typeof f === "string") setPath(f);
  }
  async function restore() {
    if (!path) return;
    setBusy(true); setMsg(null);
    try {
      const c = await backend.restoreBackup(path, rpw);
      setMsg({ tone: "success", text: `Respaldo restaurado como “${c.name}”. Ábrelo desde el selector de negocio.` });
      setRpw(""); setPath(null); onRestored();
    } catch (e) { setMsg({ tone: "danger", text: errorMessage(e) }); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-6">
      {demo && <Notice tone="info">En la demostración no se crean ni restauran respaldos. En el programa instalado quedan cifrados en tu computador.</Notice>}
      <Card title="Crear respaldo" subtitle={<>Queda cifrado con la contraseña que elijas y se verifica al terminar. Carpeta: <span className="font-mono text-xs">{info.backups_dir}</span></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña del respaldo" type="password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo 8 caracteres. Sin ella no se puede restaurar." />
          <Field label="Repetir contraseña" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw2 && pw !== pw2 ? "Las contraseñas no coinciden." : null} />
        </div>
        <div className="mt-4"><Button icon={Lock} onClick={create} disabled={demo || !can("respaldos.crear") || busy || pw.length < 8 || pw !== pw2}>{busy ? "Trabajando…" : "Crear respaldo"}</Button></div>
        {done && <div className="mt-4"><Notice tone="success">Respaldo verificado ✓ — {done.file_name} ({formatBytes(done.size_bytes)}), {done.manifest.counts["customers"] ?? 0} clientes.</Notice></div>}
      </Card>
      <Card title="Restaurar respaldo" subtitle="Se restaura como un negocio nuevo: nunca reemplaza al actual.">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3"><Button variant="secondary" onClick={pick} disabled={demo}>Elegir archivo .erpbackup</Button><span className="truncate text-sm text-muted">{path ?? "Ningún archivo elegido"}</span></div>
          <Field label="Contraseña del respaldo" type="password" value={rpw} onChange={(e) => setRpw(e.target.value)} />
          <div><Button onClick={restore} disabled={demo || !can("respaldos.restaurar") || busy || !path || rpw.length < 8}>Restaurar</Button></div>
        </div>
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

function AppearanceSection() {
  const { prefs, set } = usePrefs();
  return (
    <Card title="Apariencia" subtitle="Preferencias de este computador. No cambian los datos del negocio.">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Tema</span>
          <Segmented label="Tema" value={prefs.theme} onChange={(v) => set({ theme: v })} options={[{ value: "sistema", label: "Igual que Windows" }, { value: "claro", label: "Claro" }, { value: "oscuro", label: "Oscuro" }]} />
        </div>
        <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Densidad</span>
          <Segmented label="Densidad" value={prefs.density} onChange={(v) => set({ density: v })} options={[{ value: "comoda", label: "Cómoda" }, { value: "compacta", label: "Compacta" }]} />
          <span className="text-xs text-muted">Compacta muestra más filas: útil si digitas todo el día.</span>
        </div>
        <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">Vista</span>
          <Segmented label="Vista" value={prefs.view} onChange={(v) => set({ view: v })} options={[{ value: "simple", label: "Simple" }, { value: "contador", label: "Contador" }]} />
          <span className="text-xs text-muted">Simple usa lenguaje de negocio (“Dinero que te deben”); Contador usa términos contables (“Deudores por venta”). No cambia permisos.</span>
        </div>
      </div>
    </Card>
  );
}
