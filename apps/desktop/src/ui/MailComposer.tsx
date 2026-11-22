// Redactar y enviar un correo desde la casilla de la empresa: NÚCLEO arma el borrador con la plantilla
// (aviso de despacho, recordatorio de cobro o promoción) y la persona lo revisa antes de enviarlo.
import { useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { errorMessage, useBackend, type MailDraft } from "../data";
import { navigate } from "../lib/router";
import { Button, Field, Notice, Spinner, TextArea } from "./kit";
import { Dialog, useToast } from "./overlay";

const TITLES = { envio: "Avisar el despacho", cobro: "Recordatorio de cobro", promocion: "Enviar promoción" } as const;

export function MailComposer({ kind, reference, onClose, onSent }: {
  kind: keyof typeof TITLES;
  /** Envío: uid del envío. Cobro o promoción: uid del cliente. */
  reference: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [configured, setConfigured] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const st = await backend.mailStatus();
        if (!live) return;
        setConfigured(st.configured);
        if (st.configured) setDraft(await backend.mailDraft(kind, reference));
      } catch (e) { if (live) setErr(errorMessage(e)); }
    })();
    return () => { live = false; };
  }, [backend, kind, reference]);

  const send = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await backend.mailSend(draft);
      toast("success", `Correo enviado a ${r.to_addr}.`);
      onSent?.();
      onClose();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={<span className="inline-flex items-center gap-2"><Mail size={18} aria-hidden />{TITLES[kind]}</span>}
      footer={draft && <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Send} onClick={send} disabled={busy || !draft.to.trim()}>{busy ? "Enviando…" : "Enviar"}</Button></>}>
      {err ? <Notice tone="warning">{err}</Notice>
        : !configured ? (
          <Notice tone="info" title="Falta conectar el correo de la empresa"
            actions={<Button size="sm" onClick={() => { onClose(); navigate("/config/integraciones"); }}>Ir a Integraciones</Button>}>
            NÚCLEO envía los correos desde tu casilla (por ejemplo ventas@tuempresa.cl). Configúrala una vez en Configuración → Integraciones → Correo.
          </Notice>
        ) : !draft ? <Spinner />
        : (
          <div className="flex flex-col gap-3">
            <Field label="Para" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              hint={draft.to ? "Puedes agregar más direcciones separadas por coma." : "El cliente no tiene correo en su ficha: escríbelo aquí."} />
            <Field label="Asunto" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            <TextArea label="Mensaje" rows={14} style={{ height: "18rem" }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <p className="text-xs text-muted">Revisa el texto: se envía tal cual desde la casilla de la empresa y queda registrado en la ficha del cliente.</p>
          </div>
        )}
    </Dialog>
  );
}
