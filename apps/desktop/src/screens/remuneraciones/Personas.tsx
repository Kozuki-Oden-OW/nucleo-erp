// Personas que reciben remuneración: el dueño con sueldo empresarial y los trabajadores.
import { useCallback, useEffect, useState } from "react";
import { Calculator, Pencil, Save, UserPlus } from "lucide-react";
import { useBackend, errorMessage, type ContractType, type PayTerms, type Worker, type WorkerInput } from "../../data";
import { formatDate, formatMoney, formatRut, todayIso } from "../../lib/format";
import { navigate } from "../../lib/router";
import { JORNADAS, REGIONS, lreHealthCode } from "../../data/lre";
import { CAUSE_LABEL, type Cause } from "../../data/severance";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Notice, Segmented, Select, Spinner } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { PercentField } from "../comex/common";
import { CONTRACT_LABEL, ItemsEditor, ScaledField } from "./common";

const AFP_NAMES = ["Capital", "Cuprum", "Habitat", "Modelo", "PlanVital", "Provida", "Uno"];

const newTerms = (owner: boolean): PayTerms => ({
  contract: owner ? "sin_contrato" : "indefinido", base_salary: 0, weekly_hours: owner ? null : 42, gratification: owner ? "ninguna" : "art50",
  gratification_amount: 0, overtime_surcharge_ppm: null, afp: null, health: "fonasa", health_name: null, isapre_plan_uf_e4: null, isapre_plan_clp: null,
  afc: !owner, employer_contrib: true, accident: true, items: [], deductions: [],
  family_loads: 0, invalid_loads: 0, allowance_income: null, apv: null, region: null, comuna: null, jornada: null, disability: 0,
  pensioner: false, young_subsidy: false, health_lre_code: null, end_cause: null,
});
const blank = (owner: boolean): WorkerInput => ({ rut: "", name: "", is_owner: owner, position: null, start_date: todayIso(), end_date: null, active: true, terms: newTerms(owner) });

