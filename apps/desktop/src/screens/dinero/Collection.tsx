// Cobranza por correo: la ronda (primero lo más vencido) y su programación.
import { useCallback, useEffect, useState } from "react";
import { BellRing, CalendarClock, Mail, MailX, Send, UserX } from "lucide-react";
import { useBackend, errorMessage, type CollectItem, type CollectRound, type CollectSettings } from "../../data";
import { formatDate, formatMoney } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { MailComposer } from "../../ui/MailComposer";
import { HOURS, WeekdayPicker, weekdaysText } from "../../ui/Weekdays";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Kpi, Notice, Segmented, Select, Spinner, type Tone } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

const STATE: Record<CollectItem["state"], { label: string; tone: Tone }> = {
  listo: { label: "Listo para enviar", tone: "accent" },
  reciente: { label: "Ya se le escribió", tone: "neutral" },
  sin_correo: { label: "Sin correo en su ficha", tone: "warning" },
  excluido: { label: "No se le envía", tone: "neutral" },
};

const late = (d: number) => (d > 0 ? `${d} ${d === 1 ? "día" : "días"} de atraso` : d === 0 ? "vence hoy" : `vence en ${-d} ${d === -1 ? "día" : "días"}`);

export function CollectionTab({ onChanged }: { onChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [round, setRound] = useState<CollectRound | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [mailing, setMailing] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const load = useCallback(() => { backend.collectRound().then(setRound).catch((e) => setErr(errorMessage(e))); }, [backend]);
  useEffect(load, [load]);
  useEffect(() => { window.addEventListener("nucleo:datos", load); return () => window.removeEventListener("nucleo:datos", load); }, [load]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!round) return <Spinner label="Armando la ronda…" />;
  const cfg = round.settings;
  const admin = can("config.editar");

  async function sendAll() {
    setBusy(true);
    try {
      const r = await backend.collectSend(null);
      toast(r.failed ? "warning" : "success", `${r.sent} ${r.sent === 1 ? "recordatorio enviado" : "recordatorios enviados"}${r.failed ? `; ${r.failed} no salieron (${r.errors[0] ?? ""})` : "."}`);
      setConfirm(false); load(); onChanged();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  async function exclude(it: CollectItem, off: boolean) {
    try {
      await backend.collectSaveSettings({ ...cfg, excluded: off ? [...cfg.excluded, it.customer_uid] : cfg.excluded.filter((u) => u !== it.customer_uid) });
      toast("success", off ? `No se le enviarán recordatorios a ${it.customer_name}.` : `${it.customer_name} vuelve a la ronda.`);
      load();
    } catch (e) { toast("danger", errorMessage(e)); }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Clientes en la ronda" value={String(round.items.length)} hint={`${round.ready} con el recordatorio listo`} />
        <Kpi label="Atrasado" value={formatMoney(round.overdue_minor)} tone={round.overdue_minor > 0 ? "danger" : "neutral"} />
        <Kpi label="Total que deben" value={formatMoney(round.total_minor)} />
      </div>

      {!round.mail_ready && (
        <Notice tone="info" title="Falta conectar el correo de la empresa" actions={<Button size="sm" onClick={() => navigate("/config/integraciones")}>Ir a Integraciones</Button>}>
          Los recordatorios salen desde tu casilla (por ejemplo ventas@tuempresa.cl). Conéctala una vez en Configuración → Integraciones → Correo.
        </Notice>
      )}

      <Card
        title={<span className="inline-flex items-center gap-2"><CalendarClock size={17} aria-hidden />Ronda programada</span>}
        actions={admin && <span data-agent-human><Button size="sm" variant="secondary" onClick={() => setSettings(true)}>{cfg.enabled ? "Cambiar" : "Programar"}</Button></span>}>
        <p className="text-sm text-muted">
          {cfg.enabled
            ? <>NÚCLEO revisa la cobranza <strong className="text-ink">{weekdaysText(cfg.weekdays)}</strong> desde las <strong className="text-ink">{String(cfg.hour).padStart(2, "0")}:00</strong>, mientras el programa está abierto, y {cfg.mode === "enviar" ? <strong className="text-ink">envía los recordatorios solo</strong> : <strong className="text-ink">te avisa para que la revises</strong>}.</>
            : "Sin programar: la ronda se envía cuando tú lo decides, con el botón de abajo."}
          {" "}Se cobra desde {cfg.min_days} {cfg.min_days === 1 ? "día" : "días"} de atraso{cfg.before_days > 0 ? ` y se avisa ${cfg.before_days} días antes del vencimiento` : ""}; al mismo cliente no se le escribe de nuevo antes de {cfg.repeat_days} días.
        </p>
        {round.last.last_run_at && (
          <p className="mt-2 text-[13px] text-muted">Última ronda ({round.last.last_kind}): {new Date(round.last.last_run_at).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })} · {round.last.last_sent} enviados{round.last.last_failed ? ` · ${round.last.last_failed} sin salir` : ""}.</p>
        )}
      </Card>

      {round.items.length === 0 ? (
        <EmptyState icon={BellRing} title="Nadie que cobrar hoy">Cuando un cliente tenga un documento vencido aparece aquí, con lo más atrasado primero.</EmptyState>
      ) : (
        <Card title="La ronda de hoy" actions={<Button icon={Send} onClick={() => setConfirm(true)} disabled={!round.ready || !round.mail_ready}>Enviar {round.ready} {round.ready === 1 ? "recordatorio" : "recordatorios"}</Button>} padded={false}>
          <ul className="divide-y divide-line">
            {round.items.map((it) => (
              <li key={it.customer_uid} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="font-medium text-ink hover:text-accent" onClick={() => navigate(`/clientes/${it.customer_uid}`)}>{it.customer_name}</button>
                    <Badge tone={STATE[it.state].tone}>{STATE[it.state].label}</Badge>
                    {it.max_days_late > 0 && <Badge tone={it.max_days_late > 30 ? "danger" : "warning"}>{late(it.max_days_late)}</Badge>}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {it.email ?? "Sin correo"}{it.last_reminder_at && ` · último recordatorio el ${formatDate(it.last_reminder_at.slice(0, 10))}`}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted">
                    {it.docs.map((d) => (
                      <button key={d.sale_uid} className="hover:text-accent" onClick={() => navigate(`/ventas/${d.sale_uid}`)}>
                        {d.number} · <span className="num">{formatMoney(d.pending_minor)}</span> · {late(d.days_late)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="num text-[15px] font-semibold text-ink">{formatMoney(it.total_minor)}</span>
                  <div className="flex gap-1.5">
                    {it.state !== "excluido" && <Button size="sm" variant="secondary" icon={Mail} onClick={() => setMailing(it.customer_uid)} disabled={!round.mail_ready}>Ver y enviar</Button>}
                    {admin && (
                      <span data-agent-human>
                        <Button size="sm" variant="ghost" icon={it.state === "excluido" ? Mail : UserX} onClick={() => exclude(it, it.state !== "excluido")}>
                          {it.state === "excluido" ? "Volver a incluir" : "No enviarle"}
                        </Button>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Enviar la ronda de cobranza"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button icon={Send} onClick={sendAll} disabled={busy}>{busy ? "Enviando…" : "Enviar ahora"}</Button></>}>
        <p className="text-sm text-ink">
          Se enviará un recordatorio a {round.ready} {round.ready === 1 ? "cliente" : "clientes"}, cada uno con todos sus documentos pendientes, tus datos de transferencia y el enlace de pago con tarjeta.
        </p>
        <ul className="mt-3 max-h-56 overflow-y-auto text-sm text-muted">
          {round.items.filter((i) => i.state === "listo").slice(0, cfg.max_per_run).map((i) => <li key={i.customer_uid} className="flex justify-between gap-3 py-0.5"><span className="truncate">{i.customer_name} · {i.email}</span><span className="num">{formatMoney(i.total_minor)}</span></li>)}
        </ul>
        {round.items.some((i) => i.state === "sin_correo") && <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted"><MailX size={14} aria-hidden />Los clientes sin correo en su ficha quedan fuera: agrégales uno para incluirlos.</p>}
      </Dialog>
      {mailing && <MailComposer kind="cobro" reference={mailing} onClose={() => setMailing(null)} onSent={() => { load(); onChanged(); }} />}
      {settings && <SettingsDialog cfg={cfg} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); load(); }} />}
    </div>
  );
}

function SettingsDialog({ cfg, onClose, onSaved }: { cfg: CollectSettings; onClose: () => void; onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [f, setF] = useState<CollectSettings>(cfg);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const int = (v: string, max: number) => Math.min(max, Number(v.replace(/\D/g, "")) || 0);
  async function save() {
    setBusy(true); setErr(null);
    try { await backend.collectSaveSettings(f); toast("success", f.enabled ? "Ronda de cobranza programada." : "Ajustes de cobranza guardados."); onSaved(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title="Programar la ronda de cobranza"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><span data-agent-human><Button onClick={save} disabled={busy}>Guardar</Button></span></>}>
      <div data-agent-human className="flex flex-col gap-4">
        <Checkbox label="Hacer la ronda sola, los días que elija" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })}
          hint="Funciona mientras NÚCLEO está abierto ese día. Si lo abres más tarde, la ronda se hace al abrirlo." />
        {f.enabled && (
          <>
            <WeekdayPicker label="Días" value={f.weekdays} onChange={(v) => setF({ ...f, weekdays: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Desde qué hora" value={String(f.hour)} onChange={(e) => setF({ ...f, hour: Number(e.target.value) })} options={HOURS} />
              <Field label="Tope de correos por ronda" inputMode="numeric" value={f.max_per_run} onChange={(e) => setF({ ...f, max_per_run: int(e.target.value, 200) })} inputClassName="text-right num" />
            </div>
            <Segmented label="Cuando toca la ronda" value={f.mode} onChange={(m) => setF({ ...f, mode: m })}
              options={[{ value: "avisar", label: "Avisarme y la envío yo" }, { value: "enviar", label: "Enviar los recordatorios solo" }]} />
            {f.mode === "enviar" && <Notice tone="warning">Los correos saldrán a tus clientes sin que los revises uno por uno. Parte con «Avisarme» hasta que la ronda te convenza.</Notice>}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cobrar desde (días de atraso)" inputMode="numeric" value={f.min_days} onChange={(e) => setF({ ...f, min_days: int(e.target.value, 365) })} inputClassName="text-right num" />
          <Field label="Avisar antes de vencer (días)" inputMode="numeric" value={f.before_days} onChange={(e) => setF({ ...f, before_days: int(e.target.value, 60) })} hint="0 = solo lo vencido" inputClassName="text-right num" />
          <Field label="No repetir antes de (días)" inputMode="numeric" value={f.repeat_days} onChange={(e) => setF({ ...f, repeat_days: int(e.target.value, 365) })} inputClassName="text-right num" />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
