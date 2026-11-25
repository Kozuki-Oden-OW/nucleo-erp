// Configuración → Cotizaciones: cómo se ve el documento que recibe el cliente (plantilla y logo), las
// condiciones habituales, los datos de transferencia y la carpeta donde se guardan los PDF emitidos.
import { useEffect, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, Pipette, Save } from "lucide-react";
import { errorMessage, useBackend, type BusinessSettings, type QuoteDocSettings, type QuoteNumbering, type QuoteTemplate } from "../../data";
import { logoPalette } from "../../lib/logoColors";
import { QUOTE_TEMPLATES } from "../../lib/quotePdf";
import { useSession } from "../../lib/session";
import { Button, Card, Checkbox, Field, Notice, Spinner, TextArea, cx } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { LogoCard } from "./LogoCard";

/** Miniatura de cada plantilla, dibujada con bloques: da la idea de la distribución. */
function Thumb({ id }: { id: QuoteTemplate }) {
  const bar = "rounded-sm bg-current";
  return (
    <span aria-hidden className="relative flex h-24 w-full flex-col gap-1 overflow-hidden rounded-md border border-line bg-white p-2 text-slate-300">
      {id === "elegante" && <span className="absolute inset-y-0 left-0 w-1.5 bg-accent" />}
      {id === "moderna" ? <span className="-mx-2 -mt-2 mb-1 h-6 bg-accent" /> : (
        <span className="flex items-start justify-between">
          <span className={cx(bar, "h-3 w-8", id === "compacta" ? "text-slate-500" : "text-slate-400")} />
          <span className={cx("h-2 w-10 rounded-sm", id === "compacta" ? "bg-slate-700" : "bg-accent")} />
        </span>
      )}
      {id === "moderna" && <span className="flex gap-1"><span className="h-4 flex-1 rounded-sm bg-accent-soft" /><span className="h-4 flex-1 rounded-sm bg-accent-soft" /></span>}
      <span className={cx("h-1.5 w-full rounded-sm", id === "compacta" ? "bg-slate-400" : id === "elegante" ? "bg-slate-200" : "bg-accent")} />
      {[0, 1, 2].map((i) => <span key={i} className={cx("h-1 w-full rounded-sm", id === "moderna" && i % 2 === 0 ? "bg-accent-soft" : "bg-slate-200")} />)}
      <span className="mt-auto flex justify-end"><span className={cx("h-3 rounded-sm", id === "compacta" ? "w-8 bg-slate-700" : id === "elegante" ? "w-14 bg-accent" : "w-10 bg-accent")} /></span>
    </span>
  );
}

