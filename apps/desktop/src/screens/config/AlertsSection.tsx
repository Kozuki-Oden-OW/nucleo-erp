// Configuración → Alertas: qué avisos aparecen en «Requiere tu atención» y con qué umbrales.
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useBackend, errorMessage, type AlertKind, type AlertSettings } from "../../data";
import { useSession } from "../../lib/session";
import { Button, Card, Checkbox, Field, Notice, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

export const ALERT_LABELS: { kind: AlertKind; label: string; hint: string }[] = [
  { kind: "caja_negativa", label: "La caja proyectada queda en negativo", hint: "Según lo que te deben, lo que debes y los gastos fijos de las próximas 13 semanas." },
  { kind: "cobros_vencidos", label: "Clientes con pagos atrasados", hint: "Ventas a crédito que pasaron su fecha de pago." },
  { kind: "pagos_vencidos", label: "Pagos atrasados", hint: "Compras, gastos o costos de importación que ya vencieron." },
  { kind: "pagos_proximos", label: "Pagos por vencer", hint: "Lo que vence en los próximos días (ajusta cuántos abajo)." },
  { kind: "sin_stock", label: "Productos agotados que se venden", hint: "Sin unidades y con ventas en los últimos 90 días." },
  { kind: "bajo_minimo", label: "Productos por agotarse", hint: "En o bajo el stock mínimo de su ficha." },
  { kind: "margen_bajo", label: "Productos con margen bajo o pérdida", hint: "Vendidos en los últimos 30 días bajo el margen que indiques." },
  { kind: "alza_precios", label: "Proveedores que subieron precios", hint: "La última compra (30 días) costó más que la anterior." },
  { kind: "detenidos", label: "Productos detenidos", hint: "Con stock y sin ventas en los días que indiques." },
  { kind: "clientes_riesgo", label: "Clientes que dejaron de comprar", hint: "Pasó más del doble de su tiempo habitual entre compras." },
  { kind: "importaciones", label: "Importaciones en camino", hint: "Carpetas en curso y su próxima fecha de llegada." },
  { kind: "presupuesto", label: "Gastos sobre el presupuesto", hint: "Categorías de gastos que superan su presupuesto del mes." },
  { kind: "documentar", label: "Ventas pendientes de documentar", hint: "Sin el número de boleta o factura anotado." },
];

export function AlertsSection() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [s, setS] = useState<AlertSettings | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    backend.alertSettings().then((x) => {
      setS(x);
      setText({ idle_days: String(x.idle_days), due_soon_days: String(x.due_soon_days), price_rise_pct: String(x.price_rise_pct), low_margin_pct: String(x.low_margin_pct) });
    }).catch((e) => setErr(errorMessage(e)));
  }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!s) return <Spinner />;

  const toggle = (k: AlertKind, v: boolean) => setS({ ...s, disabled: v ? s.disabled.filter((x) => x !== k) : [...s.disabled, k] });
  async function save() {
    const num = (k: string) => Number((text[k] ?? "").replace(",", "."));
    const next: AlertSettings = { ...s!, idle_days: Math.round(num("idle_days")), due_soon_days: Math.round(num("due_soon_days")), price_rise_pct: Math.round(num("price_rise_pct")), low_margin_pct: Math.round(num("low_margin_pct")) };
    if (Object.values(next).some((v) => typeof v === "number" && Number.isNaN(v))) { toast("danger", "Revisa los números: escribe solo cifras."); return; }
    setBusy(true);
    try { setS(await backend.updateAlertSettings(next)); toast("success", "Reglas de alertas guardadas."); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  const numField = (k: string, label: string, suffix: string, hint: string) => (
    <Field label={label} inputMode="numeric" value={text[k] ?? ""} onChange={(e) => setText({ ...text, [k]: e.target.value })} suffix={suffix} hint={hint} disabled={!editable} />
  );
  return (
    <div className="flex flex-col gap-6">
      <Card title="Qué avisos ver" subtitle="Aparecen en el Inicio y en la campana. Cada aviso explica por qué aparece y lleva al detalle. Cada usuario solo ve lo que sus permisos le permiten.">
        <div className="grid gap-3 md:grid-cols-2">
          {ALERT_LABELS.map((a) => (
            <Checkbox key={a.kind} label={a.label} hint={a.hint} checked={!s.disabled.includes(a.kind)} onChange={(v) => editable && toggle(a.kind, v)} />
          ))}
        </div>
      </Card>
      <Card title="Umbrales">
        <div className="grid gap-4 sm:grid-cols-2">
          {numField("idle_days", "Producto detenido después de", "días", "Sin ventas y con stock (entre 15 y 730).")}
          {numField("due_soon_days", "Avisar pagos con", "días de anticipación", "Entre 1 y 60.")}
          {numField("price_rise_pct", "Avisar alzas de precio desde", "%", "Comparando la última compra con la anterior.")}
          {numField("low_margin_pct", "Margen bajo si deja menos de", "%", "Margen sobre la venta neta.")}
        </div>
      </Card>
      {editable
        ? <div><Button icon={Save} onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar reglas"}</Button></div>
        : <p className="text-sm text-muted">Solo el dueño o un administrador cambia estas reglas.</p>}
    </div>
  );
}