export function PersonasTab({ openNew }: { openNew: boolean }) {
  const backend = useBackend();
  const { can } = useSession();
  const [list, setList] = useState<Worker[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; input: WorkerInput } | null>(null);
  const load = useCallback(() => { backend.workers().then(setList).catch((e) => setErr(errorMessage(e))); }, [backend]);
  useEffect(load, [load]);
  useEffect(() => {
    if (openNew && list && can("remuneraciones.editar")) setEditing({ id: null, input: blank(!list.some((w) => w.is_owner)) });
  }, [openNew, list, can]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!list) return <Spinner />;
  const edit = can("remuneraciones.editar");
  const hasOwner = list.some((w) => w.is_owner);

  return (
    <div className="flex flex-col gap-5">
      {list.length === 0 ? (
        <EmptyState icon={UserPlus} title="Agrega a quien recibe remuneración"
          action={edit && <Button icon={UserPlus} onClick={() => setEditing({ id: null, input: blank(true) })}>Agregar mi sueldo empresarial</Button>}>
          Empieza por ti: si trabajas en tu empresa y te pagas un sueldo fijo, es tu sueldo empresarial.
        </EmptyState>
      ) : (
        <Card padded={false} title="Personas" subtitle="Sus condiciones se usan para preparar cada liquidación"
          actions={edit && (
            <>
              {!hasOwner && <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setEditing({ id: null, input: blank(true) })}>Sueldo empresarial</Button>}
              <Button size="sm" icon={UserPlus} onClick={() => setEditing({ id: null, input: blank(false) })}>Agregar trabajador</Button>
            </>
          )}>
          <ul className="divide-y divide-line">
            {list.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {w.name}
                    {w.is_owner && <Badge tone="accent">Sueldo empresarial</Badge>}
                    {!w.active && <Badge>Inactivo</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {formatRut(w.rut)}{w.position ? ` · ${w.position}` : ""} · {CONTRACT_LABEL[w.terms.contract]} · desde {formatDate(w.start_date)}{w.end_date ? ` hasta ${formatDate(w.end_date)}` : ""}
                  </div>
                  <div className="text-xs text-muted">
                    AFP {w.terms.afp ?? "no cotiza"} · {w.terms.health === "isapre" ? `Isapre ${w.terms.health_name ?? ""}`.trim() : w.terms.health === "fonasa" ? "Fonasa" : "Sin salud"}
                    {w.terms.afc ? " · Seguro de cesantía" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num font-semibold text-ink">{formatMoney(w.terms.base_salary)}</span>
                  {!w.is_owner && <Button size="sm" variant="ghost" icon={Calculator} onClick={() => navigate(`/remuneraciones/finiquito/${w.id}`)}>Finiquito</Button>}
                  {edit && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { const { id, ...input } = w; setEditing({ id, input: { ...input, rut: formatRut(input.rut) } }); }}>Editar</Button>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <WorkerDrawer initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function WorkerDrawer({ initial, onClose, onSaved }: { initial: { id: number | null; input: WorkerInput }; onClose: () => void; onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [f, setF] = useState<WorkerInput>(initial.input);
  const [busy, setBusy] = useState(false);
  const t = f.terms;
  const setT = (patch: Partial<PayTerms>) => setF((x) => ({ ...x, terms: { ...x.terms, ...patch } }));
  const owner = f.is_owner;
  const [planUnit, setPlanUnit] = useState<"uf" | "clp">(t.isapre_plan_clp && !t.isapre_plan_uf_e4 ? "clp" : "uf");

  async function save() {
    setBusy(true);
    try {
      const input: WorkerInput = { ...f, terms: { ...t, isapre_plan_uf_e4: planUnit === "uf" ? t.isapre_plan_uf_e4 : null, isapre_plan_clp: planUnit === "clp" ? t.isapre_plan_clp : null } };
      await backend.saveWorker(initial.id, input);
      toast("success", initial.id === null ? `${f.name.trim()} quedó registrado.` : "Datos guardados.");
      onSaved();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width="w-[min(640px,100vw)]"
      title={initial.id === null ? (owner ? "Sueldo empresarial" : "Nuevo trabajador") : f.name}
      subtitle={owner ? "Lo que la empresa te paga por trabajar en ella, como socio o dueño" : "Datos del contrato y de su previsión"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Save} onClick={save} disabled={busy}>Guardar</Button></>}>
      <div className="flex flex-col gap-6">
        {owner && (
          <Notice tone="info" title="Sueldo empresarial">
            Es gasto de la empresa si corresponde a un trabajo efectivo y es razonable para lo que haces. Paga AFP, salud e impuesto único como cualquier sueldo;
            normalmente no cotiza seguro de cesantía porque no hay contrato de trabajo. Confirma los detalles con tu contador.
          </Notice>
        )}
        <section className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre completo" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="RUT" value={f.rut} placeholder="12.345.678-5" onChange={(e) => setF({ ...f, rut: e.target.value })} />
          <Field label="Cargo" optional value={f.position ?? ""} onChange={(e) => setF({ ...f, position: e.target.value || null })} />
          <Field label={owner ? "Desde" : "Fecha de ingreso"} type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
          {!owner && <Field label="Fecha de término" type="date" optional value={f.end_date ?? ""} onChange={(e) => setF({ ...f, end_date: e.target.value || null })} hint="Solo si el contrato terminó o es a plazo" />}
          {!owner && f.end_date && (
            <Select label="Causal de término" value={t.end_cause ?? ""} onChange={(e) => setT({ end_cause: (e.target.value || null) as Cause | null })}
              options={[{ value: "", label: "Elegir…" }, ...(Object.keys(CAUSE_LABEL) as Cause[]).map((c) => ({ value: c, label: CAUSE_LABEL[c] }))]}
              hint="Se informa en el Libro de Remuneraciones" />
          )}
          {initial.id !== null && <div className="flex items-end pb-2"><Checkbox label="Activo" checked={f.active} onChange={(v) => setF({ ...f, active: v })} hint="Si no, no aparece en los meses nuevos" /></div>}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">{owner ? "Monto" : "Contrato y sueldo"}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {!owner && (
              <Select label="Tipo de contrato" value={t.contract} onChange={(e) => setT({ contract: e.target.value as ContractType })}
                options={(["indefinido", "plazo_fijo"] as ContractType[]).map((c) => ({ value: c, label: CONTRACT_LABEL[c] }))} />
            )}
            <MoneyField label={owner ? "Sueldo empresarial mensual (bruto)" : "Sueldo base mensual"} value={t.base_salary || null} onValue={(v) => setT({ base_salary: v ?? 0 })}
              hint={owner ? "Antes de cotizaciones e impuesto" : "Por el mes completo (30 días)"} />
            {!owner && <ScaledField label="Jornada semanal" scale={1} suffix="horas" value={t.weekly_hours} onValue={(v) => setT({ weekly_hours: v })} hint="Para calcular las horas extra" />}
            {!owner && (
              <Select label="Gratificación" value={t.gratification} onChange={(e) => setT({ gratification: e.target.value as PayTerms["gratification"] })}
                options={[{ value: "art50", label: "Legal mensual (art. 50: 25 % con tope)" }, { value: "fija", label: "Monto fijo pactado" }, { value: "ninguna", label: "No se paga mensualmente" }]} />
            )}
            {!owner && t.gratification === "fija" && <MoneyField label="Gratificación pactada" value={t.gratification_amount || null} onValue={(v) => setT({ gratification_amount: v ?? 0 })} />}
            {!owner && <PercentField label="Recargo de horas extra" optional ppm={t.overtime_surcharge_ppm} onPpm={(v) => setT({ overtime_surcharge_ppm: v })} hint="Vacío = el mínimo legal de los indicadores del mes" />}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">Previsión y salud</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Select label="AFP" value={t.afp ?? ""} onChange={(e) => setT({ afp: e.target.value || null })}
              options={[{ value: "", label: "No cotiza en AFP (pensionado u otro régimen)" }, ...[...new Set([...AFP_NAMES, ...(t.afp ? [t.afp] : [])])].map((n) => ({ value: n, label: n }))]}
              hint="La tasa del mes viene de los indicadores" />
            <Select label="Salud" value={t.health} onChange={(e) => setT({ health: e.target.value as PayTerms["health"] })}
              options={[{ value: "fonasa", label: "Fonasa" }, { value: "isapre", label: "Isapre" }, { value: "ninguna", label: "No cotiza salud" }]} />
            {t.health === "isapre" && (
              <>
                <Field label="Isapre" value={t.health_name ?? ""} placeholder="Colmena, Consalud, Banmédica…" onChange={(e) => setT({ health_name: e.target.value || null })} />
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">Valor del plan</span>
                    <Segmented label="Unidad del plan" value={planUnit} onChange={setPlanUnit} options={[{ value: "uf", label: "UF" }, { value: "clp", label: "Pesos" }]} />
                  </div>
                  {planUnit === "uf"
                    ? <ScaledField ariaLabel="Plan en UF" scale={10_000} suffix="UF" value={t.isapre_plan_uf_e4} onValue={(v) => setT({ isapre_plan_uf_e4: v })} hint="Está en el contrato con la Isapre" />
                    : <MoneyField aria-label="Plan en pesos" value={t.isapre_plan_clp} onValue={(v) => setT({ isapre_plan_clp: v })} />}
                </div>
              </>
            )}
            <div className="flex flex-col gap-3 md:col-span-2">
              <Checkbox label="Cotiza seguro de cesantía (AFC)" checked={t.afc} onChange={(v) => setT({ afc: v })}
                hint={owner ? "Normalmente no: requiere contrato de trabajo" : "Obligatorio para contratos desde octubre de 2002"} />
              <Checkbox label="Le corresponden los aportes del empleador del mes" checked={t.employer_contrib} onChange={(v) => setT({ employer_contrib: v })}
                hint="SIS y cotización del empleador de la reforma de pensiones (indicadores del mes)" />
              <Checkbox label="Cubierto por el seguro de accidentes de la empresa (Ley 16.744)" checked={t.accident} onChange={(v) => setT({ accident: v })} />
            </div>
          </div>
        </section>

        {!owner && (
          <section>
            <h3 className="mb-1 text-sm font-semibold text-ink">Cargas familiares</h3>
            <p className="mb-3 text-xs text-muted">Solo las acreditadas ante la caja de compensación o el IPS. La asignación familiar la pagas tú y se descuenta de lo que enteras en Previred.</p>
            <div className="grid gap-4 md:grid-cols-3">
              <ScaledField label="Cargas simples o maternales" scale={1} value={t.family_loads || null} onValue={(v) => setT({ family_loads: v ?? 0 })} />
              <ScaledField label="Cargas por invalidez" scale={1} value={t.invalid_loads || null} onValue={(v) => setT({ invalid_loads: v ?? 0 })} hint="Reciben el doble" />
              <MoneyField label="Ingreso promedio enero-junio" value={t.allowance_income} onValue={(v) => setT({ allowance_income: v })} hint="Define el tramo (A, B, C o D)" />
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Ahorro previsional voluntario (APV)</h3>
            <Checkbox label="Descontar APV por planilla" checked={!!t.apv} onChange={(v) => setT({ apv: v ? { regime: "b", amount_clp: null, amount_uf_e4: null, institution: t.afp ? `AFP ${t.afp}` : null } : null })} />
          </div>
          {t.apv && (
            <div className="grid gap-4 md:grid-cols-3">
              <Select label="Régimen" value={t.apv.regime} onChange={(e) => setT({ apv: { ...t.apv!, regime: e.target.value as "a" | "b" } })}
                options={[{ value: "b", label: "B: rebaja el impuesto del mes" }, { value: "a", label: "A: bonificación del Estado" }]} />
              <MoneyField label="Monto mensual en pesos" value={t.apv.amount_clp ?? null} onValue={(v) => setT({ apv: { ...t.apv!, amount_clp: v, amount_uf_e4: v ? null : t.apv!.amount_uf_e4 } })} />
              <ScaledField label="o en UF" scale={10_000} suffix="UF" value={t.apv.amount_uf_e4 ?? null} onValue={(v) => setT({ apv: { ...t.apv!, amount_uf_e4: v, amount_clp: v ? null : t.apv!.amount_clp } })} />
              <Field className="md:col-span-3" label="Institución" optional value={t.apv.institution ?? ""} onChange={(e) => setT({ apv: { ...t.apv!, institution: e.target.value || null } })} />
            </div>
          )}
        </section>

        <details className="rounded-lg border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Datos para el Libro de Remuneraciones</summary>
          <p className="mt-2 text-xs text-muted">Si la región y la comuna son las del negocio, déjalas vacías y complétalas una vez en “Previred y libro”.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Select label="Región donde presta servicios" value={t.region == null ? "" : String(t.region)} onChange={(e) => setT({ region: e.target.value ? Number(e.target.value) : null })}
              options={[{ value: "", label: "La del negocio" }, ...REGIONS.map(([c, n]) => ({ value: String(c), label: n }))]} />
            <ScaledField label="Comuna (código territorial)" optional scale={1} value={t.comuna} onValue={(v) => setT({ comuna: v })} hint="Código único territorial; Frutillar = 10105" />
            <Select label="Tipo de jornada" value={String(t.jornada ?? 101)} onChange={(e) => setT({ jornada: Number(e.target.value) })}
              options={JORNADAS.map(([c, n]) => ({ value: String(c), label: `${c} · ${n}` }))} />
            <Select label="Discapacidad o pensión de invalidez" value={String(t.disability)} onChange={(e) => setT({ disability: Number(e.target.value) })}
              options={[{ value: "0", label: "No" }, { value: "1", label: "Discapacidad certificada" }, { value: "2", label: "Pensión de invalidez" }, { value: "3", label: "Ambas" }]} />
            {t.health === "isapre" && lreHealthCode("isapre", t.health_name) == null && (
              <ScaledField label="Código de la Isapre en el LRE" scale={1} value={t.health_lre_code} onValue={(v) => setT({ health_lre_code: v })} hint="Tabla del suplemento LRE de la DT" />
            )}
            <div className="flex flex-col gap-3 md:col-span-2">
              <Checkbox label="Pensionado por vejez" checked={t.pensioner} onChange={(v) => setT({ pensioner: v })} />
              <Checkbox label="Recibe subsidio al empleo joven" checked={t.young_subsidy} onChange={(v) => setT({ young_subsidy: v })} />
            </div>
          </div>
        </details>

        <section>
          <h3 className="mb-1 text-sm font-semibold text-ink">Haberes de todos los meses</h3>
          <p className="mb-3 text-xs text-muted">Colación, movilización o bonos fijos. Lo que cambia mes a mes se agrega en cada liquidación.</p>
          <ItemsEditor kind="haber" items={t.items} onChange={(items) => setT({ items })} />
        </section>
        <section>
          <h3 className="mb-1 text-sm font-semibold text-ink">Descuentos de todos los meses</h3>
          <p className="mb-3 text-xs text-muted">Cuota sindical, préstamo en cuotas u otros autorizados por escrito.</p>
          <ItemsEditor kind="descuento" items={t.deductions} onChange={(deductions) => setT({ deductions })} />
        </section>
      </div>
    </Drawer>
  );
}
