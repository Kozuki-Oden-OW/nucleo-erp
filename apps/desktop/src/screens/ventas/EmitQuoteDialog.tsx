// «Emitir documento»: convierte la cotización en un PDF con la plantilla del negocio y lo guarda en
// la carpeta de cotizaciones (en la demostración se descarga). No cambia la cotización ni mueve
// stock o dinero; se puede volver a emitir después de editarla.
import { useEffect, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Check, FileDown, FolderOpen } from "lucide-react";
import { errorMessage, useBackend, type BusinessSettings, type CustomerDetail, type QuoteDetail, type QuoteDocSettings, type QuoteEmitted, type QuoteTemplate, type QuoteTerms } from "../../data";
import { buildQuotePdf, QUOTE_TEMPLATES, quoteFileName } from "../../lib/quotePdf";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, Field, Notice, Spinner, cx } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

export function EmitQuoteDialog({ open, onClose, quote, biz }: { open: boolean; onClose: () => void; quote: QuoteDetail; biz: BusinessSettings | null }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const desktop = backend.kind === "tauri";
  const [settings, setSettings] = useState<QuoteDocSettings | null>(null);
  const [terms, setTerms] = useState<QuoteTerms | null>(null);
  const [template, setTemplate] = useState<QuoteTemplate>("clasica");
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<QuoteEmitted | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setErr(null);
    let alive = true;
    (async () => {
      try {
        const [s, t, c] = await Promise.all([
          backend.quoteDocSettings(), backend.quoteTerms(quote.uid),
          quote.customer_uid ? backend.customer(quote.customer_uid).catch(() => null) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setSettings(s); setTerms(t); setTemplate(s.template); setCustomer(c);
      } catch (e) { if (alive) setErr(errorMessage(e)); }
    })();
    return () => { alive = false; };
  }, [open, backend, quote.uid, quote.customer_uid]);

  const chooseFolder = async () => {
    if (!settings) return;
    try {
      const dir = await pickFolder({ directory: true, multiple: false, title: "Carpeta para guardar las cotizaciones" });
      if (typeof dir !== "string" || !dir) return;
      setSettings(await backend.saveQuoteDocSettings({ ...settings, folder: dir }));
    } catch (e) { toast("danger", errorMessage(e)); }
  };

  const emit = async () => {
    if (!settings || !terms || !biz) return;
    setBusy(true);
    setErr(null);
    try {
      const saved = await backend.saveQuoteTerms(quote.uid, terms);
      const pdf = buildQuotePdf({ quote, biz, customer, settings, terms: saved, template });
      const r = await backend.saveQuotePdf(quote.uid, quoteFileName(quote), pdf);
      setDone(r);
      toast("success", desktop ? `${quote.number} guardada como PDF en ${r.folder}.` : `${quote.number} descargada como PDF.`);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  const needsFolder = desktop && settings && !settings.folder;
  const set = (patch: Partial<QuoteTerms>) => setTerms((t) => t && { ...t, ...patch });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Emitir ${quote.number}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{done ? "Cerrar" : "Cancelar"}</Button>
        <Button icon={FileDown} onClick={emit} disabled={busy || !settings || !terms || !biz || !!needsFolder}>{busy ? "Creando el PDF…" : done ? "Emitir de nuevo" : desktop ? "Emitir y guardar PDF" : "Emitir y descargar PDF"}</Button>
      </>}
    >
      {!settings || !terms ? (err ? <Notice tone="danger">{err}</Notice> : <Spinner />) : (
        <div className="flex flex-col gap-4">
          {done && (
            <Notice tone="success" title="PDF creado">
              {desktop ? <>Quedó guardado como <strong className="break-all">{done.path}</strong>. Adjúntalo al correo o al mensaje para tu cliente.</> : <>Se descargó como <strong>{done.file_name}</strong>.</>}
            </Notice>
          )}
          {err && <Notice tone="danger">{err}</Notice>}
          <div>
            <p className="mb-2 text-sm font-medium">Plantilla</p>
            <div className="grid grid-cols-2 gap-2">
              {QUOTE_TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => setTemplate(t.id)} aria-pressed={template === t.id}
                  className={cx("flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left", template === t.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">{template === t.id && <Check size={14} className="text-accent" />}{t.name}</span>
                  <span className="text-xs text-muted">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Plazo de entrega" value={terms.delivery} onChange={(e) => set({ delivery: e.target.value })} placeholder="2 días hábiles" />
            <Field label="Garantía" value={terms.warranty} onChange={(e) => set({ warranty: e.target.value })} placeholder="6 meses" />
            <Field label="Forma de pago" value={terms.payment} onChange={(e) => set({ payment: e.target.value })} placeholder="Contado" />
          </div>
          {desktop && (settings.folder
            ? <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><FolderOpen size={15} /> Se guarda en <strong className="break-all text-ink">{settings.folder}</strong></p>
            : <Notice tone="warning" title="Falta elegir dónde guardar las cotizaciones" actions={can("config.editar") ? <Button size="sm" icon={FolderOpen} onClick={chooseFolder}>Elegir carpeta</Button> : undefined}>
                Se elige una sola vez; después cada cotización emitida queda ahí con su número y el nombre del cliente.
              </Notice>)}
          <p className="text-xs text-muted">
            El logo, los datos de transferencia y la plantilla habitual se cambian en{" "}
            <button type="button" className="underline hover:text-ink" onClick={() => { onClose(); navigate("/config/cotizaciones"); }}>Configuración → Cotizaciones</button>.
          </p>
        </div>
      )}
    </Dialog>
  );
}
