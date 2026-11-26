// Configuración → Integraciones → WhatsApp: conexión con el puente local (integraciones/whatsapp),
// vinculación del número con el código QR, los números que NÚCLEO no muestra y el permiso para que
// Claude envíe. La llave la escribe la persona; el QR y el permiso son solo de ella.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MessageCircle, RefreshCw, Save, Unplug } from "lucide-react";
import { errorMessage, useBackend, type WspBridgeState, type WspSetup, type WspStatus } from "../../data";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, Field, Notice, Spinner, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

const DEFAULT_URL = "http://127.0.0.1:47620";
const phone = (d: string | null) => (d ? `+${d}` : "");

export function WhatsAppCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [st, setSt] = useState<WspStatus | null>(null);
  const [form, setForm] = useState<WspSetup>({ url: DEFAULT_URL, key: "", agent_send: false, ignore: [] });
  const [ignoreText, setIgnoreText] = useState("");
  const [bridge, setBridge] = useState<WspBridgeState | null>(null);
  const [bridgeErr, setBridgeErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = useCallback((s: WspStatus) => {
    setSt(s);
    setForm({ url: s.url || DEFAULT_URL, key: "", agent_send: s.agent_send, ignore: s.ignore });
    setIgnoreText(s.ignore.map((n) => `+${n}`).join("\n"));
  }, []);
  const check = useCallback(async () => {
    try { setBridge(await backend.wspState()); setBridgeErr(null); }
    catch (e) { setBridge(null); setBridgeErr(errorMessage(e)); }
  }, [backend]);
  useEffect(() => { backend.wspStatus().then(apply).catch((e) => setErr(errorMessage(e))); }, [backend, apply]);
  // Mientras falta vincular (o el puente está cargando) se vuelve a consultar: el QR cambia cada ~30 s.
  useEffect(() => {
    if (!st?.configured) { setBridge(null); setBridgeErr(null); return; }
    void check();
    if (bridge?.estado === "listo") return;
    const t = setInterval(() => void check(), 6000);
    return () => clearInterval(t);
  }, [st?.configured, bridge?.estado, check]);

  if (err) return <Card title="WhatsApp"><Notice tone="danger">{err}</Notice></Card>;
  if (!st) return <Card title="WhatsApp"><Spinner /></Card>;

  const run = async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    try { await f(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  };
  const save = () => run("save", async () => {
    apply(await backend.wspSave({ ...form, ignore: ignoreText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) }));
    toast("success", "Conexión de WhatsApp guardada.");
  });
  const disconnect = () => run("disc", async () => { apply(await backend.wspDisconnect()); toast("success", "Conexión de WhatsApp quitada. El número sigue vinculado al puente hasta que lo quites en el teléfono."); });

  const linked = bridge?.estado === "listo";
  return (
    <Card title="WhatsApp" subtitle="Lee los chats de tu WhatsApp de empresa y envía mensajes desde NÚCLEO, por un puente que corre en este computador."
      actions={linked ? <Badge icon={CheckCircle2} tone="success">Vinculado {phone(bridge?.numero ?? null)}</Badge> : st.configured ? <Badge icon={MessageCircle}>Sin vincular</Badge> : <Badge icon={MessageCircle}>Sin conectar</Badge>}>
      <div className="flex flex-col gap-4">
        <details className="text-sm text-muted" open={!st.configured}>
          <summary className="cursor-pointer font-medium text-ink">Cómo se activa</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
            <li>Con Docker Desktop abierto, ejecuta <code>Iniciar-WhatsApp.ps1</code> (carpeta <code>integraciones/whatsapp</code> de NÚCLEO). Muestra la dirección y la llave del puente.</li>
            <li>Escríbelas aquí y guarda. NÚCLEO mostrará un código QR.</li>
            <li>En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo, y escanea el código.</li>
          </ol>
          <p className="mt-2">El puente se vincula como un dispositivo más, igual que WhatsApp Web; no es la API de Meta. Sirve para la atención normal, no para envíos masivos. NÚCLEO no guarda las conversaciones: las lee del puente en el momento, y leerlas no las marca como leídas.</p>
        </details>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dirección del puente" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={DEFAULT_URL} disabled={!editable} hint="Siempre en este computador (127.0.0.1)." />
          <Field label="Llave del puente" type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
            placeholder={st.has_key ? "Guardada (escribe para cambiarla)" : ""} disabled={!editable} hint="La muestra Iniciar-WhatsApp.ps1. Se guarda cifrada en la base de esta empresa." />
        </div>

        <div data-agent-human className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <TextArea label="Números que NÚCLEO no muestra" optional rows={3} value={ignoreText} onChange={(e) => setIgnoreText(e.target.value)} disabled={!editable}
            placeholder={"+56 9 1234 5678\n+56 9 8765 4321"} />
          <p className="-mt-1 text-xs text-muted">Uno por línea, con código de país: familia, amigos, chats personales. Sus conversaciones no aparecen en NÚCLEO ni las puede leer Claude. Los grupos nunca se muestran.</p>
          <Checkbox label="Permitir que Claude envíe los mensajes que apruebes" checked={form.agent_send} onChange={(v) => { if (editable) setForm({ ...form, agent_send: v }); }}
            hint="Apagado, Claude lee los chats y te propone la respuesta, pero no envía. Encendido, puede enviar por WhatsApp el texto que tú aprobaste (y el PDF de una cotización). Cada envío queda en la auditoría con «(Claude)». Solo tú puedes cambiar esto." />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button icon={Save} onClick={save} disabled={!editable || !!busy}>{busy === "save" ? "Guardando…" : "Guardar"}</Button>
          {st.configured && <Button variant="secondary" icon={RefreshCw} onClick={() => void check()} disabled={!!busy}>Comprobar</Button>}
          {st.configured && editable && <span data-agent-human><Button variant="ghost" icon={Unplug} onClick={disconnect} disabled={!!busy}>Quitar conexión</Button></span>}
        </div>

        {st.configured && (
          <div aria-live="polite">
            {bridgeErr ? <Notice tone="warning">{bridgeErr}</Notice>
              : !bridge ? <Spinner />
              : bridge.estado === "listo" ? <Notice tone="success">WhatsApp vinculado{bridge.nombre ? ` como «${bridge.nombre}»` : ""} ({phone(bridge.numero)}). Ya se pueden leer los chats desde NÚCLEO.</Notice>
              : bridge.estado === "qr" && bridge.qr ? (
                <div data-agent-secret className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
                  <img src={bridge.qr} alt="Código QR para vincular WhatsApp" className="h-56 w-56 rounded-md bg-white p-2" />
                  <p className="max-w-xs text-sm">Escanea este código desde el teléfono de la empresa: <strong>WhatsApp → Dispositivos vinculados → Vincular un dispositivo</strong>. El código se renueva solo cada medio minuto.</p>
                </div>
              ) : <Notice tone="info">{bridge.estado === "desconectado" ? "El puente perdió la conexión con WhatsApp y está reintentando." : "El puente está cargando WhatsApp. Puede tardar un minuto."}</Notice>}
          </div>
        )}
      </div>
    </Card>
  );
}
