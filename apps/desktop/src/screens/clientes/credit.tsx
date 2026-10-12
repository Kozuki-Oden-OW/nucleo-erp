// Ficha de crédito del cliente: estado del cupo, documentos de respaldo (todos opcionales),
// consejos y exportación de la carpeta del cliente.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, FolderOutput, Lightbulb, Paperclip, ShieldCheck } from "lucide-react";
import { useBackend, errorMessage, type CreditDoc, type CreditDocStatus, type CustomerCredit } from "../../data";
import { CREDIT_LINKS, DOC_STATUS_LABEL, creditWarning } from "../../data/credit";
import { formatDate, formatMoney } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Field, Notice, Select, Spinner, TextArea, type Tone } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { AttachDialog } from "../documentos/Documents";

/** Aviso de crédito para una venta a crédito de `total` a este cliente (null si no hay nada que advertir). */
export function useCreditWarning(customerUid: string | null | undefined, total: number, active: boolean): string | null {
  const backend = useBackend();
  const [credit, setCredit] = useState<CustomerCredit | null>(null);
  useEffect(() => {
    let alive = true;
    setCredit(null);
    if (customerUid && active) backend.customerCredit(customerUid).then((c) => alive && setCredit(c)).catch(() => {});
    return () => { alive = false; };
  }, [backend, customerUid, active]);
  return active ? creditWarning(credit, total, formatMoney) : null;
}

const STATUS_TONE: Record<CreditDocStatus, Tone> = { pendiente: "neutral", recibido: "warning", verificado: "success", no_aplica: "neutral" };

export function CreditPanel({ uid, company, onFilesChanged }: { uid: string; company: boolean; onFilesChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [credit, setCredit] = useState<CustomerCredit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const [exporting, setExporting] = useState(false);
  const load = useCallback(() => { backend.customerCredit(uid).then(setCredit).catch((e) => setErr(errorMessage(e))); }, [backend, uid]);
  useEffect(load, [load]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!credit) return <Spinner />;
  const docs = credit.docs.filter((d) => company || !d.company_only);
  const over = credit.available_minor != null && credit.available_minor < 0;

  async function exportFolder() {
    setExporting(true);
    try {
      const r = await backend.exportCustomerFolder(uid);
      if (r) toast("success", `Carpeta lista con ${r.files} ${r.files === 1 ? "archivo" : "archivos"}: ${r.folder}`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setExporting(false); }
  }

  return (
    <section className="rounded-xl border border-line" aria-labelledby="credito-titulo">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 id="credito-titulo" className="text-sm font-semibold text-ink">Crédito</h3>
          {credit.enabled ? <Badge tone="success" icon={CheckCircle2}>Habilitado</Badge> : <Badge>Sin crédito</Badge>}
        </div>
        <Button size="sm" variant="ghost" icon={FolderOutput} onClick={exportFolder} disabled={exporting}
          title="Crea en la carpeta que elijas una carpeta con el nombre del cliente y sus documentos de crédito">
          Exportar carpeta del cliente
        </Button>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {credit.enabled ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Plazo" value={credit.days ? `${credit.days} días` : "—"} />
            <Stat label="Cupo" value={credit.limit_minor != null ? formatMoney(credit.limit_minor) : "Sin cupo"} />
            <Stat label="Deuda" value={formatMoney(credit.debt_minor)} hint={credit.overdue_minor > 0 ? `${formatMoney(credit.overdue_minor)} vencido` : undefined} tone={credit.overdue_minor > 0 ? "danger" : undefined} />
            <Stat label="Disponible" value={credit.available_minor != null ? formatMoney(credit.available_minor) : "—"} tone={over ? "danger" : undefined} />
          </dl>
        ) : (
          <p className="text-sm text-muted">
            Para venderle a crédito con plazo y cupo, habilítalo en <strong className="font-medium text-ink">Editar → Condiciones comerciales</strong>.
            Los respaldos son opcionales: si es un familiar o amigo de confianza, puedes habilitarlo sin documentos.
          </p>
        )}
        {credit.enabled && credit.conditions && <p className="whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-sm">{credit.conditions}</p>}

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h4 className="text-[13px] font-semibold text-ink">Documentos de respaldo</h4>
            <span className="num text-xs text-muted">{credit.docs_ready} de {credit.docs_applicable} recibidos</span>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${credit.docs_applicable ? Math.round((100 * credit.docs_ready) / credit.docs_applicable) : 0}%` }} />
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {docs.map((d) => (
              <DocRow key={d.kind} uid={uid} doc={d} open={open === d.kind} onToggle={() => setOpen(open === d.kind ? null : d.kind)}
                editable={can("clientes.editar")} onSaved={(c, withFile) => { setCredit(c); if (withFile) onFilesChanged(); }} />
            ))}
          </ul>
        </div>

        {credit.advice.length > 0 && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Lightbulb size={14} aria-hidden /> Consejos</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
              {credit.advice.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </div>
        )}

        <div>
          <button type="button" onClick={() => setShowLinks((v) => !v)} aria-expanded={showLinks}
            className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
            <ChevronDown size={14} className={showLinks ? "rotate-180 transition" : "transition"} aria-hidden />
            Dónde conseguir o verificar los documentos
          </button>
          {showLinks && (
            <ul className="mt-2 flex flex-col gap-2">
              {CREDIT_LINKS.map((l) => (
                <li key={l.label} className="flex items-start gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{l.label}</p>
                    <p className="text-xs text-muted">{l.note}</p>
                    <p className="select-all font-mono text-xs text-ink-2">{l.url}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={Copy} onClick={async () => {
                    try { await navigator.clipboard.writeText(l.url); toast("success", "Dirección copiada: pégala en tu navegador."); }
                    catch { toast("danger", "No se pudo copiar; selecciona la dirección y cópiala a mano."); }
                  }}>Copiar</Button>
                </li>
              ))}
              <li className="flex items-start gap-2 text-xs text-muted">
                <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
                NÚCLEO no consulta a terceros por su cuenta. Si pides un informe comercial, hazlo con autorización del cliente.
              </li>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num font-medium ${tone === "danger" ? "text-danger" : "text-ink"}`}>{value}</dd>
      {hint && <dd className="text-xs text-danger">{hint}</dd>}
    </div>
  );
}

