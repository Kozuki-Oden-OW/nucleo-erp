// Indicadores del mes: los valores normativos que usa la liquidación (UF, UTM, topes, tasas de AFP,
// SIS, cotización del empleador, tabla del impuesto único). Se copian de Previred y del SII; NÚCLEO no
// trae valores escritos en el programa. Cada mes parte con los del mes anterior para revisarlos.
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type IndicatorsView, type PayrollIndicators } from "../../data";
import type { AllowanceBracket, EmployerRate, PayrollParams, TaxBracket } from "../../data/payroll";
import type { SeveranceRules } from "../../data/severance";
import { ufToClp } from "../../data/payroll";
import { formatDate, formatMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Button, Card, Checkbox, Field, IconButton, Notice, Select, Spinner, TextArea } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { PercentField } from "../comex/common";
import { ScaledField, periodLabel } from "./common";

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "aporte";

export function IndicadoresTab({ period }: { period: string }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [view, setView] = useState<IndicatorsView | null>(null);
  const [ind, setInd] = useState<PayrollIndicators | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setView(null); setErr(null);
    backend.payrollIndicators(period).then((v) => { setView(v); setInd(v.indicators); setSource(v.saved ? v.source ?? "" : ""); }).catch((e) => setErr(errorMessage(e)));
  }, [backend, period]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view || !ind) return <Spinner />;
  const edit = can("remuneraciones.editar");
  const p = ind.params;
  const setP = (patch: Partial<PayrollParams>) => setInd({ ...ind, params: { ...p, ...patch } });
  const afc = { worker_indefinite_ppm: 0, employer_indefinite_ppm: 0, employer_fixed_ppm: 0, ...p.afc };
  const brackets = p.tax_brackets ?? [];
  const employer = p.employer ?? [];
  const setBracket = (i: number, patch: Partial<TaxBracket>) => setP({ tax_brackets: brackets.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const allowance = p.family_allowance?.brackets ?? [];
  const setAllowance = (patch: { brackets?: AllowanceBracket[]; full_days?: number }) =>
    setP({ family_allowance: { brackets: allowance, full_days: p.family_allowance?.full_days ?? 0, ...patch } });
  const setAllowanceRow = (i: number, patch: Partial<AllowanceBracket>) => setAllowance({ brackets: allowance.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const sev: SeveranceRules = ind.severance ?? {};
  const setSev = (patch: Partial<SeveranceRules>) => setInd({ ...ind, severance: { ...sev, ...patch } });
  const setEmployer = (i: number, patch: Partial<EmployerRate>) => setP({ employer: employer.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const cap = (e4?: number) => (p.uf_e2 && e4 ? formatMoney(ufToClp(e4, p.uf_e2)) : null);

  async function save() {
    setBusy(true);
    try {
      const v = await backend.savePayrollIndicators(period, ind!, source.trim() || null);
      setView(v); setInd(v.indicators); toast("success", `Indicadores de ${periodLabel(period)} guardados.`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {view.saved
        ? <Notice tone="success" title={`Indicadores de ${periodLabel(period)} guardados`}>{view.source ? `Fuente: ${view.source.replace(/\.+$/, "")}. ` : ""}Última actualización: {formatDate(view.updated_at)}.</Notice>
        : view.from_period
          ? <Notice tone="warning" title="Revisa y guarda los de este mes">Se proponen los de {periodLabel(view.from_period)}. La UF y la UTM cambian todos los meses; las tasas de AFP y el SIS, de vez en cuando.</Notice>
          : <Notice tone="info" title="Primera vez">Copia estos valores desde <strong>previred.com → Indicadores previsionales</strong> (UF, topes, tasas de AFP, SIS, seguro de cesantía) y desde <strong>sii.cl → Valores y fechas</strong> (UTM y tabla del impuesto único de segunda categoría). Los meses siguientes partirán con estos mismos valores.</Notice>}

      <fieldset disabled={!edit} className="flex flex-col gap-6">
        <Card title="Valores del mes" subtitle="Los que cambian todos los meses">
          <div className="grid gap-4 md:grid-cols-3">
            <ScaledField label="UF del último día del mes" scale={100} fixed value={p.uf_e2 || null} onValue={(v) => setP({ uf_e2: v ?? 0 })} hint="Previred: “Valor UF” al cierre del mes" />
            <MoneyField label="UTM del mes" value={p.utm || null} onValue={(v) => setP({ utm: v ?? 0 })} hint="sii.cl → Valores y fechas → UTM" />
            <MoneyField label="Ingreso mínimo mensual" value={p.imm || null} onValue={(v) => setP({ imm: v ?? 0 })} hint="Previred: “Renta mínima imponible”" />
          </div>
        </Card>

        <Card title="Topes y cotizaciones del trabajador">
          <div className="grid gap-4 md:grid-cols-3">
            <ScaledField label="Tope imponible AFP y salud" scale={10_000} suffix="UF" value={p.cap_pension_uf_e4 || null} onValue={(v) => setP({ cap_pension_uf_e4: v ?? 0 })} hint={cap(p.cap_pension_uf_e4) ? `= ${cap(p.cap_pension_uf_e4)} este mes` : "Previred: “Rentas topes imponibles”"} />
            <ScaledField label="Tope imponible seguro de cesantía" scale={10_000} suffix="UF" value={p.cap_afc_uf_e4 || null} onValue={(v) => setP({ cap_afc_uf_e4: v ?? 0 })} hint={cap(p.cap_afc_uf_e4) ? `= ${cap(p.cap_afc_uf_e4)} este mes` : undefined} />
            <PercentField label="Cotización legal de salud" ppm={p.health_ppm || null} onPpm={(v) => setP({ health_ppm: v ?? 0 })} />
            <PercentField label="Seguro de cesantía: trabajador (indefinido)" ppm={afc.worker_indefinite_ppm || null} onPpm={(v) => setP({ afc: { ...afc, worker_indefinite_ppm: v ?? 0 } })} />
            <Select label="Rebaja de salud en el impuesto" value={p.health_deduction ?? "up_to_cap"} onChange={(e) => setP({ health_deduction: e.target.value as PayrollParams["health_deduction"] })}
              options={[{ value: "up_to_cap", label: "Toda la cotización, hasta el % legal del tope" }, { value: "legal_only", label: "Solo la cotización legal" }]}
              hint="Criterio de tu contador para el plan de Isapre" />
          </div>
        </Card>

        <Card title="AFP" subtitle="Tasa total de cargo del trabajador dependiente: cotización obligatoria más la comisión de cada AFP"
          actions={edit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setInd({ ...ind, afp: [...ind.afp, { name: "", rate_ppm: 0 }] })}>AFP</Button>}>
          {ind.afp.length === 0 ? <p className="text-sm text-muted">Agrega al menos la AFP de cada persona.</p> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ind.afp.map((a, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2">
                  <Field aria-label="Nombre de la AFP" value={a.name} placeholder="Nombre" onChange={(e) => setInd({ ...ind, afp: ind.afp.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <PercentField label="" ariaLabel={`Tasa ${a.name}`} ppm={a.rate_ppm || null} onPpm={(v) => setInd({ ...ind, afp: ind.afp.map((x, j) => (j === i ? { ...x, rate_ppm: v ?? 0 } : x)) })} />
                  {edit && <IconButton icon={Trash2} label="Quitar" onClick={() => setInd({ ...ind, afp: ind.afp.filter((_, j) => j !== i) })} />}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Aportes del empleador" subtitle="No se descuentan al trabajador: son costo de la empresa y se pagan en Previred"
          actions={edit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setP({ employer: [...employer, { code: "", label: "", rate_ppm: 0, base: "pension" }] })}>Aporte</Button>}>
          <div className="flex flex-col gap-3">
            {employer.map((e, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <Field className="min-w-[14rem] flex-1" aria-label="Nombre del aporte" value={e.label} placeholder="SIS, cotización del empleador (Ley 21.735)…" onChange={(x) => setEmployer(i, { label: x.target.value, code: slug(x.target.value) })} />
                <div className="w-28"><PercentField label="" ariaLabel={`Tasa ${e.label}`} ppm={e.rate_ppm || null} onPpm={(v) => setEmployer(i, { rate_ppm: v ?? 0 })} /></div>
                <Select aria-label={`Se paga a (${e.label})`} value={e.payee ?? "afp"} onChange={(x) => setEmployer(i, { payee: x.target.value })}
                  options={[{ value: "afp", label: "A la AFP de la persona" }, { value: "seguro_social", label: "Al Seguro Social (IPS)" }]} />
                <div className="pb-2"><Checkbox label={<span className="text-xs">Es el SIS (LRE 4155)</span>} checked={e.lre === 4155} onChange={(v) => setEmployer(i, { lre: v ? 4155 : null })} /></div>
                {edit && <IconButton icon={Trash2} label="Quitar" onClick={() => setP({ employer: employer.filter((_, j) => j !== i) })} />}
              </div>
            ))}
            <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-3">
              <PercentField label="Seguro de cesantía: empleador (indefinido)" ppm={afc.employer_indefinite_ppm || null} onPpm={(v) => setP({ afc: { ...afc, employer_indefinite_ppm: v ?? 0 } })} />
              <PercentField label="Seguro de cesantía: empleador (plazo fijo)" ppm={afc.employer_fixed_ppm || null} onPpm={(v) => setP({ afc: { ...afc, employer_fixed_ppm: v ?? 0 } })} />
              <PercentField label="Accidentes del trabajo (tu mutual o ISL)" optional ppm={p.accident_ppm || null} onPpm={(v) => setP({ accident_ppm: v ?? 0 })} hint="Básica + adicional + Ley SANNA; la informa tu mutual" />
            </div>
          </div>
        </Card>

        <Card title="Impuesto único de segunda categoría" subtitle="Tabla mensual del SII expresada en UTM (los tramos en UTM casi nunca cambian)"
          actions={edit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setP({ tax_brackets: [...brackets, { up_to_utm_e4: null, factor_ppm: 0, rebate_utm_e4: 0 }] })}>Tramo</Button>}>
          {brackets.length === 0 ? <p className="text-sm text-muted">Ingresa los tramos tal como aparecen en sii.cl (desde el tramo exento hasta “y más”).</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-1 font-medium">Tramo</th><th className="py-1 font-medium">Hasta (UTM)</th><th className="py-1 font-medium">Factor</th><th className="py-1 font-medium">Cantidad a rebajar (UTM)</th><th />
                </tr></thead>
                <tbody>
                  {brackets.map((b, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2 text-muted">{i + 1}</td>
                      <td className="py-1 pr-2">
                        {b.up_to_utm_e4 == null && i === brackets.length - 1
                          ? <span className="text-muted">y más</span>
                          : <ScaledField ariaLabel={`Tramo ${i + 1}: hasta`} scale={10_000} suffix="UTM" value={b.up_to_utm_e4 ?? null} onValue={(v) => setBracket(i, { up_to_utm_e4: v })}
                              hint={p.utm && b.up_to_utm_e4 ? formatMoney(Math.floor((b.up_to_utm_e4 * p.utm) / 10_000)) : undefined} />}
                      </td>
                      <td className="py-1 pr-2"><PercentField label="" ariaLabel={`Tramo ${i + 1}: factor`} ppm={b.factor_ppm} onPpm={(v) => setBracket(i, { factor_ppm: v ?? 0 })} /></td>
                      <td className="py-1 pr-2"><ScaledField ariaLabel={`Tramo ${i + 1}: rebaja`} scale={10_000} suffix="UTM" value={b.rebate_utm_e4 ?? 0} onValue={(v) => setBracket(i, { rebate_utm_e4: v ?? 0 })} /></td>
                      <td className="py-1">
                        <div className="flex items-center gap-1">
                          {i === brackets.length - 1 && <Checkbox label={<span className="text-xs">Sin límite</span>} checked={b.up_to_utm_e4 == null} onChange={(v) => setBracket(i, { up_to_utm_e4: v ? null : 0 })} />}
                          {edit && <IconButton icon={Trash2} label="Quitar tramo" onClick={() => setP({ tax_brackets: brackets.filter((_, j) => j !== i) })} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Otras reglas" subtitle="Cambian rara vez">
          <div className="grid gap-4 md:grid-cols-3">
            <PercentField label="Gratificación legal (art. 50)" optional ppm={p.gratification?.rate_ppm ?? null}
              onPpm={(v) => setP({ gratification: v == null ? null : { rate_ppm: v, cap_imm_e4: p.gratification?.cap_imm_e4 ?? 0 } })} />
            <ScaledField label="Tope anual de la gratificación" optional scale={10_000} suffix="ingresos mínimos" value={p.gratification?.cap_imm_e4 ?? null}
              onValue={(v) => setP({ gratification: { rate_ppm: p.gratification?.rate_ppm ?? 0, cap_imm_e4: v ?? 0 } })} />
            <PercentField label="Recargo mínimo de horas extra" optional ppm={p.overtime_surcharge_ppm || null} onPpm={(v) => setP({ overtime_surcharge_ppm: v ?? 0 })} />
          </div>
        </Card>

        <Card title="Asignación familiar" subtitle="Tramos por ingreso promedio y monto mensual por carga (Previred: “Asignación familiar”)"
          actions={edit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAllowance({ brackets: [...allowance, { up_to_income: null, amount: 0 }] })}>Tramo</Button>}>
          <div className="flex flex-col gap-3">
            {allowance.map((b, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <span className="w-16 pb-2 text-sm font-medium text-ink">Tramo {String.fromCharCode(65 + i)}</span>
                {b.up_to_income == null && i === allowance.length - 1
                  ? <span className="w-44 pb-2 text-sm text-muted">sobre el anterior</span>
                  : <div className="w-44"><MoneyField aria-label={`Tramo ${String.fromCharCode(65 + i)}: ingreso hasta`} value={b.up_to_income ?? null} onValue={(v) => setAllowanceRow(i, { up_to_income: v })} hint="Ingreso hasta" /></div>}
                <div className="w-40"><MoneyField aria-label={`Tramo ${String.fromCharCode(65 + i)}: monto por carga`} value={b.amount || null} onValue={(v) => setAllowanceRow(i, { amount: v ?? 0 })} hint="Por carga" /></div>
                {i === allowance.length - 1 && <div className="pb-2"><Checkbox label={<span className="text-xs">Sin límite</span>} checked={b.up_to_income == null} onChange={(v) => setAllowanceRow(i, { up_to_income: v ? null : 0 })} /></div>}
                {edit && <IconButton icon={Trash2} label="Quitar tramo" onClick={() => setAllowance({ brackets: allowance.filter((_, j) => j !== i) })} />}
              </div>
            ))}
            <div className="w-56"><ScaledField label="Días para pagarla completa" optional scale={1} value={p.family_allowance?.full_days ?? null} onValue={(v) => setAllowance({ full_days: v ?? 0 })} hint="Con menos días, proporcional" /></div>
          </div>
        </Card>

        <Card title="Previred, APV y finiquito">
          <div className="grid gap-4 md:grid-cols-3">
            <ScaledField label="Vencimiento del pago en Previred" optional scale={1} suffix="del mes siguiente" value={ind.previred_due_day ?? null} onValue={(v) => setInd({ ...ind, previred_due_day: v })} />
            <ScaledField label="Tope mensual del APV régimen B" optional scale={10_000} suffix="UF" value={p.apv_b_cap_uf_e4 || null} onValue={(v) => setP({ apv_b_cap_uf_e4: v ?? 0 })} />
            <span />
            <ScaledField label="Tope de la base de indemnizaciones" optional scale={10_000} suffix="UF" value={sev.cap_uf_e4 || null} onValue={(v) => setSev({ cap_uf_e4: v ?? 0 })} hint="Art. 172 del Código del Trabajo" />
            <ScaledField label="Tope de años de servicio" optional scale={1} suffix="años" value={sev.cap_years || null} onValue={(v) => setSev({ cap_years: v ?? 0 })} />
            <ScaledField label="Feriado anual" optional scale={1} suffix="días hábiles" value={sev.vacation_days_per_year || null} onValue={(v) => setSev({ vacation_days_per_year: v ?? 0 })} />
            <ScaledField label="Obra o faena: días por mes" optional scale={100} suffix="días" value={sev.obra_days_per_month_e2 || null} onValue={(v) => setSev({ obra_days_per_month_e2: v ?? 0 })} />
            <HolidaysField value={sev.holidays ?? []} onChange={(holidays) => setSev({ holidays })} />
          </div>
        </Card>

        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[280px] flex-1" label="Fuente" optional value={source} placeholder={`Previred, indicadores de ${periodLabel(period)}; SII, tabla del impuesto único`} onChange={(e) => setSource(e.target.value)} />
          {edit && <Button icon={Save} onClick={save} disabled={busy}>Guardar indicadores de {periodLabel(period)}</Button>}
        </div>
      </fieldset>
    </div>
  );
}

/** Feriados del año: se escribe libremente y se interpreta al salir del campo. */
function HolidaysField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  const joined = value.join("\n");
  useEffect(() => setText(joined), [joined]);
  return (
    <TextArea className="md:col-span-2" label="Feriados nacionales del año" optional value={text} onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(/[\s,;]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))}
      hint="Una fecha por línea (AAAA-MM-DD), para convertir el feriado del finiquito a días corridos" />
  );
}
