// Informe por correo: el resumen del negocio que le llega al dueño los días que elija, y la meta de
// ventas del mes contra la que se mide el avance.
import { useEffect, useState } from "react";
import { Mail, Save, Send, Target } from "lucide-react";
import { useBackend, errorMessage, type DigestPreview, type DigestSettings } from "../../data";
import { formatMoney } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { HOURS, WeekdayPicker, weekdaysText } from "../../ui/Weekdays";
import { Button, Card, Checkbox, Field, Notice, Select, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

export function DigestSection() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [p, setP] = useState<DigestPreview | null>(null);
  const [f, setF] = useState<DigestSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"guardar" | "enviar" | null>(null);
  useEffect(() => { backend.digestPreview().then((x) => { setP(x); setF(x.settings); }).catch((e) => setErr(errorMessage(e))); }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!p || !f) return <Spinner />;

  async function save() {
    setBusy("guardar");
    try { const x = await backend.digestSaveSettings(f!); setP(x); setF(x.settings); toast("success", x.settings.enabled ? "Informe programado." : "Ajustes guardados."); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  }
  async function sendNow() {
    setBusy("enviar");
    try { const to = await backend.digestSend(); toast("success", `Informe enviado a ${to}.`); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  }
  const g = p.goal;
  return (
    <div className="flex flex-col gap-6">
      <Card title={<span className="inline-flex items-center gap-2"><Target size={17} aria-hidden />Meta de ventas del mes</span>}
        subtitle="Total con impuesto, el mismo número de «Ventas del mes» en el Inicio. El informe y Claude dicen cuánto falta y cuánto hay que vender por día hábil.">
        <div data-agent-human className="grid items-end gap-4 sm:grid-cols-2">
          <MoneyField label="Meta del mes" value={f.goal_minor || null} onValue={(v) => setF({ ...f, goal_minor: v ?? 0 })} disabled={!editable} />
          {g && (
            <p className="pb-2 text-sm text-muted">
              Llevas <strong className="num text-ink">{formatMoney(g.sold_minor)}</strong> ({Math.round(g.progress_ppm / 10_000)} %).{" "}
              {g.remaining_minor > 0 ? <>Faltan <strong className="num text-ink">{formatMoney(g.remaining_minor)}</strong>: {formatMoney(g.per_workday_minor)} por día hábil ({g.workdays_left} por delante).</> : "Meta cumplida."}
            </p>
          )}
        </div>
      </Card>

      <Card title={<span className="inline-flex items-center gap-2"><Mail size={17} aria-hidden />Informe por correo</span>}
        subtitle="Ventas, resultado del mes, dinero y lo que requiere tu atención. Se arma en tu computador y sale por la casilla de la empresa.">
        {!p.mail_ready && (
          <div className="mb-4">
            <Notice tone="info" title="Falta conectar el correo de la empresa" actions={<Button size="sm" onClick={() => navigate("/config/integraciones")}>Ir a Integraciones</Button>}>
              El informe sale desde tu casilla. Conéctala una vez en Configuración → Integraciones → Correo.
            </Notice>
          </div>
        )}
        <div data-agent-human className="flex flex-col gap-4">
          <Checkbox label="Enviármelo solo, los días que elija" checked={f.enabled} onChange={(v) => editable && setF({ ...f, enabled: v })}
            hint="Sale cuando NÚCLEO está abierto ese día, desde la hora indicada. Si abres el programa más tarde, sale al abrirlo." />
          <WeekdayPicker label="Días" value={f.weekdays} onChange={(v) => setF({ ...f, weekdays: v })} disabled={!editable} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Desde qué hora" value={String(f.hour)} onChange={(e) => setF({ ...f, hour: Number(e.target.value) })} options={HOURS} disabled={!editable} />
            <Field label="A qué correo" optional value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder={p.to || "la casilla de la empresa"} hint="Vacío: la casilla de la empresa. Puedes poner varias separadas por coma." disabled={!editable} />
          </div>
          {f.enabled && <p className="text-[13px] text-muted">Te llegará {weekdaysText(f.weekdays)} desde las {String(f.hour).padStart(2, "0")}:00.{p.last.last_run_at && ` Último envío: ${new Date(p.last.last_run_at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}${p.last.last_ok ? "" : ` (no salió: ${p.last.last_error ?? ""})`}.`}</p>}
        </div>
        {editable
          ? <div className="mt-4 flex flex-wrap gap-2"><span data-agent-human><Button icon={Save} onClick={save} disabled={busy !== null}>{busy === "guardar" ? "Guardando…" : "Guardar"}</Button></span><Button variant="secondary" icon={Send} onClick={sendNow} disabled={busy !== null || !p.mail_ready}>{busy === "enviar" ? "Enviando…" : "Enviarlo ahora"}</Button></div>
          : <p className="mt-4 text-sm text-muted">Solo el dueño o un administrador programa el informe.</p>}
      </Card>

      <Card title="Así se ve hoy" subtitle={p.subject}>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-4 font-mono text-[12.5px] leading-relaxed text-ink">{p.body}</pre>
      </Card>
    </div>
  );
}
