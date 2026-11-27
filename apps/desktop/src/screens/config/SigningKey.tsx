// Configuración → Integraciones → Accesos: la clave de firma de documentos del SII (la del certificado
// que el SII pide en «Firma de documento tributario electrónico»). La escribe y la borra solo la
// persona; no se muestra, no sirve para iniciar sesión y NÚCLEO la usa únicamente en la página de
// firma, con la aprobación de la persona para cada documento (docs/DECISIONS.md, D-NAV-08).
import { useCallback, useEffect, useState } from "react";
import { FileSignature, ShieldCheck } from "lucide-react";
import { errorMessage, useBackend, type SigningKeyStatus } from "../../data";
import { Badge, Button, Checkbox, Field, Notice } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

export function SigningKeyBox({ editable }: { editable: boolean }) {
  const backend = useBackend();
  const toast = useToast();
  const [status, setStatus] = useState<SigningKeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await backend.signingKeyStatus()); } catch { /* sin permiso para verla: no se muestra */ }
  }, [backend]);
  useEffect(() => { void load(); }, [load]);
  if (!status) return null;

  const save = async () => {
    setBusy(true);
    try {
      setStatus(await backend.saveSigningKey(key, declared));
      setKey("");
      setDeclared(false);
      toast("success", "Clave de firma guardada. Quedó cifrada y no se vuelve a mostrar.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      setStatus(await backend.deleteSigningKey());
      setRemoving(false);
      toast("success", "Se borró la clave de firma de NÚCLEO.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const when = status.updated_at ? status.updated_at.slice(0, 10).split("-").reverse().join("-") : "";

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line p-4" aria-label="Clave de firma de documentos del SII">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-ink"><FileSignature size={16} aria-hidden /> Clave de firma de documentos (SII)</h4>
        {status.saved
          ? <Badge tone="success" icon={ShieldCheck}>Guardada{when ? ` el ${when}` : ""}</Badge>
          : <Badge>Sin guardar</Badge>}
      </div>
      <p className="text-sm text-muted">
        Es la clave que el SII pide en «Firma de documento tributario electrónico» al emitir una factura, una guía o una nota. NÚCLEO la escribe{" "}
        <strong>solo en esa página</strong> y solo cuando tú apruebas ese documento: aparece un aviso de NÚCLEO con el cliente y el total, y con tu clic firma.
        Un clic por documento. No sirve para iniciar sesión y Claude no la ve ni puede aprobar la firma.
      </p>
      {editable ? (
        // Todo este bloque es de la persona: Claude no escribe la clave, no marca la casilla ni guarda.
        <div data-agent-human className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Field label={status.saved ? "Cambiar la clave de firma" : "Clave de firma"} type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="new-password"
              placeholder={status.saved ? "Guardada (escribe para cambiarla)" : ""} hint="Escríbela tú aquí; no la envíes por chat." />
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={busy || !key || !declared}>{busy ? "Guardando…" : "Guardar clave"}</Button>
              {status.saved && <Button variant="ghost" onClick={() => setRemoving(true)} disabled={busy}>Borrar</Button>}
            </div>
          </div>
          <Checkbox label="Es la clave con que firmo documentos en el SII y autorizo a NÚCLEO a usarla solo en la página de firma, con mi aprobación por cada documento."
            checked={declared} onChange={setDeclared} hint="Emitir un documento no se puede deshacer: por eso NÚCLEO te pregunta cada vez." />
        </div>
      ) : (
        <Notice tone="info">La guarda quien administra NÚCLEO.</Notice>
      )}

      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        size="sm"
        title="Borrar la clave de firma"
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(false)}>Cancelar</Button>
          <span data-agent-human><Button variant="danger" onClick={() => void remove()} disabled={busy}>Borrar la clave</Button></span>
        </>}
      >
        <p className="text-sm">NÚCLEO deja de tener tu clave de firma: para firmar la escribes tú en la página del SII. Tu certificado no cambia.</p>
      </Dialog>
    </section>
  );
}