function DocRow({ uid, doc, open, onToggle, editable, onSaved }: {
  uid: string; doc: CreditDoc; open: boolean; onToggle: () => void; editable: boolean; onSaved: (c: CustomerCredit, withFile: boolean) => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const [status, setStatus] = useState<CreditDocStatus>(doc.status);
  const [issued, setIssued] = useState(doc.issued_on ?? "");
  const [verified, setVerified] = useState(doc.verified_on ?? "");
  const [note, setNote] = useState(doc.note ?? "");
  const [attaching, setAttaching] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(doc.status); setIssued(doc.issued_on ?? ""); setVerified(doc.verified_on ?? ""); setNote(doc.note ?? ""); }, [doc]);

  async function save(attachment_uid: string | null, nextStatus: CreditDocStatus, withFile = false) {
    setBusy(true);
    try {
      const c = await backend.saveCreditDoc(uid, doc.kind, {
        status: nextStatus, attachment_uid, issued_on: issued || null, verified_on: nextStatus === "verificado" ? verified || null : null, note: note || null,
      });
      onSaved(c, withFile);
      toast("success", withFile ? `«${doc.label}» adjuntado.` : "Documento actualizado.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{doc.label}</span>
          {(doc.file_name || doc.issued_on) && (
            <span className="block truncate text-xs text-muted">
              {[doc.file_name, doc.issued_on && `emitido ${formatDate(doc.issued_on)}`, doc.verified_on && `verificado ${formatDate(doc.verified_on)}`].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        {doc.stale && doc.status !== "no_aplica" && <Badge tone="warning" icon={AlertTriangle}>Antiguo</Badge>}
        <Badge tone={STATUS_TONE[doc.status]}>{DOC_STATUS_LABEL[doc.status]}</Badge>
        <ChevronDown size={15} className={`shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2/50 px-3 py-3">
          <dl className="grid gap-2 text-[13px]">
            <Guide label="Dónde se obtiene" text={doc.source} />
            <Guide label="Cómo verificarlo" text={doc.verify} />
            <Guide label="Qué mirar" text={doc.look_for} />
            {doc.fresh_days > 0 && <Guide label="Vigencia sugerida" text={`Hasta ${doc.fresh_days} días desde su emisión.`} />}
          </dl>
          {doc.attachment_uid && (
            <button type="button" onClick={() => navigate(`/documentos?ver=${doc.attachment_uid}`)} className="flex items-center gap-2 self-start text-sm text-accent hover:underline">
              <Paperclip size={14} aria-hidden /> {doc.file_name ?? "Ver archivo"}
            </button>
          )}
          {editable && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label="Estado" value={status} onChange={(e) => setStatus(e.target.value as CreditDocStatus)}
                  options={(Object.keys(DOC_STATUS_LABEL) as CreditDocStatus[]).map((s) => ({ value: s, label: DOC_STATUS_LABEL[s] }))} />
                <Field label="Fecha del documento" type="date" optional value={issued} onChange={(e) => setIssued(e.target.value)} />
                {status === "verificado" && <Field label="Verificado el" type="date" optional value={verified} onChange={(e) => setVerified(e.target.value)} />}
              </div>
              <TextArea label="Nota" optional rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. código de verificación, quién lo envió, observaciones…" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="secondary" icon={Paperclip} onClick={() => setAttaching(true)} disabled={busy}>{doc.attachment_uid ? "Reemplazar archivo" : "Subir archivo"}</Button>
                <Button size="sm" onClick={() => save(doc.attachment_uid, status)} disabled={busy}>Guardar</Button>
              </div>
              <AttachDialog open={attaching} onClose={() => setAttaching(false)} link={{ entity: "cliente", uid }}
                onDone={(a) => { setAttaching(false); const next = status === "pendiente" ? "recibido" : status; setStatus(next); void save(a.uid, next, true); }} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Guide({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-ink-2">{text}</dd>
    </div>
  );
}
