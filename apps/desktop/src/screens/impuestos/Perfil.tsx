// Configuración tributaria de la empresa: régimen, tasa de PPM, vencimiento y criterios del F29.
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useBackend, errorMessage, type TaxProfile, type TaxRegime } from "../../data";
import { useSession } from "../../lib/session";
import { Button, Card, Field, Notice, Select, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { PercentField } from "../comex/common";

export const REGIME_LABEL: Record<TaxRegime, string> = {
  "14d3": "Pro Pyme general (art. 14 letra D N°3)",
  "14d8": "Pro Pyme transparente (art. 14 letra D N°8)",
  "14a": "Régimen general (art. 14 letra A)",
};

export function PerfilTab({ onSaved }: { onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [p, setP] = useState<TaxProfile | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.taxProfile().then(setP).catch((e) => toast("danger", errorMessage(e))); }, [backend, toast]);
  if (!p) return <Spinner />;
  const edit = can("contabilidad.editar");
  async function save() {
    if (!p) return;
    setBusy(true);
    try { setP(await backend.saveTaxProfile(p)); toast("success", "Configuración tributaria guardada."); onSaved(); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="grid max-w-4xl gap-6">
      <Card title="Tu empresa ante el SII" subtitle="Se ingresa una vez. Lo ves en sii.cl → Mi SII → Datos personales y tributarios, o te lo indica tu contador."
        actions={edit && <Button size="sm" icon={Save} onClick={save} disabled={busy}>Guardar</Button>}>
        <fieldset disabled={!edit} className="grid gap-4 md:grid-cols-2">
          <Select label="Régimen tributario" value={p.regime} onChange={(e) => setP({ ...p, regime: e.target.value as TaxRegime })}
            options={(Object.keys(REGIME_LABEL) as TaxRegime[]).map((r) => ({ value: r, label: REGIME_LABEL[r] }))}
            hint="Define cómo se preparará la renta anual (F22)" />
          <PercentField label="Tasa de PPM de la empresa" ppm={p.ppm_rate_ppm} onPpm={(v) => setP({ ...p, ppm_rate_ppm: v })} optional
            hint="La que te asignó el SII (aparece en tu propuesta de F29) o te indica tu contador" />
          <Field label="Día de vencimiento del F29" inputMode="numeric" optional value={p.due_day ?? ""} hint="Del mes siguiente; depende de cómo declaras (pregúntale a tu contador)"
            onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, "")); setP({ ...p, due_day: v >= 1 && v <= 28 ? v : null }); }} />
          <Select label="Reajuste del remanente: decimales de UTM" value={p.utm_decimals === null ? "" : String(p.utm_decimals)}
            onChange={(e) => setP({ ...p, utm_decimals: e.target.value === "" ? null : Number(e.target.value) })}
            options={[{ value: "", label: "Sin redondeo intermedio" }, ...[0, 2, 4].map((d) => ({ value: String(d), label: `${d} decimales` }))]}
            hint="Cómo convierte tu contador el remanente a UTM" />
          <PercentField label="Proporción del IVA de uso común" ppm={p.common_use_ppm} onPpm={(v) => setP({ ...p, common_use_ppm: v })} optional
            hint="Solo si tienes ventas afectas y exentas a la vez: la define tu contador" />
        </fieldset>
      </Card>
      <Notice tone="info" title="Qué viene">
        Con tu régimen, NÚCLEO preparará la renta anual (Formulario 22) desde lo cobrado y lo pagado en el año, y la liquidación del sueldo empresarial con sus cotizaciones,
        cuyo impuesto único pasa directo al código 48 del F29.
      </Notice>
    </div>
  );
}
