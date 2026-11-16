// Configuración → Claude: la persona decide si Claude puede usar NÚCLEO y con qué alcance.
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Eye, FilePlus2, MousePointerClick, PlugZap } from "lucide-react";
import { errorMessage, useBackend } from "../../data";
import { useSession } from "../../lib/session";
import { agentSettings, connectClaude, updateAgent, type AgentView } from "../../agent/host";
import type { AgentLevel } from "../../agent/tools";
import { Badge, Button, Card, Checkbox, Notice, Spinner, cx } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

const LEVEL_INFO: { value: AgentLevel; title: string; icon: typeof Eye; text: string }[] = [
  { value: "ver", title: "Solo ver", icon: Eye, text: "Mira la pantalla, abre secciones y consulta ventas, clientes, productos, gastos y el resumen. No cambia nada." },
  { value: "borradores", title: "Crear borradores", icon: FilePlus2, text: "Además crea clientes, proveedores y productos, ventas en borrador y gastos por pagar. No confirma ventas ni mueve dinero." },
  { value: "completo", title: "Acceso completo", icon: MousePointerClick, text: "Usa NÚCLEO como tú: hace clic, escribe y elige en la pantalla, confirma ventas y registra cobros. Siempre con los permisos de tu usuario." },
];

export function ClaudeSection() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [v, setV] = useState<AgentView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = backend.kind !== "tauri";

  useEffect(() => { agentSettings(backend).then(setV).catch((e) => setErr(errorMessage(e))); }, [backend]);
  // Refresca el contador de actividad mientras la pantalla está abierta.
  useEffect(() => {
    const t = window.setInterval(() => { agentSettings(backend).then(setV).catch(() => {}); }, 5000);
    return () => window.clearInterval(t);
  }, [backend]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!v) return <Spinner />;

  const save = async (enabled: boolean, level: AgentLevel) => {
    setBusy(true);
    try { setV(await updateAgent(backend, enabled, level)); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const connect = async () => {
    setBusy(true);
    try {
      setV(await connectClaude(backend));
      toast("success", "Listo. Cierra y vuelve a abrir la app de Claude para que vea NÚCLEO.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const snippet = JSON.stringify({ mcpServers: { "nucleo-erp": { command: v.exe_path || "C:\\…\\nucleo-erp.exe", args: ["--mcp"] } } }, null, 2);
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); toast("success", "Configuración copiada."); } catch { toast("info", "Selecciona el texto y cópialo con Ctrl+C."); }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Claude en NÚCLEO"
        subtitle="Permite que Claude, el asistente de Anthropic, use NÚCLEO por ti: ve la pantalla, la recorre con su propio cursor y registra datos. Tu mouse queda libre."
        actions={v.enabled ? <Badge tone="success" icon={CheckCircle2}>Activado</Badge> : <Badge>Desactivado</Badge>}
      >
        <div className="flex flex-col gap-5">
          {demo && <Notice tone="info">En la demostración puedes probar las herramientas; la conexión con la app de Claude funciona en NÚCLEO instalado.</Notice>}
          <Checkbox
            label={<span className="font-medium">Permitir que Claude use NÚCLEO</span>}
            hint="Mientras esté activado, solo la app de Claude de este computador puede conectarse (con una llave nueva cada vez que abres NÚCLEO). Puedes detenerlo en cualquier momento desde el aviso que aparece arriba."
            checked={v.enabled}
            onChange={(on) => editable && !busy && void save(on, v.level)}
          />
          <fieldset className="flex flex-col gap-2" disabled={!editable || busy}>
            <legend className="mb-1 text-[13px] font-medium">Qué puede hacer</legend>
            <div role="radiogroup" aria-label="Qué puede hacer Claude" className="grid gap-2 md:grid-cols-3">
              {LEVEL_INFO.map((l) => {
                const on = v.level === l.value;
                return (
                  <button key={l.value} type="button" role="radio" aria-checked={on} onClick={() => void save(v.enabled, l.value)}
                    className={cx("flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors", on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}>
                    <span className={cx("flex items-center gap-2 text-sm font-semibold", on ? "text-accent" : "text-ink")}><l.icon size={16} aria-hidden />{l.title}</span>
                    <span className="text-xs leading-relaxed text-muted">{l.text}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-1 text-[13px] text-muted">
            <span>Todo lo que Claude cambia queda en la auditoría con tu usuario y la marca «(Claude)».</span>
            <span>Lo que Claude lee para hacer su trabajo se envía a Claude (Anthropic). Tus datos siguen guardados solo en este computador.</span>
            {v.calls > 0 && <span>Actividad desde que abriste NÚCLEO: {v.calls} {v.calls === 1 ? "acción" : "acciones"}{v.last_call ? ` · última ${v.last_call}` : ""}.</span>}
          </div>
          {!editable && <Notice tone="warning">Solo un usuario con permiso para editar la configuración puede cambiar esto.</Notice>}
        </div>
      </Card>

      <Card
        title="Conectar con la app de Claude"
        subtitle="Agrega NÚCLEO a la app de Claude de este computador. Se hace una sola vez."
        actions={v.claude_configured ? <Badge tone="success" icon={CheckCircle2}>Conectado</Badge> : undefined}
      >
        <div className="flex flex-col gap-4">
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
            <li>Activa «Permitir que Claude use NÚCLEO» arriba.</li>
            <li>Presiona «Conectar con Claude».</li>
            <li>Cierra y vuelve a abrir la app de Claude. NÚCLEO aparece en sus conectores como «nucleo-erp».</li>
            <li>Pídele a Claude, por ejemplo: «En NÚCLEO, registra un gasto de $25.000 en combustible».</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={PlugZap} onClick={() => void connect()} disabled={demo || busy || !editable}>{v.claude_configured ? "Volver a conectar" : "Conectar con Claude"}</Button>
            {v.claude_config_path && <span className="text-xs text-muted">Se agrega a {v.claude_config_path}</span>}
          </div>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">Configurarlo a mano</summary>
            <p className="mt-2 text-xs text-muted">Si usas otro programa compatible con MCP, agrega esto a su configuración:</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">{snippet}</pre>
            <Button variant="secondary" icon={Copy} className="mt-2" onClick={() => void copy()}>Copiar</Button>
          </details>
        </div>
      </Card>
    </div>
  );
}