export function QuoteDocSection({ onChanged }: { onChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const desktop = backend.kind === "tauri";
  const [s, setS] = useState<QuoteDocSettings | null>(null);
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [num, setNum] = useState<QuoteNumbering | null>(null);

  useEffect(() => {
    Promise.all([backend.quoteDocSettings(), backend.business()]).then(([q, b]) => { setS(q); setBiz(b); }).catch((e) => setErr(errorMessage(e)));
    backend.quoteNumbering().then(setNum).catch(() => setNum(null));
  }, [backend]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!s || !biz) return <Spinner />;

  const set = (patch: Partial<QuoteDocSettings>) => setS((v) => v && { ...v, ...patch });
  const terms = (patch: Partial<QuoteDocSettings["terms"]>) => setS((v) => v && { ...v, terms: { ...v.terms, ...patch } });
  const bank = (patch: Partial<QuoteDocSettings["bank"]>) => setS((v) => v && { ...v, bank: { ...v.bank, ...patch } });
  const card = (patch: Partial<QuoteDocSettings["card"]>) => setS((v) => v && { ...v, card: { ...v.card, ...patch } });
  const colors = (patch: Partial<QuoteDocSettings["colors"]>) => setS((v) => v && { ...v, colors: { ...v.colors, ...patch } });
  const fromLogo = async () => {
    if (!biz.logo) { toast("warning", "Primero sube el logo: los colores se toman de él."); return; }
    try {
      const p = await logoPalette(biz.logo);
      if (!p) { toast("warning", "El logo no tiene colores (es blanco, negro o gris). Elige los colores a mano."); return; }
      colors({ primary: p.primary, secondary: p.secondary ?? "" });
      toast("success", p.secondary ? "Colores tomados del logo. Guarda los ajustes para usarlos." : "El logo tiene un solo color: quedó como principal. Guarda los ajustes para usarlo.");
    } catch (e) { toast("danger", errorMessage(e)); }
  };
  const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c.trim());
  const choose = async () => {
    try {
      const dir = await pickFolder({ directory: true, multiple: false, title: "Carpeta para guardar las cotizaciones" });
      if (typeof dir === "string" && dir) set({ folder: dir });
    } catch (e) { toast("danger", errorMessage(e)); }
  };
  const save = async () => {
    setBusy(true);
    try {
      setS(await backend.saveQuoteDocSettings(s));
      backend.quoteNumbering().then(setNum).catch(() => setNum(null));
      toast("success", "Ajustes de cotizaciones guardados.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card title="Plantilla de la cotización" subtitle="Así se ve el PDF que recibe tu cliente. Puedes elegir otra al emitir cada cotización.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {QUOTE_TEMPLATES.map((t) => (
            <button key={t.id} type="button" disabled={!editable} onClick={() => set({ template: t.id })} aria-pressed={s.template === t.id}
              className={cx("flex flex-col gap-2 rounded-xl border p-3 text-left", s.template === t.id ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2")}>
              <Thumb id={t.id} />
              <span className="flex items-center gap-1.5 text-sm font-semibold">{s.template === t.id && <Check size={14} className="text-accent" />}{t.name}</span>
              <span className="text-xs text-muted">{t.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div>
            <p className="text-sm font-semibold">Colores del documento</p>
            <p className="text-xs text-muted">El principal va en títulos, encabezado de la tabla y total; el secundario, en líneas y en el botón de pago. Si los dejas vacíos se usa el color del negocio. «Compacta» va siempre en blanco y negro.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {([["primary", "Color principal", "#0a51a4"], ["secondary", "Color secundario", "#fdc701"]] as const).map(([key, label, sample]) => (
              <div key={key} className="flex items-end gap-2">
                <span aria-hidden className="mb-1 h-8 w-8 shrink-0 rounded-md border border-line-strong" style={{ background: isHex(s.colors[key]) ? s.colors[key] : "transparent" }} />
                <div className="w-36"><Field label={label} value={s.colors[key]} onChange={(e) => colors({ [key]: e.target.value })} placeholder={sample} disabled={!editable} autoComplete="off" /></div>
              </div>
            ))}
            {editable && <Button variant="secondary" icon={Pipette} onClick={fromLogo}>Tomar los colores del logo</Button>}
            {editable && (s.colors.primary || s.colors.secondary) && <Button variant="ghost" onClick={() => colors({ primary: "", secondary: "" })}>Usar el color del negocio</Button>}
          </div>
          <Checkbox label="Escribir el nombre del negocio bajo el logo" checked={s.show_name} onChange={(v) => { if (editable) set({ show_name: v }); }}
            hint="Desmarcado, bajo el logo van solo tus datos en letra chica: RUT, giro, dirección, teléfono y correo (los de Configuración → Mi negocio). Sin logo, el nombre va siempre." />
        </div>
      </Card>

      <LogoCard biz={biz} editable={editable} onChange={(nb) => { setBiz({ ...biz, logo: nb.logo }); onChanged(); }} />

      <Card title="Dónde se guardan" subtitle="Cada cotización emitida queda como PDF en esta carpeta, con su número y el nombre del cliente.">
        {desktop ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Field label="Carpeta de cotizaciones" value={s.folder ?? ""} onChange={(e) => set({ folder: e.target.value || null })} placeholder="D:\Mi empresa\Cotizaciones" disabled={!editable} hint="Si la carpeta no existe, NÚCLEO la crea al emitir la primera cotización." />
            </div>
            {editable && <Button variant="secondary" icon={FolderOpen} onClick={choose}>Elegir carpeta</Button>}
          </div>
        ) : <Notice tone="info">En la demostración el PDF se descarga con el navegador. En el programa de escritorio eliges aquí la carpeta.</Notice>}
        <div className="mt-4 flex flex-col gap-2">
          <Checkbox label="Seguir la numeración de los archivos de esta carpeta" checked={s.follow_folder} onChange={(v) => { if (editable) set({ follow_folder: v }); }}
            hint="Antes de numerar una cotización nueva, NÚCLEO mira la carpeta y continúa después del número más alto que encuentre (por ejemplo, después de COT-1523.pdf viene la 1524). Sirve si también haces cotizaciones fuera de NÚCLEO." />
          {num && (
            <p className="text-sm" aria-live="polite">
              La próxima cotización será la <strong>{num.next_label}</strong>
              {num.folder_last != null ? <span className="text-muted"> · el número más alto en la carpeta es el {num.folder_last}</span>
                : s.follow_folder && s.folder ? <span className="text-muted"> · en la carpeta no hay cotizaciones con el prefijo {num.prefix}, o no se pudo leer</span> : null}
              <span className="block text-xs text-muted">El prefijo y el largo del número se cambian en Configuración → Numeración.</span>
            </p>
          )}
        </div>
      </Card>

      <Card title="Condiciones habituales" subtitle="Se proponen en cada cotización y se pueden cambiar al emitirla.">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Plazo de entrega" value={s.terms.delivery} onChange={(e) => terms({ delivery: e.target.value })} placeholder="2 días hábiles" disabled={!editable} />
            <Field label="Garantía" value={s.terms.warranty} onChange={(e) => terms({ warranty: e.target.value })} placeholder="6 meses" disabled={!editable} />
            <Field label="Forma de pago" value={s.terms.payment} onChange={(e) => terms({ payment: e.target.value })} placeholder="Contado" disabled={!editable} />
          </div>
          <TextArea label="Línea de contacto" optional rows={2} value={s.contact_note} onChange={(e) => set({ contact_note: e.target.value })} disabled={!editable}
            placeholder="Si tiene alguna pregunta acerca de esta cotización, póngase en contacto con…" />
          <Field label="Frase de cierre" value={s.footer} onChange={(e) => set({ footer: e.target.value })} placeholder="Gracias por confiar en nosotros" disabled={!editable} />
        </div>
      </Card>

      <Card title="Datos de transferencia" subtitle="Para que el cliente pague. Son los datos de la cuenta de tu empresa; quedan guardados solo en tu computador.">
        <div className="flex flex-col gap-3">
          <Checkbox label="Mostrar los datos de transferencia en la cotización" checked={s.bank.show} onChange={(v) => { if (editable) bank({ show: v }); }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Razón social" value={s.bank.holder} onChange={(e) => bank({ holder: e.target.value })} disabled={!editable} />
            <Field label="RUT" value={s.bank.rut} onChange={(e) => bank({ rut: e.target.value })} disabled={!editable} />
            <Field label="Banco" value={s.bank.bank} onChange={(e) => bank({ bank: e.target.value })} disabled={!editable} />
            <Field label="Tipo de cuenta" value={s.bank.account_type} onChange={(e) => bank({ account_type: e.target.value })} placeholder="Cuenta corriente" disabled={!editable} />
            <Field label="Número de cuenta" value={s.bank.account} onChange={(e) => bank({ account: e.target.value })} disabled={!editable} autoComplete="off" />
            <Field label="Correo para el comprobante" value={s.bank.email} onChange={(e) => bank({ email: e.target.value })} disabled={!editable} />
          </div>
        </div>
      </Card>

      <Card title="Pago con tarjeta" subtitle="Si tu cliente prefiere pagar con tarjeta: pega aquí tu enlace de pago (por ejemplo, el de Webpay) y la cotización lleva un botón que lo abre.">
        <div className="flex flex-col gap-3">
          <Checkbox label="Mostrar el botón de pago con tarjeta en la cotización" checked={s.card.show} onChange={(v) => { if (editable) card({ show: v }); }} />
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Enlace de pago" value={s.card.url} onChange={(e) => card({ url: e.target.value })} placeholder="https://www.webpay.cl/company/…" disabled={!editable} autoComplete="off"
              hint="La dirección completa, con https://. NÚCLEO no cobra ni ve el pago: el botón solo abre esa página." />
            <Field label="Texto del botón" value={s.card.label} onChange={(e) => card({ label: e.target.value })} placeholder="Pagar con tarjeta (Webpay)" disabled={!editable} />
          </div>
        </div>
      </Card>

      {editable && <div className="flex justify-end"><Button icon={Save} onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar ajustes de cotizaciones"}</Button></div>}
    </div>
  );
}
