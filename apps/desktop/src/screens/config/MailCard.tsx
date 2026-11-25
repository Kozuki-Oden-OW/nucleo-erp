// Configuración → Integraciones → Correo: la casilla de la empresa (SMTP con usuario y clave de
// aplicación), correo de prueba, plantillas de despacho, cobro y promoción, y los últimos enviados.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Mail, Save, Send, Unplug } from "lucide-react";
import { errorMessage, useBackend, type MailLogRow, type MailPreset, type MailSetup, type MailStatus, type MailTemplates } from "../../data";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, Field, Notice, Select, Spinner, Tabs, TextArea } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { useToast } from "../../ui/overlay";

const KIND_LABEL: Record<string, string> = { prueba: "Prueba", envio: "Despacho", cobro: "Cobro", promocion: "Promoción", otro: "Otro" };
const FIELDS = {
  envio: "{cliente} {empresa} {venta} {courier} {seguimiento} {destino} {firma}",
  cobro: "{cliente} {empresa} {detalle} {total} {vencido} {firma}",
  promocion: "{cliente} {empresa} {firma}",
} as const;

export function MailCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [st, setSt] = useState<MailStatus | null>(null);
  const [presets, setPresets] = useState<MailPreset[]>([]);
  const [form, setForm] = useState<MailSetup | null>(null);
  const [tpl, setTpl] = useState<MailTemplates | null>(null);
  const [tab, setTab] = useState<keyof MailTemplates>("envio");
  const [log, setLog] = useState<MailLogRow[]>([]);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = useCallback((s: MailStatus) => {
    setSt(s);
    setForm({ host: s.host, port: s.port || null, security: s.security || "tls", username: s.username, password: "", from_name: s.from_name, from_email: s.from_email, reply_to: s.reply_to, bcc_self: s.bcc_self, agent_send: s.agent_send });
  }, []);
  const load = useCallback(async () => {
    try {
      apply(await backend.mailStatus());
      setPresets(await backend.mailPresets());
      setTpl(await backend.mailTemplates());
      setLog(await backend.mailLog(null, 20));
    } catch (e) { setErr(errorMessage(e)); }
  }, [apply, backend]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!st || !form || !tpl) return <Spinner />;

  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try { await f(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  };
  const set = (p: Partial<MailSetup>) => setForm({ ...form, ...p });
  const usePreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (p) set({ host: p.host, port: p.port, security: p.security });
  };
  const preset = presets.find((p) => p.host === form.host);
  const save = () => run("save", async () => { apply(await backend.mailSave(form)); toast("success", "Correo de la empresa guardado."); });
  const test = () => run("test", async () => {
    const r = await backend.mailTest(testTo || null);
    toast("success", `Correo de prueba enviado a ${r.to_addr}. Revisa la bandeja (y spam).`);
    apply(await backend.mailStatus());
    setLog(await backend.mailLog(null, 20));
  });
  const disconnect = () => run("disc", async () => { apply(await backend.mailDisconnect()); });
  const saveTpl = () => run("tpl", async () => { setTpl(await backend.mailSaveTemplates(tpl)); toast("success", "Plantillas guardadas."); });

  const cols: Column<MailLogRow>[] = [
    { key: "d", header: "Fecha", width: "8.5rem", render: (r) => new Date(r.sent_at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) },
    { key: "k", header: "Tipo", width: "6.5rem", render: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { key: "t", header: "Para", width: "minmax(8rem,1fr)", render: (r) => <span className="truncate" title={r.to_addr}>{r.customer_name ?? r.to_addr}</span> },
    { key: "s", header: "Asunto", width: "minmax(10rem,1.4fr)", render: (r) => <span className="truncate" title={r.subject}>{r.subject}</span> },
    { key: "e", header: "Estado", width: "6.5rem", render: (r) => <span title={r.error ?? undefined}><Badge tone={r.status === "enviado" ? "success" : "danger"}>{r.status === "enviado" ? "Enviado" : "Falló"}</Badge></span> },
  ];

  return (
    <Card title="Correo de la empresa"
      subtitle="NÚCLEO envía avisos de despacho, recordatorios de cobro y promociones desde tu casilla. Cada correo lo revisas y lo envías tú."
      actions={st.configured ? <Badge tone="success" icon={CheckCircle2}>{st.from_email}</Badge> : <Badge icon={Mail}>Sin conectar</Badge>}>
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Proveedor" value={preset?.name ?? ""} onChange={(e) => usePreset(e.target.value)} disabled={!editable}
            options={[{ value: "", label: "Otro (escribe el servidor)" }, ...presets.map((p) => ({ value: p.name, label: p.name }))]}
            hint={preset?.note} />
          <Field label="Servidor SMTP" value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.titan.email" disabled={!editable} />
          <Select label="Seguridad" value={form.security} onChange={(e) => set({ security: e.target.value, port: e.target.value === "starttls" ? 587 : 465 })} disabled={!editable}
            options={[{ value: "tls", label: "SSL/TLS (465)" }, { value: "starttls", label: "STARTTLS (587)" }, { value: "ninguna", label: "Sin cifrar (solo red local)" }]} />
          <Field label="Puerto" inputMode="numeric" value={form.port ?? ""} onChange={(e) => set({ port: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })} disabled={!editable} />
          <Field label="Correo remitente" type="email" value={form.from_email} onChange={(e) => set({ from_email: e.target.value })} placeholder="ventas@tuempresa.cl" disabled={!editable} />
          <Field label="Nombre del remitente" value={form.from_name} onChange={(e) => set({ from_name: e.target.value })} placeholder="Data Logger Chile" disabled={!editable} />
          <Field label="Usuario" value={form.username} onChange={(e) => set({ username: e.target.value })} placeholder="Vacío: el correo remitente" optional disabled={!editable} />
          <Field label="Clave o contraseña de aplicación" type="password" autoComplete="off" value={form.password} onChange={(e) => set({ password: e.target.value })}
            placeholder={st.has_password ? "Guardada (escribe para cambiarla)" : ""} disabled={!editable} hint="Se guarda cifrada en la base de esta empresa." />
          <Field label="Responder a" type="email" value={form.reply_to} onChange={(e) => set({ reply_to: e.target.value })} optional disabled={!editable} />
          <div className="flex items-end pb-2"><Checkbox label="Guardar copia en mi casilla (CCO)" checked={form.bcc_self} onChange={(v) => set({ bcc_self: v })} /></div>
        </div>
        <div data-agent-human className="rounded-lg border border-line p-3">
          <Checkbox label="Permitir que Claude envíe los correos que le pidas" checked={form.agent_send} onChange={(v) => { if (editable) set({ agent_send: v }); }}
            hint="Apagado, Claude solo prepara el texto y tú lo envías. Encendido, puede enviarlo desde esta casilla cuando se lo pidas (por ejemplo, una cotización con su PDF). Cada correo queda en el registro con «(Claude)». Solo tú puedes cambiar esta casilla." />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button icon={Save} onClick={save} disabled={!editable || !!busy}>{busy === "save" ? "Guardando…" : "Guardar"}</Button>
          {st.configured && (
            <>
              <Field className="min-w-[14rem]" label="Probar enviando a" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={st.from_email} />
              <Button variant="secondary" icon={Send} onClick={test} disabled={!!busy}>{busy === "test" ? "Enviando…" : "Enviar prueba"}</Button>
              {editable && <Button variant="ghost" icon={Unplug} onClick={disconnect} disabled={!!busy}>Quitar</Button>}
            </>
          )}
          {st.last_test_at && <span className="text-xs text-muted">Última prueba correcta: {new Date(st.last_test_at).toLocaleString("es-CL")}</span>}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">Plantillas</h3>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: "envio", label: "Despacho" }, { value: "cobro", label: "Cobro" }, { value: "promocion", label: "Promoción" }]} />
          <Field label="Asunto" value={tpl[tab].subject} onChange={(e) => setTpl({ ...tpl, [tab]: { ...tpl[tab], subject: e.target.value } })} disabled={!editable} />
          <TextArea label="Texto" rows={9} style={{ height: "13rem" }} value={tpl[tab].body} onChange={(e) => setTpl({ ...tpl, [tab]: { ...tpl[tab], body: e.target.value } })} disabled={!editable}
            hint={`Campos disponibles: ${FIELDS[tab]}`} />
          <div><Button variant="secondary" icon={Save} onClick={saveTpl} disabled={!editable || !!busy}>Guardar plantillas</Button></div>
        </div>

        {log.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Últimos correos</h3>
            <DataTable label="Últimos correos enviados" rows={log} columns={cols} rowKey={(r) => String(r.id)} maxHeight="20rem" />
          </div>
        )}
      </div>
    </Card>
  );
}
