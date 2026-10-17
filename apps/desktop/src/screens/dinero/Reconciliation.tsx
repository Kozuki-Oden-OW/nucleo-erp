// Conciliación bancaria: sube la cartola del banco (CSV o Excel) y NÚCLEO identifica cada abono y
// cargo: lo que ya está registrado se concilia solo; para el resto sugiere el cobro de una venta, el
// pago de una compra o de un gasto, un gasto nuevo con su categoría o un traspaso entre tus cuentas.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, CircleCheck, CircleDashed, EyeOff, FileUp, Landmark, Scale, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import {
  useBackend, errorMessage, type BankSuggestion, type ExpenseCategory, type MoneyAccount, type ReconcileAction, type ReconciliationView, type StatementLineView,
} from "../../data";
import { readStatementFile, type ParsedStatement } from "../../lib/cartola";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Kpi, Notice, Select, Spinner, TextArea, cx } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";

type Filter = "pendiente" | "conciliado" | "ignorado" | "todos";

export function ReconciliationTab({ onChanged }: { onChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const write = can("dinero.registrar");
  const [accounts, setAccounts] = useState<MoneyAccount[] | null>(null);
  const [acc, setAcc] = useState("");
  const [view, setView] = useState<ReconciliationView | null>(null);
  const [filter, setFilter] = useState<Filter>("pendiente");
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: string; parsed: ParsedStatement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<StatementLineView | null>(null);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    backend.moneyAccounts().then((a) => {
      const active = a.filter((x) => !x.archived);
      setAccounts(active);
      setAcc((active.find((x) => x.kind === "banco") ?? active.find((x) => x.kind !== "caja") ?? active[0])?.uid ?? "");
    }).catch((e) => setErr(errorMessage(e)));
    backend.expenseCategories().then(setCats).catch(() => {});
  }, [backend]);
  const load = useCallback(() => { if (acc) backend.bankReconciliation(acc).then(setView).catch((e) => setErr(errorMessage(e))); }, [backend, acc]);
  useEffect(() => { setView(null); load(); }, [load]);

  async function pick(f: File | undefined) {
    if (!f) return;
    try { setPreview({ file: f.name, parsed: await readStatementFile(f, todayIso()) }); }
    catch (e) { toast("danger", e instanceof Error ? e.message : String(e)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  async function doImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await backend.importBankStatement(acc, preview.file, preview.parsed.lines);
      setPreview(null);
      toast("success", `${r.added} movimientos nuevos${r.duplicates ? `, ${r.duplicates} ya estaban` : ""}${r.auto_matched ? `, ${r.auto_matched} conciliados solos` : ""}.`);
      setFilter("pendiente");
      load();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  const act = async (line: StatementLineView, action: ReconcileAction, ok: string) => {
    try { setView(await backend.reconcileBankLine(line.uid, action)); setOpen(null); onChanged(); toast("success", ok); } catch (e) { toast("danger", errorMessage(e)); }
  };
  const apply = (line: StatementLineView, s: BankSuggestion) => {
    if (s.action === "gasto" && !s.category_id) { setOpen(line); return; }
    void act(line, { kind: s.action, target_uid: s.target_uid, category_id: s.category_id }, "Movimiento conciliado.");
  };

  const rows = useMemo(() => (view?.lines ?? []).filter((l) => filter === "todos" || l.status === filter), [view, filter]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!accounts) return <Spinner />;
  if (accounts.length === 0) return <EmptyState icon={Landmark} title="Primero crea una cuenta">Agrega tu cuenta del banco en Dinero → Cuentas.</EmptyState>;
  const diff = view && view.statement_balance_minor !== null && view.nucleo_balance_minor !== null ? view.nucleo_balance_minor - view.statement_balance_minor : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Cuenta" value={acc} onChange={(e) => setAcc(e.target.value)} className="w-72" options={accounts.map((a) => ({ value: a.uid, label: `${a.name}${a.bank_name ? ` · ${a.bank_name}` : ""}` }))} />
        {write && (
          <>
            <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.htm,.html" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>Subir cartola</Button>
            {view && view.pending > 0 && <Button variant="secondary" icon={Sparkles} onClick={async () => { try { const v = await backend.autoReconcileBank(acc); const n = (view?.pending ?? 0) - v.pending; setView(v); toast(n ? "success" : "info", n ? `${n} movimientos conciliados.` : "No hay coincidencias seguras: revisa las sugerencias de cada movimiento."); } catch (e) { toast("danger", errorMessage(e)); } }}>Conciliar automáticamente</Button>}
          </>
        )}
        <span className="text-xs text-muted">Descarga la cartola desde tu banco en Excel o CSV. Se reconocen las columnas Fecha, Descripción, Cargos, Abonos (o Monto) y Saldo.</span>
      </div>

      {!view ? <Spinner label="Revisando la cartola…" /> : view.lines.length === 0 ? (
        <EmptyState icon={FileUp} title="Aún no subes cartolas de esta cuenta" action={write && <Button icon={Upload} onClick={() => fileRef.current?.click()}>Subir cartola</Button>}>
          NÚCLEO compara cada movimiento del banco con tus cobros, pagos y gastos, y te ayuda a registrar lo que falta.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={CircleDashed} label="Por revisar" value={view.pending} tone={view.pending ? "warning" : "success"} hint={view.pending ? "Movimientos del banco sin conciliar" : "Todo conciliado"} onClick={() => setFilter("pendiente")} />
            <Kpi icon={CircleCheck} label="Conciliados" value={view.reconciled} onClick={() => setFilter("conciliado")} />
            <Kpi icon={EyeOff} label="Ignorados" value={view.ignored} hint="Con su nota" onClick={() => setFilter("ignorado")} />
            <Kpi icon={Scale} label="Saldo banco vs. NÚCLEO" value={view.statement_balance_minor !== null ? formatMoney(view.statement_balance_minor) : "—"} tone={diff === null ? undefined : diff === 0 ? "success" : "warning"}
              hint={diff === null ? "La cartola no informa saldo" : diff === 0 ? `Cuadra al ${formatDate(view.statement_date)}` : `NÚCLEO: ${formatMoney(view.nucleo_balance_minor!)} (diferencia ${formatMoney(diff)})`} />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(["pendiente", "conciliado", "ignorado", "todos"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx("rounded-full border px-3 py-1 text-[13px]", filter === f ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface text-ink hover:border-accent/50")}>
                {{ pendiente: "Por revisar", conciliado: "Conciliados", ignorado: "Ignorados", todos: "Todos" }[f]}
                <span className="num ml-1.5 text-muted">{f === "todos" ? view.lines.length : f === "pendiente" ? view.pending : f === "conciliado" ? view.reconciled : view.ignored}</span>
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            {rows.length === 0 ? <div className="p-8 text-center text-sm text-muted">{filter === "pendiente" ? "No queda nada por revisar. ¡Listo!" : "Sin movimientos."}</div> : (
              <ul className="divide-y divide-line">
                {rows.map((l) => {
                  const top = l.suggestions[0];
                  return (
                    <li key={l.uid} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <span className="num w-24 shrink-0 text-sm text-muted">{formatDate(l.date)}</span>
                      <div className="min-w-[14rem] flex-1">
                        <div className="truncate text-sm font-medium text-ink" title={l.description}>{l.description}{l.reference && <span className="ml-2 font-mono text-xs font-normal text-muted">{l.reference}</span>}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {l.status === "conciliado" && l.matched && (l.matched.link ? <button className="text-accent hover:underline" onClick={() => navigate(l.matched!.link!)}>{l.matched.label}</button> : l.matched.label)}
                          {l.status === "ignorado" && `Ignorado: ${l.note ?? ""}`}
                          {l.status === "pendiente" && top && <>Sugerencia: <span className="text-ink">{top.label}</span> · {top.detail}</>}
                          {l.status === "pendiente" && !top && "Sin sugerencias: elige qué es"}
                        </div>
                      </div>
                      <span className={cx("num w-28 shrink-0 text-right text-sm font-semibold", l.amount_minor > 0 ? "text-success" : "text-ink")}>{l.amount_minor > 0 ? "+" : "−"}{formatMoney(Math.abs(l.amount_minor))}</span>
                      <div className="flex w-full shrink-0 justify-end gap-1.5 sm:w-auto">
                        {l.status === "pendiente" ? (
                          write && <>
                            {top && top.score >= 50 && <Button size="sm" icon={CheckCheck} onClick={() => apply(l, top)}>{short(top)}</Button>}
                            <Button size="sm" variant="secondary" onClick={() => setOpen(l)}>{top && top.score >= 50 ? "Otra opción" : "Elegir qué es"}</Button>
                          </>
                        ) : (
                          <>
                            <Badge tone={l.status === "conciliado" ? "success" : "neutral"}>{l.status === "conciliado" ? "Conciliado" : "Ignorado"}</Badge>
                            {write && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void act(l, { kind: "deshacer" }, "Movimiento vuelve a revisión.")}>Deshacer</Button>}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {view.unmatched.length > 0 && (
            <Card title="En NÚCLEO pero no en la cartola" subtitle="Cobros, pagos o traspasos registrados en esta cuenta, dentro de las fechas de la cartola, que el banco no muestra. Revisa la cuenta o la fecha con que se registraron.">
              <ul className="flex flex-col divide-y divide-line text-sm">
                {view.unmatched.map((m, i) => (
                  <li key={i} className="flex items-center gap-3 py-2">
                    <span className="num w-24 text-muted">{formatDate(m.date)}</span>
                    <span className="font-mono text-[12.5px] text-ink">{m.document}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{m.detail}</span>
                    <span className={cx("num font-medium", m.amount_minor > 0 ? "text-success" : "text-ink")}>{m.amount_minor > 0 ? "+" : "−"}{formatMoney(Math.abs(m.amount_minor))}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {view.statements.length > 0 && (
            <Card title="Cartolas subidas" padded={false}>
              <ul className="divide-y divide-line text-sm">
                {view.statements.map((s) => (
                  <li key={s.uid} className="flex items-center gap-3 px-5 py-2.5">
                    <FileUp size={16} className="text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-ink">{s.file_name ?? "Cartola"}<span className="ml-2 text-muted">{formatDate(s.period_from)} al {formatDate(s.period_to)} · {s.lines} movimientos nuevos</span></span>
                    {write && <Button size="sm" variant="ghost" icon={Trash2} onClick={async () => { try { await backend.deleteBankStatement(s.uid); toast("success", "Cartola eliminada. Lo que registraste desde ella se mantiene."); load(); } catch (e) { toast("danger", errorMessage(e)); } }}>Eliminar</Button>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Dialog open={preview !== null} onClose={() => setPreview(null)} title="Revisa la cartola antes de subirla" size="lg"
        footer={<><Button variant="ghost" onClick={() => setPreview(null)}>Cancelar</Button><Button icon={Upload} onClick={doImport} disabled={busy}>{busy ? "Subiendo…" : `Subir ${preview?.parsed.lines.length ?? 0} movimientos`}</Button></>}>
        {preview && (() => {
          const ins = preview.parsed.lines.filter((l) => l.amount_minor > 0), outs = preview.parsed.lines.filter((l) => l.amount_minor < 0);
          const dates = preview.parsed.lines.map((l) => l.date).sort();
          return (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted"><strong className="text-ink">{preview.file}</strong> · del {formatDate(dates[0])} al {formatDate(dates.at(-1))} · columnas reconocidas: {preview.parsed.columns.join(", ")}.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-surface-2 px-3 py-2"><div className="text-xs text-muted">Abonos (entra dinero)</div><div className="num font-semibold text-success">{ins.length} · {formatMoney(ins.reduce((a, l) => a + l.amount_minor, 0))}</div></div>
                <div className="rounded-lg bg-surface-2 px-3 py-2"><div className="text-xs text-muted">Cargos (sale dinero)</div><div className="num font-semibold text-ink">{outs.length} · {formatMoney(-outs.reduce((a, l) => a + l.amount_minor, 0))}</div></div>
              </div>
              {preview.parsed.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
              <div className="max-h-64 overflow-auto rounded-lg border border-line">
                <table className="w-full text-[13px]">
                  <tbody>
                    {preview.parsed.lines.slice(0, 12).map((l, i) => (
                      <tr key={i} className="border-b border-line last:border-0"><td className="num whitespace-nowrap px-3 py-1.5 text-muted">{formatDate(l.date)}</td><td className="px-2 text-ink">{l.description}</td><td className={cx("num whitespace-nowrap px-3 text-right", l.amount_minor > 0 ? "text-success" : "")}>{l.amount_minor > 0 ? "+" : "−"}{formatMoney(Math.abs(l.amount_minor))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.parsed.lines.length > 12 && <p className="text-xs text-muted">Y {preview.parsed.lines.length - 12} más. Los movimientos que ya subiste antes no se duplican.</p>}
            </div>
          );
        })()}
      </Dialog>

      <LineDrawer line={open} cats={cats} accounts={accounts.filter((a) => a.uid !== acc)} onClose={() => setOpen(null)} onAct={(a, ok) => open && void act(open, a, ok)} />
    </div>
  );
}

function short(s: BankSuggestion): string {
  switch (s.action) {
    case "vincular": case "vincular_traspaso": return "Conciliar";
    case "cobrar": return "Registrar cobro";
    case "pagar_compra": case "pagar_gasto": return "Registrar pago";
    case "gasto": return s.category ? `Gasto: ${s.category}` : "Registrar gasto";
    case "traspaso": return "Registrar traspaso";
    default: return "Aplicar";
  }
}

function LineDrawer({ line, cats, accounts, onClose, onAct }: { line: StatementLineView | null; cats: ExpenseCategory[]; accounts: MoneyAccount[]; onClose: () => void; onAct: (a: ReconcileAction, ok: string) => void }) {
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [taxIncl, setTaxIncl] = useState(false);
  const [note, setNote] = useState("");
  const [other, setOther] = useState("");
  useEffect(() => {
    if (!line) return;
    const g = line.suggestions.find((s) => s.action === "gasto");
    setCat(g?.category_id ? String(g.category_id) : ""); setDesc(line.description.slice(0, 120)); setTaxIncl(false); setNote(""); setOther(line.suggestions.find((s) => s.action === "traspaso")?.target_uid ?? accounts[0]?.uid ?? "");
  }, [line, accounts]);
  if (!line) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>;
  const out = line.amount_minor < 0;
  const groups = [...new Set(cats.filter((c) => !c.archived).map((c) => c.group_name))].sort();
  return (
    <Drawer open={line !== null} onClose={onClose} title={`${out ? "Cargo" : "Abono"} de ${formatMoney(Math.abs(line.amount_minor))}`} subtitle={`${formatDate(line.date)} · ${line.description}`}>
      <div className="flex flex-col gap-5">
        {line.suggestions.filter((s) => s.action !== "gasto" && s.action !== "traspaso").length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Coincidencias</h3>
            <ul className="flex flex-col gap-2">
              {line.suggestions.filter((s) => s.action !== "gasto" && s.action !== "traspaso").map((s, i) => (
                <li key={i} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-ink">{s.label}</div><div className="text-xs text-muted">{s.detail}</div></div>
                  <Button size="sm" onClick={() => onAct({ kind: s.action, target_uid: s.target_uid }, s.action.startsWith("vincular") ? "Movimiento conciliado." : "Registrado y conciliado.")}>{short(s)}</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {out && (
          <section className="rounded-lg border border-line p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Registrar como gasto pagado desde esta cuenta</h3>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">Categoría
                <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-ctl rounded-lg border border-line-strong bg-surface px-3 text-sm font-normal">
                  <option value="">Elige una categoría…</option>
                  {groups.map((g) => <optgroup key={g} label={g}>{cats.filter((c) => c.group_name === g && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
                </select>
              </label>
              <Field label="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={120} />
              <Checkbox label="El monto incluye IVA" checked={taxIncl} onChange={setTaxIncl} hint="Si tienes la factura del gasto, el IVA se separa como crédito." />
              <div><Button disabled={!cat} onClick={() => onAct({ kind: "gasto", category_id: Number(cat), description: desc, tax_included: taxIncl }, "Gasto registrado y conciliado.")}>Registrar gasto</Button></div>
            </div>
          </section>
        )}
        {accounts.length > 0 && (
          <section className="rounded-lg border border-line p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">{out ? "Traspaso a otra cuenta tuya" : "Traspaso desde otra cuenta tuya"}</h3>
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Cuenta" value={other} onChange={(e) => setOther(e.target.value)} className="w-64" options={accounts.map((a) => ({ value: a.uid, label: a.name }))} />
              <Button variant="secondary" disabled={!other} onClick={() => onAct({ kind: "traspaso", target_uid: other }, "Traspaso registrado y conciliado.")}>Registrar traspaso</Button>
            </div>
          </section>
        )}
        <section className="rounded-lg border border-line p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">No corresponde registrarlo</h3>
          <p className="mb-3 text-xs text-muted">Por ejemplo: un aporte o retiro del dueño, un préstamo, o un movimiento de otra empresa. Queda anotado con tu nota.</p>
          <TextArea label="Nota" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ej. retiro del dueño" />
          <div className="mt-3"><Button variant="ghost" icon={EyeOff} disabled={!note.trim()} onClick={() => onAct({ kind: "ignorar", note }, "Movimiento ignorado.")}>Ignorar con esta nota</Button></div>
        </section>
      </div>
    </Drawer>
  );
}
