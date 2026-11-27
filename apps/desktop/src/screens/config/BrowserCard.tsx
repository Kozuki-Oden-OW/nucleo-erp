// Configuración → Integraciones → Navegador: la ventana propia de NÚCLEO para el SII, el banco y otros
// sitios del negocio. Aquí la persona define qué sitios abre, dónde caen las descargas y, cada día,
// con qué accesos guardados puede NÚCLEO iniciar sesión («Autorizar por hoy»). Nada de esto lo puede
// hacer Claude: los botones son de la persona (docs/DECISIONS.md, D-NAV-01…04).
import { useCallback, useEffect, useState } from "react";
import { Globe, ShieldCheck, ShieldOff } from "lucide-react";
import { errorMessage, useBackend, type BrowserAccess, type BrowserView } from "../../data";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Field, Notice, Spinner, TextArea } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { useToast } from "../../ui/overlay";

export function BrowserCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [view, setView] = useState<BrowserView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState("");
  const [labels, setLabels] = useState("");
  const [sites, setSites] = useState("");
  const [url, setUrl] = useState("https://www.sii.cl/");

  const apply = useCallback((v: BrowserView) => {
    setView(v);
    setDir(v.settings.download_dir);
    setLabels(v.settings.shipping_dir);
    setSites(v.settings.sites.join("\n"));
  }, []);
  const load = useCallback(async () => {
    try { apply(await backend.browserInfo()); } catch (e) { setErr(errorMessage(e)); }
  }, [backend, apply]);
  useEffect(() => { void load(); }, [load]);
  // Los accesos se agregan en la tarjeta de al lado: al cambiar los datos o volver a la ventana se
  // actualizan los permisos y el estado, sin tocar lo que la persona tenga escrito y sin guardar.
  const refresh = useCallback(async () => {
    try { setView(await backend.browserInfo()); } catch { /* se verá en la próxima lectura */ }
  }, [backend]);
  useEffect(() => {
    const again = () => void refresh();
    window.addEventListener("nucleo:datos", again);
    window.addEventListener("focus", again);
    return () => { window.removeEventListener("nucleo:datos", again); window.removeEventListener("focus", again); };
  }, [refresh]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view) return <Spinner />;

  const run = async (f: () => Promise<BrowserView>, ok: string) => {
    setBusy(true);
    try { apply(await f()); toast("success", ok); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const grant = (a: BrowserAccess, on: boolean) => run(
    () => backend.browserGrant(a.uid, on),
    on ? `NÚCLEO puede iniciar sesión en ${a.name} hasta que termine el día.` : `Se quitó el permiso de hoy para ${a.name}.`,
  );
  const save = () => run(
    () => backend.browserSaveSettings({ download_dir: dir, shipping_dir: labels, sites: sites.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) }),
    "Ajustes del navegador guardados.",
  );
  const open = async () => {
    setBusy(true);
    try { await backend.browserOpen(url.trim(), null); await refresh(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const dirty = dir !== view.settings.download_dir || labels !== view.settings.shipping_dir || sites.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).join("\n") !== view.settings.sites.join("\n");

  const columns: Column<BrowserAccess>[] = [
    { key: "name", header: "Acceso", width: "minmax(8rem,1fr)", render: (a) => <span className="flex min-w-0 flex-col"><strong className="truncate">{a.name}</strong><span className="truncate text-xs text-muted">{a.username}</span></span> },
    { key: "state", header: "Hoy", width: "11rem", render: (a) => a.granted_today
      ? <Badge tone="success" icon={ShieldCheck}>Autorizado por hoy</Badge>
      : <Badge icon={ShieldOff}>{a.has_password ? "Sin permiso" : "Sin clave guardada"}</Badge> },
    ...(editable ? [{ key: "actions", header: "", width: "11rem", align: "right" as const, render: (a: BrowserAccess) => (
      <span data-agent-human>
        {a.granted_today
          ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void grant(a, false)}>Quitar permiso</Button>
          : <Button size="sm" variant="secondary" disabled={busy || !a.has_password} onClick={() => void grant(a, true)}>Autorizar por hoy</Button>}
      </span>
    ) }] : []),
  ];

  return (
    <Card
      title="Navegador de NÚCLEO"
      subtitle="Una ventana propia, separada de tu navegador, para revisar el SII, el banco y otros sitios del negocio. Las sesiones quedan abiertas en esa ventana y las descargas caen en la carpeta que elijas."
      actions={<Badge icon={Globe} tone={view.open ? "success" : "neutral"}>{view.open ? "Abierto" : "Cerrado"}</Badge>}
    >
      <div className="flex flex-col gap-5">
        <Notice tone="info" title="Cómo funciona">
          Solo abre los sitios de la lista. Al <strong>SII</strong> entras tú con tu certificado digital en esa ventana. Para un sitio con usuario y clave,
          guarda el acceso arriba y pulsa <strong>Autorizar por hoy</strong>: desde ese momento y hasta que cambie el día, NÚCLEO rellena la clave cuando la página
          la pida (también si lo pide Claude). Claude nunca ve ni escribe la clave, y no puede autorizarse solo.
        </Notice>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1"><Field label="Abrir una dirección" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.sii.cl/" /></div>
          <Button variant="secondary" icon={Globe} disabled={busy || !url.trim()} onClick={() => void open()}>Abrir navegador</Button>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-ink">Ingresos autorizados hoy ({view.today.split("-").reverse().join("-")})</h4>
          <DataTable label="Accesos y su permiso de hoy" columns={columns} rows={view.accesses} rowKey={(a) => a.uid} empty="Aún no hay accesos guardados: agrégalos en «Accesos»." />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Field label="Carpeta de descargas" optional value={dir} onChange={(e) => setDir(e.target.value)} placeholder="D:\Facturas" hint={`Hoy se guarda en: ${view.folder}`} disabled={!editable} />
            <Field label="Carpeta de etiquetas de envío" optional value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="D:\Envios" hint={`Las etiquetas del courier quedan en: ${view.shipping_folder}`} disabled={!editable} />
          </div>
          <TextArea label="Sitios permitidos" value={sites} onChange={(e) => setSites(e.target.value)} rows={3} hint={`Uno por línea, solo el dominio (bci.cl). Los sitios de los accesos guardados ya están incluidos. Abre: ${view.allowed.join(", ") || "ninguno"}.`} disabled={!editable} />
        </div>
        {editable && (
          <div className="flex justify-end">
            <span data-agent-human><Button disabled={busy || !dirty} onClick={() => void save()}>Guardar ajustes</Button></span>
          </div>
        )}
      </div>
    </Card>
  );
}
