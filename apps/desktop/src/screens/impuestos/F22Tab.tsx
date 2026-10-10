// Renta anual (F22) de una empresa Pro Pyme general: recuadro 17 desde lo cobrado y lo pagado en el
// año, PPM de los F29 declarados, incentivo 14 E, impuesto y registros. NÚCLEO no declara: deja cada
// código listo para comparar con la propuesta del SII en abril.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCopy, Info, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { useBackend, errorMessage, type F22Inputs, type F22View } from "../../data";
import { computeF22, F22_LABEL, R17_EXPENSE, R17_INCOME, type F22Line, type Registers } from "../../data/f22";
import { formatMoney, todayIso } from "../../lib/format";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Card, Checkbox, cx, Field, IconButton, Notice, Select, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { PercentField } from "../comex/common";
import { ScaledField } from "../remuneraciones/common";

const money = (v: number) => (v < 0 ? `−${formatMoney(-v)}` : formatMoney(v));
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const R18_19_20 = [1445, 1705, 1726, 1479, 1708, 1379, 1710, 1545, 1703, 1704, 1720, 1493, 1494, 1500, 1451, 1459, 1463, 1475, 1484, 1454, 1470, 1487];

/** Año comercial por defecto: el anterior hasta abril (cuando se declara) y el actual después. */
export const defaultF22Year = () => { const t = todayIso(); return Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) <= 4 ? 1 : 0); };

