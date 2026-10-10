// Logo del negocio: se muestra en el menú y en los documentos imprimibles (cotizaciones, ventas,
// órdenes de compra y, más adelante, liquidaciones de sueldo). Se reduce en el computador antes de
// guardarse, para que pese poco.
import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings } from "../../data";
import { Button, Card } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

const MAX_W = 600, MAX_H = 300;
/** Evento para que el menú vuelva a leer el logo. */
export const LOGO_EVENT = "nucleo:logo";

/** Lee la imagen y la reduce (sin agrandarla) a un máximo de 600 × 300 px, en PNG si tiene transparencia. */
async function shrink(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Usa una imagen PNG, JPG o WebP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("La imagen es demasiado grande (máximo 15 MB).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("No se pudo leer la imagen."));
      i.src = url;
    });
    const k = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen.");
    ctx.drawImage(img, 0, 0, w, h);
    const png = c.toDataURL("image/png");
    // Si el PNG queda pesado (fotos), se usa JPEG sobre fondo blanco.
    if (png.length < 400_000) return png;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function LogoCard({ biz, onChange, editable }: { biz: BusinessSettings; onChange: (b: BusinessSettings) => void; editable: boolean }) {
  const backend = useBackend();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await shrink(f);
      onChange(await backend.setBusinessLogo(data));
      window.dispatchEvent(new Event(LOGO_EVENT));
      toast("success", "Logo guardado: ya aparece en el menú y en tus documentos.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove() {
    setBusy(true);
    try { onChange(await backend.setBusinessLogo(null)); window.dispatchEvent(new Event(LOGO_EVENT)); toast("success", "Logo quitado."); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card title="Logo" subtitle="Aparece en el menú y en tus cotizaciones, comprobantes de venta y órdenes de compra (y en las liquidaciones de sueldo cuando estén disponibles).">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-28 w-56 items-center justify-center rounded-lg border border-dashed border-line-strong bg-white p-3">
          {biz.logo ? <img src={biz.logo} alt={`Logo de ${biz.name}`} className="max-h-full max-w-full object-contain" />
            : <span className="text-center text-xs text-muted">Sin logo</span>}
        </div>
        {editable && (
          <div className="flex flex-col gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Archivo del logo" onChange={(e) => pick(e.target.files?.[0])} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={ImageUp} disabled={busy} onClick={() => input.current?.click()}>{biz.logo ? "Cambiar logo" : "Subir logo"}</Button>
              {biz.logo && <Button variant="ghost" icon={Trash2} disabled={busy} onClick={remove}>Quitar</Button>}
            </div>
            <p className="max-w-xs text-xs text-muted">PNG, JPG o WebP. Mejor un logo horizontal con fondo transparente; se ajusta solo.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
