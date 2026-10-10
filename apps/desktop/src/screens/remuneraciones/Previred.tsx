// Previred y Libro de Remuneraciones Electrónico del mes: cuánto pagar a cada institución, el archivo
// para la Dirección del Trabajo y los datos del empleador que ambos necesitan.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Save } from "lucide-react";
import { useBackend, errorMessage, type LreExport, type PayrollSettings, type PreviredView } from "../../data";
import { CCAF_NAMES, MUTUAL_NAMES, REGIONS } from "../../data/lre";
import { formatDate, formatMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Button, Card, EmptyState, Notice, Select, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { ScaledField, periodLabel } from "./common";

export function PreviredTab({ period }: { period: string }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [view, setView] = useState<PreviredView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lre, setLre] = useState<LreExport | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setErr(null); backend.previred(period).then(setView).catch((e) => setErr(errorMessage(e))); }, [backend, period]);
  useEffect(() => { setView(null); setLre(null); load(); }, [load]);

  async function exportLre() {
    setBusy(true);
    try {
      const e = await backend.exportLre(period);
      if (e) { setLre(e); toast("success", `Libro guardado: ${e.file_name}. Súbelo en dt.gob.cl → Libro de Remuneraciones Electrónico.`); }
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view) return <Spinner />;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {view.notes.map((n) => <Notice key={n.text} tone={n.severity === "falta" ? "danger" : "warning"}>{n.text}</Notice>)}
      {view.payslips === 0 ? (
        <EmptyState icon={FileSpreadsheet} title={`No hay liquidaciones emitidas en ${periodLabel(period)}`}>
          Cuando emitas las liquidaciones del mes, aquí verás cuánto pagar en Previred a cada institución y podrás generar el Libro de Remuneraciones.
        </EmptyState>
      ) : (
        <Card padded={false} title={`Para pagar en Previred · ${periodLabel(period)}`}
          subtitle={`${view.payslips} liquidación(es) emitida(s)${view.due_date ? ` · vence el ${formatDate(view.due_date)}` : ""}. Ingresa a previred.com con tu clave y declara estos montos; NÚCLEO no se conecta a Previred.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Institución</th>
                  <th className="px-3 py-2 text-right font-medium">Del trabajador</th>
                  <th className="px-3 py-2 text-right font-medium">Del empleador</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.institution} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5 text-ink">{r.institution}</td>
                    <td className="num px-3 py-2.5 text-right">{r.worker ? formatMoney(r.worker) : "—"}</td>
                    <td className="num px-3 py-2.5 text-right">{r.employer ? (r.employer < 0 ? `−${formatMoney(-r.employer)}` : formatMoney(r.employer)) : "—"}</td>
                    <td className="num px-5 py-2.5 text-right font-medium">{r.total < 0 ? `−${formatMoney(-r.total)}` : formatMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line text-[15px] font-semibold">
                  <td className="px-5 py-3" colSpan={3}>Total a pagar en Previred</td>
                  <td className="num px-5 py-3 text-right">{formatMoney(view.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Card title="Libro de Remuneraciones Electrónico" subtitle="Archivo mensual para la Dirección del Trabajo (incluye el sueldo empresarial, código 2161). Se sube en dt.gob.cl dentro de los primeros días del mes siguiente."
        actions={<Button icon={Download} disabled={busy || view.payslips === 0} onClick={exportLre}>Generar archivo</Button>}>
        {lre ? (
          <div className="flex flex-col gap-3 text-sm">
            <p><strong>{lre.file_name}</strong> · {lre.rows} fila(s) · formato {lre.format}</p>
            {lre.warnings.length > 0 && (
              <Notice tone="warning" icon={AlertTriangle} title="Revisa antes de subirlo">
                <ul className="list-disc pl-5">{lre.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Notice>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Usa las liquidaciones emitidas del mes. Antes de la primera carga, compara los encabezados con la planilla vigente que publica la DT.</p>
        )}
      </Card>

      {can("remuneraciones.ver") && <EmployerCard />}
    </div>
  );
}

function EmployerCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [s, setS] = useState<PayrollSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.payrollSettings().then(setS).catch(() => {}); }, [backend]);
  if (!s) return null;
  const edit = can("remuneraciones.editar");
  async function save() {
    setBusy(true);
    try { setS(await backend.savePayrollSettings(s!)); toast("success", "Datos del empleador guardados."); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card title="Datos del empleador" subtitle="Se ingresan una vez; los usan Previred y el Libro de Remuneraciones"
      actions={edit && <Button size="sm" variant="secondary" icon={Save} disabled={busy} onClick={save}>Guardar</Button>}>
      <fieldset disabled={!edit} className="grid gap-4 md:grid-cols-2">
        <Select label="Caja de compensación" value={String(s.ccaf)} onChange={(e) => setS({ ...s, ccaf: Number(e.target.value) })}
          options={CCAF_NAMES.map((n, i) => ({ value: String(i), label: n }))} />
        <Select label="Seguro de accidentes del trabajo" value={s.mutual == null ? "" : String(s.mutual)} onChange={(e) => setS({ ...s, mutual: e.target.value === "" ? null : Number(e.target.value) })}
          options={[{ value: "", label: "Elegir…" }, ...MUTUAL_NAMES.map((n, i) => ({ value: String(i), label: n }))]} hint="Si no estás en una mutual, cotizas en el ISL" />
        <Select label="Región donde se trabaja" value={s.region == null ? "" : String(s.region)} onChange={(e) => setS({ ...s, region: e.target.value ? Number(e.target.value) : null })}
          options={[{ value: "", label: "Elegir…" }, ...REGIONS.map(([c, n]) => ({ value: String(c), label: n }))]} />
        <ScaledField label="Comuna (código territorial)" scale={1} value={s.comuna} onValue={(v) => setS({ ...s, comuna: v })} hint="Código único territorial; Frutillar = 10105" />
      </fieldset>
    </Card>
  );
}