export function F22Tab({ year, onYear }: { year: number; onYear: (y: number) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [view, setView] = useState<F22View | null>(null);
  const [inputs, setInputs] = useState<F22Inputs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setView(null); setErr(null);
    backend.f22(year).then((v) => { setView(v); setInputs(v.inputs); }).catch((e) => setErr(errorMessage(e)));
  }, [backend, year]);
  // Vista previa en vivo con lo que se está editando.
  const live = useMemo(() => {
    if (!view || !inputs) return null;
    const lines: F22Line[] = view.derived.map((d) => ({ code: d.code, amount: inputs.overrides[String(d.code)] ?? d.amount })).filter((l) => l.amount !== 0);
    lines.push(...inputs.extra.filter((l) => l.amount !== 0));
    const ppm = view.ppm.map((r) => {
      const key = r.period.slice(5, 7);
      const amount = inputs.ppm_overrides[key] ?? (r.source === "declarado" ? r.amount : null);
      return amount ? { period: r.period, amount, factor_e6: inputs.ppm_factors[key] ?? 0 } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    const reg = inputs.registers ?? {};
    const hasReg = Object.values(reg).some((v) => (v ?? 0) !== 0);
    const input = { params: inputs.params, lines, art21: inputs.art21, incentive: inputs.incentive, rebates: inputs.rebates, ppm, registers: hasReg ? reg : null };
    return { result: computeF22(input), without: inputs.incentive ? computeF22({ ...input, incentive: false }) : null };
  }, [view, inputs]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view || !inputs || !live) return <Spinner />;
  const edit = can("contabilidad.editar");
  const dirty = JSON.stringify(inputs) !== JSON.stringify(view.inputs);
  const r = live.result, c = r.codes;
  const set = (p: Partial<F22Inputs>) => setInputs((x) => ({ ...x!, ...p }));
  const setReg = (p: Partial<Registers>) => setInputs((x) => ({ ...x!, registers: { ...x!.registers, ...p } }));
  const setOverride = (code: number, v: number | null) => setInputs((x) => {
    const o = { ...x!.overrides };
    if (v === null) delete o[String(code)]; else o[String(code)] = v;
    return { ...x!, overrides: o };
  });
  const notes = [...view.checks, ...r.notes];
  const pay = c["90"] ?? 0, refund = c["85"] ?? 0;

  async function save() {
    setBusy(true);
    try { const v = await backend.saveF22Inputs(year, inputs!); setView(v); setInputs(v.inputs); toast("success", "Datos del F22 guardados."); }
    catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  async function suggest() {
    const rv = async (code: string) => (await backend.ruleValue(code).catch(() => null))?.value ?? null;
    const [rate, inc, cap] = await Promise.all([rv("IDPC_PROPYME_TASA_PPM"), rv("INCENTIVO_14E_TASA_PPM"), rv("INCENTIVO_14E_TOPE_UF_E4")]);
    if (rate == null) { toast("info", "No hay un paquete normativo con estos valores: ingrésalos desde las instrucciones del F22 del SII o pregúntale a tu contador."); return; }
    set({ params: { ...inputs!.params, idpc_rate_ppm: inputs!.params.idpc_rate_ppm || rate, incentive_rate_ppm: inputs!.params.incentive_rate_ppm || (inc ?? 0), incentive_cap_uf_e4: inputs!.params.incentive_cap_uf_e4 || (cap ?? 0) } });
  }
  async function copy() {
    const lines = Object.entries(c).filter(([, v]) => v !== 0).map(([k, v]) => `${k}\t${F22_LABEL[Number(k)] ?? ""}\t${v}`);
    try { await navigator.clipboard.writeText(`F22 AT ${view!.tax_year} (año comercial ${year})\n${lines.join("\n")}`); toast("success", "Códigos copiados."); }
    catch { toast("danger", "No se pudo copiar al portapapeles."); }
  }

  const years = Array.from({ length: 4 }, (_, i) => Number(todayIso().slice(0, 4)) - i);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Año comercial" value={String(year)} onChange={(e) => onYear(Number(e.target.value))}
          options={years.map((y) => ({ value: String(y), label: `Año comercial ${y} (F22 de abril ${y + 1})` }))} />
        {view.in_progress ? <Badge tone="warning">Proyección: el año aún no termina</Badge> : <Badge>Borrador</Badge>}
        <span className="text-sm text-muted">Régimen Pro Pyme general (14 D N°3)</span>
      </div>
      {notes.some((n) => n.severity !== "info") && (
        <Notice tone={notes.some((n) => n.severity === "falta") ? "danger" : "warning"} icon={AlertTriangle} title="Revisa">
          <ul className="list-disc pl-5">{notes.filter((n) => n.severity !== "info").map((n) => <li key={n.text}>{n.text}</li>)}</ul>
        </Notice>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card padded={false} title="Recuadro 17 · lo que entró y salió en el año" subtitle="Ingresos cobrados y egresos pagados (sin IVA). Cambia un monto si sabes que NÚCLEO no tiene todo; queda marcado como ajustado.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Código</th><th className="px-3 py-2 font-medium">Partida</th><th className="px-3 py-2 text-right font-medium">Según NÚCLEO</th><th className="w-44 px-5 py-2 text-right font-medium">Usado</th>
                </tr></thead>
                <tbody>
                  {view.derived.map((d) => (
                    <tr key={d.code} className="border-b border-line">
                      <td className="px-5 py-2 font-mono text-xs text-muted">{d.code}</td>
                      <td className="px-3 py-2"><div className="text-ink">{d.label}</div><div className="text-xs text-muted">{d.count ? `${d.count} documento(s) · ${d.source}` : d.source}</div></td>
                      <td className="num px-3 py-2 text-right text-muted">{money(d.amount)}</td>
                      <td className="px-5 py-1.5">
                        <MoneyField aria-label={`Código ${d.code}`} disabled={!edit} value={inputs.overrides[String(d.code)] ?? null} placeholder={money(d.amount)} onValue={(v) => setOverride(d.code, v)}
                          className={cx(inputs.overrides[String(d.code)] !== undefined && "[&_input]:border-warning")} />
                      </td>
                    </tr>
                  ))}
                  {inputs.extra.map((l, i) => (
                    <tr key={`x${i}`} className="border-b border-line">
                      <td className="px-5 py-1.5" colSpan={2}>
                        <div className="flex gap-2">
                          <Select aria-label="Código" disabled={!edit} value={String(l.code)} onChange={(e) => set({ extra: inputs.extra.map((x, j) => (j === i ? { ...x, code: Number(e.target.value) } : x)) })}
                            options={[...R17_INCOME, ...R17_EXPENSE].map((k) => ({ value: String(k), label: `${k} · ${F22_LABEL[k]}` }))} />
                          <Field className="flex-1" aria-label="Detalle" disabled={!edit} value={l.label ?? ""} placeholder="Detalle" onChange={(e) => set({ extra: inputs.extra.map((x, j) => (j === i ? { ...x, label: e.target.value || null } : x)) })} />
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right">{edit && <IconButton icon={Trash2} label="Quitar" onClick={() => set({ extra: inputs.extra.filter((_, j) => j !== i) })} />}</td>
                      <td className="px-5 py-1.5"><MoneyField aria-label="Monto" disabled={!edit} value={l.amount || null} onValue={(v) => set({ extra: inputs.extra.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)) })} /></td>
                    </tr>
                  ))}
                  <tr className="border-b border-line">
                    <td className="px-5 py-2 font-mono text-xs text-muted">1422</td>
                    <td className="px-3 py-2" colSpan={2}><div className="text-ink">Impuesto a la renta, multas e intereses fiscales pagados</div><div className="text-xs text-muted">Se rebajan como egreso y se vuelven a agregar (código 1431)</div></td>
                    <td className="px-5 py-1.5"><MoneyField aria-label="Partidas del art. 21" disabled={!edit} value={inputs.art21 || null} onValue={(v) => set({ art21: v ?? 0 })} /></td>
                  </tr>
                </tbody>
                <tfoot className="text-sm">
                  {[[1410, "Total ingresos"], [1430, "Total egresos"], [1729, "Base antes del incentivo"], ...(inputs.incentive ? [[1432, "Incentivo al ahorro 14 E"]] : []), [1440, "Base imponible"]].map(([k, t]) => (
                    <tr key={k} className={cx(k === 1440 && "border-t-2 border-line text-[15px] font-semibold")}>
                      <td className="px-5 py-1.5 font-mono text-xs text-muted">{k}</td><td className="px-3 py-1.5" colSpan={2}>{t}</td><td className="num px-5 py-1.5 text-right">{money(c[String(k)] ?? 0)}</td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
            {edit && <div className="px-5 pb-4 pt-3"><Button size="sm" variant="secondary" icon={Plus} onClick={() => set({ extra: [...inputs.extra, { code: 1426, amount: 0, label: null }] })}>Agregar partida (pérdida de arrastre, rentas extranjeras, relacionadas…)</Button></div>}
          </Card>

          <Card padded={false} title="Pagos provisionales mensuales (PPM)" subtitle="Salen de los F29 marcados como declarados. Cada PPM se reajusta con el factor que publica el SII para la renta.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Mes</th><th className="px-3 py-2 font-medium">PPM pagado</th><th className="w-36 px-3 py-2 font-medium">Factor</th><th className="px-5 py-2 text-right font-medium">Reajustado</th>
                </tr></thead>
                <tbody>
                  {view.ppm.map((p, i) => {
                    const key = p.period.slice(5, 7);
                    const amount = inputs.ppm_overrides[key] ?? (p.source === "declarado" ? p.amount : null);
                    const f = inputs.ppm_factors[key];
                    return (
                      <tr key={p.period} className="border-b border-line last:border-0">
                        <td className="px-5 py-1.5">{MONTHS[i]}{p.source === "declarado" && inputs.ppm_overrides[key] === undefined && <span className="ml-2 text-xs text-success">F29 declarado</span>}</td>
                        <td className="w-48 px-3 py-1.5">
                          <MoneyField aria-label={`PPM de ${MONTHS[i]}`} disabled={!edit} value={inputs.ppm_overrides[key] ?? null} placeholder={p.amount != null ? money(p.amount) : "—"}
                            onValue={(v) => setInputs((x) => { const o = { ...x!.ppm_overrides }; if (v === null) delete o[key]; else o[key] = v; return { ...x!, ppm_overrides: o }; })} />
                        </td>
                        <td className="px-3 py-1.5">
                          <ScaledField ariaLabel={`Factor de ${MONTHS[i]}`} scale={1_000_000} value={f ?? null} placeholder="1,000"
                            onValue={(v) => setInputs((x) => { const o = { ...x!.ppm_factors }; if (v === null) delete o[key]; else o[key] = v; return { ...x!, ppm_factors: o }; })} />
                        </td>
                        <td className="num px-5 py-1.5 text-right">{amount ? money(Math.round((amount * (f ?? 1_000_000)) / 1_000_000)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="border-t-2 border-line font-semibold"><td className="px-5 py-2" colSpan={3}>Total reajustado (código 36)</td><td className="num px-5 py-2 text-right">{money(c["36"] ?? 0)}</td></tr></tfoot>
              </table>
            </div>
          </Card>

          <Card title="Saldos del F22 anterior y movimientos del año" subtitle="Están en tu F22 del año pasado (recuadros 18 a 20). Se ingresan una vez al año.">
            <fieldset disabled={!edit} className="grid gap-4 md:grid-cols-3">
              <MoneyField label="CPTS inicial (1545 del año anterior)" value={inputs.registers.cpts_initial ?? null} onValue={(v) => setReg({ cpts_initial: v ?? 0 })} />
              <MoneyField label="Capital aportado histórico (1494)" value={inputs.registers.capital_historic ?? null} onValue={(v) => setReg({ capital_historic: v ?? 0 })} />
              <MoneyField label="Retiros de los dueños en el año" value={inputs.registers.withdrawals ?? null} onValue={(v) => setReg({ withdrawals: v ?? 0 })} hint="Lo que sacaron como dueños, aparte del sueldo empresarial" />
              <MoneyField label="RAI del año anterior (1484)" value={inputs.registers.rai_initial ?? null} onValue={(v) => setReg({ rai_initial: v ?? 0 })} />
              <MoneyField label="REX inicial (1487 del año anterior)" value={inputs.registers.rex_initial ?? null} onValue={(v) => setReg({ rex_initial: v ?? 0 })} />
              <MoneyField label="REX: aumentos del año" value={inputs.registers.rex_increase ?? null} onValue={(v) => setReg({ rex_increase: v ?? 0 })} />
              <MoneyField label="REX al término del año (1493)" value={inputs.registers.rex_final ?? null} onValue={(v) => setReg({ rex_final: v ?? 0 })} />
              <MoneyField label="Dividendos o retiros percibidos (1726)" value={inputs.registers.dividends_received ?? null} onValue={(v) => setReg({ dividends_received: v ?? 0 })} />
              <MoneyField label="Crédito exterior contra impuestos finales (1379)" value={inputs.registers.foreign_tax_credit_final ?? null} onValue={(v) => setReg({ foreign_tax_credit_final: v ?? 0 })} />
            </fieldset>
          </Card>

          <Card padded={false} title="Recuadros 18, 19 y 20" subtitle="Capital propio tributario simplificado y rentas afectas a impuestos finales. El recuadro 21 (créditos) lo completa tu contador.">
            <table className="w-full text-sm">
              <tbody>
                {R18_19_20.filter((k) => c[String(k)] !== undefined && c[String(k)] !== 0).map((k) => (
                  <tr key={k} className={cx("border-b border-line last:border-0", [1545, 1500, 1484].includes(k) && "font-semibold")}>
                    <td className="px-5 py-1.5 font-mono text-xs text-muted">{k}</td><td className="px-3 py-1.5">{F22_LABEL[k]}</td><td className="num px-5 py-1.5 text-right">{money(c[String(k)]!)}</td>
                  </tr>
                ))}
                {!R18_19_20.some((k) => c[String(k)]) && <tr><td className="px-5 py-3 text-muted" colSpan={3}>Ingresa los saldos del F22 anterior para calcularlos.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title={pay > 0 ? "Impuesto a pagar" : refund > 0 ? "Saldo a favor" : "Resultado"}
            actions={edit && <Button size="sm" icon={Save} onClick={save} disabled={busy || !dirty}>Guardar</Button>}>
            <div className="num text-[30px] font-semibold text-ink">{money(pay > 0 ? pay : refund)}</div>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted">Base imponible (18)</dt><dd className="num text-right">{money(c["18"] ?? 0)}</dd>
              <dt className="text-muted">Impuesto de primera categoría</dt><dd className="num text-right">{money(r.idpc_gross)}</dd>
              {(c["19"] ?? 0) > 0 && <><dt className="text-muted">− Rebajas (19)</dt><dd className="num text-right">{money(c["19"]!)}</dd></>}
              <dt className="text-muted">= Impuesto (20)</dt><dd className="num text-right">{money(c["20"] ?? 0)}</dd>
              <dt className="text-muted">− PPM reajustados (36)</dt><dd className="num text-right">{money(c["36"] ?? 0)}</dd>
              <dt className="font-medium text-ink">= Resultado (305)</dt><dd className="num text-right font-medium">{money(c["305"] ?? 0)}</dd>
            </dl>
            {live.without && (
              <p className="mt-3 rounded-md bg-surface-2 p-2 text-xs text-muted">Sin el incentivo 14 E el resultado sería <strong className="text-ink">{money(live.without.codes["305"] ?? 0)}</strong>: ahorras {money((live.without.codes["305"] ?? 0) - (c["305"] ?? 0))} este año, a cambio de reinvertir esas utilidades.</p>
            )}
            <Button className="mt-4 w-full" variant="secondary" icon={ClipboardCopy} onClick={copy}>Copiar códigos</Button>
          </Card>
          <Card title="Datos del año" subtitle="Valores del SII para el año comercial">
            <fieldset disabled={!edit} className="flex flex-col gap-4">
              <PercentField label="Tasa del impuesto de primera categoría" ppm={inputs.params.idpc_rate_ppm || null} onPpm={(v) => set({ params: { ...inputs.params, idpc_rate_ppm: v ?? 0 } })} />
              <Checkbox label="Acoger el incentivo al ahorro (art. 14 E)" checked={inputs.incentive} onChange={(v) => set({ incentive: v })} hint="Rebaja la base por las utilidades que se quedan en la empresa" />
              {inputs.incentive && (
                <div className="grid grid-cols-2 gap-3">
                  <PercentField label="Porcentaje" ppm={inputs.params.incentive_rate_ppm || null} onPpm={(v) => set({ params: { ...inputs.params, incentive_rate_ppm: v ?? 0 } })} />
                  <ScaledField label="Tope" scale={10_000} suffix="UF" value={inputs.params.incentive_cap_uf_e4 || null} onValue={(v) => set({ params: { ...inputs.params, incentive_cap_uf_e4: v ?? 0 } })} />
                  <ScaledField label="UF al 31 de diciembre" scale={100} fixed value={inputs.params.uf_e2 || null} onValue={(v) => set({ params: { ...inputs.params, uf_e2: v ?? 0 } })} />
                </div>
              )}
              <MoneyField label="Rebajas al impuesto (código 19)" value={inputs.rebates || null} onValue={(v) => set({ rebates: v ?? 0 })} hint="Créditos que te indique tu contador" />
              {edit && <Button variant="ghost" size="sm" icon={Wand2} onClick={suggest}>Usar valores del paquete normativo</Button>}
            </fieldset>
          </Card>
          {notes.some((n) => n.severity === "info") && (
            <Notice tone="info" icon={Info} title="Para que sepas"><ul className="list-disc pl-5">{notes.filter((n) => n.severity === "info").map((n) => <li key={n.text}>{n.text}</li>)}</ul></Notice>
          )}
        </div>
      </div>
    </div>
  );
}
