// Ficha de inventario de un producto: stock por bodega, análisis explicado, parámetros de reposición y kárdex.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Lightbulb, Save } from "lucide-react";
import { useBackend, errorMessage, type KardexRow, type ProductInventory } from "../../data";
import { formatDate, formatMoney, formatQty, parseQty } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, Card, DefinitionList, Field, Notice, PageHeader, Select, Spinner } from "../../ui/kit";
import { useToast } from "../../ui/overlay";
import { StockStatusBadge } from "./Inventory";

const KIND: Record<KardexRow["kind"], string> = {
  entrada: "Compra", salida: "Venta", ajuste: "Ajuste", transferencia_entrada: "Transferencia (entra)", transferencia_salida: "Transferencia (sale)", inicial: "Inicial",
};

export function ProductStock({ uid }: { uid: string }) {
  const backend = useBackend();
  const { can } = useSession();
  const [d, setD] = useState<ProductInventory | null>(null);
  const [wh, setWh] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { backend.productInventory(uid, wh || undefined).then(setD).catch((e) => setErr(errorMessage(e))); }, [backend, uid, wh]);
  useEffect(load, [load]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d) return <Spinner />;
  const a = d.analysis;
  const p = d.product;
  const costs = can("costos.ver");
  const docHref = (k: KardexRow) => {
    if (!k.source_uid) return null;
    if (k.source_type === "VEN" || k.source_type === "FV") return `/ventas/${k.source_uid}`;
    if (k.source_type === "OC") return `/compras/oc/${k.source_uid}`;
    if (k.source_type === "COM") return `/compras/doc/${k.source_uid}`;
    if (k.source_type === "IMP") return `/comex/importacion/${k.source_uid}`;
    return null;
  };

  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/inventario")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Inventario</button>}
        title={<span className="flex flex-wrap items-center gap-3">{p.name}{a && <StockStatusBadge status={a.status} />}</span>}
        subtitle={`${p.sku} · stock total ${formatQty(p.on_hand_milli)} ${p.unit}${costs ? ` · costo promedio ${formatMoney(Math.round(p.cost_e4 / 10_000))}` : ""}`}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {a && (
            <Card title="Análisis">
              <div className="grid gap-4 sm:grid-cols-4">
                <Metric label="Vende por día" value={a.velocity_milli !== null ? `${formatQty(a.velocity_milli)} ${p.unit}` : "—"} hint={`${formatQty(a.sold_milli)} en ${a.days_with_stock} días con stock`} />
                <Metric label="Alcanza para" value={a.coverage_days !== null ? `${a.coverage_days} días` : "—"} />
                <Metric label="Por llegar" value={a.in_purchase_milli ? `${formatQty(a.in_purchase_milli)} ${p.unit}` : "—"} hint={a.next_arrival ? `Próxima llegada ${formatDate(a.next_arrival)}` : undefined} />
                <Metric label="Último movimiento" value={formatDate(a.last_movement)} />
              </div>
              <div className={`mt-4 flex gap-3 rounded-lg px-4 py-3 text-sm ${a.advice.kind === "comprar" ? "bg-accent-soft" : "bg-surface-2"}`}>
                <Lightbulb size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <div>
                  <div className="font-semibold text-ink">
                    {a.advice.kind === "comprar" ? `Sugerencia: comprar ${formatQty(a.advice.quantity_milli ?? 0)} ${p.unit}` : a.advice.kind === "no_comprar" ? "No necesitas comprar todavía" : a.advice.kind === "exceso" ? "Tienes más stock del necesario" : "Aún no hay datos suficientes"}
                  </div>
                  <div className="mt-0.5 text-muted">{a.advice.explanation}</div>
                  {a.advice.kind === "comprar" && can("compras.crear") && <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate("/compras/oc/nueva")}>Crear orden de compra</Button>}
                </div>
              </div>
            </Card>
          )}
          <Card title="Kárdex" subtitle="Todos los movimientos del producto, del más reciente al más antiguo." padded={false}
            actions={d.by_warehouse.length > 1 && <Select aria-label="Bodega" value={wh} onChange={(e) => setWh(e.target.value)} options={[{ value: "", label: "Todas las bodegas" }, ...d.by_warehouse.map((b) => ({ value: b.warehouse_uid, label: b.warehouse_name }))]} />}>
            {d.kardex.length === 0 ? <p className="p-5 text-sm text-muted">Sin movimientos.</p> : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5">Fecha</th><th className="px-2">Movimiento</th><th className="px-2">Documento</th>{d.by_warehouse.length > 1 && !wh && <th className="px-2">Bodega</th>}
                    <th className="px-2 text-right">Cantidad</th>{costs && <th className="px-2 text-right">Costo</th>}<th className="px-4 text-right">Saldo</th>
                  </tr></thead>
                  <tbody>
                    {d.kardex.map((k) => {
                      const href = docHref(k);
                      return (
                        <tr key={k.id} className="border-b border-line last:border-0" title={k.reason ?? undefined}>
                          <td className="num whitespace-nowrap px-4 py-2 text-muted">{formatDate(k.date)}</td>
                          <td className="whitespace-nowrap px-2 text-ink">{k.source_type === "IMP" && k.kind === "entrada" ? "Importación" : KIND[k.kind]}{k.reason && k.kind === "ajuste" && <div className="max-w-[16rem] truncate text-xs text-muted">{k.reason}</div>}</td>
                          <td className="px-2">{href ? <button className="font-mono text-[12.5px] text-accent hover:underline" onClick={() => navigate(href)}>{k.document}</button> : <span className="whitespace-nowrap font-mono text-[12.5px] text-muted">{k.document}</span>}</td>
                          {d.by_warehouse.length > 1 && !wh && <td className="whitespace-nowrap px-2 text-muted">{k.warehouse_name}</td>}
                          <td className={`num px-2 text-right font-medium ${k.qty_milli > 0 ? "text-success" : "text-danger"}`}>{k.qty_milli > 0 ? "+" : "−"}{formatQty(Math.abs(k.qty_milli))}</td>
                          {costs && <td className="num px-2 text-right text-muted">{formatMoney(Math.round(k.unit_cost_e4 / 10_000))}</td>}
                          <td className="num px-4 text-right">{formatQty(k.balance_milli)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          <Card title="Stock por bodega">
            <DefinitionList items={d.by_warehouse.map((b) => ({ label: b.warehouse_name, value: <span className={`num ${b.on_hand_milli < 0 ? "text-danger" : ""}`}>{formatQty(b.on_hand_milli)} {p.unit}</span> }))} />
          </Card>
          {a && <ReorderCard d={d} onSaved={setD} />}
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-1 text-[18px] font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function ReorderCard({ d, onSaved }: { d: ProductInventory; onSaved: (d: ProductInventory) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const s = d.settings;
  const [f, setF] = useState({
    min: d.product.min_milli ? formatQty(d.product.min_milli) : "",
    lead: s.lead_time_days === null ? "" : String(s.lead_time_days),
    safety: String(s.safety_days), target: String(s.target_coverage_days), excess: String(s.excess_coverage_days),
  });
  const editable = can("inventario.ajustar");
  async function save() {
    const min = f.min.trim() ? parseQty(f.min) : 0;
    if (min === null) { toast("danger", "Revisa el stock mínimo."); return; }
    try {
      onSaved(await backend.updateReorderSettings(d.product.uid, {
        min_milli: min, lead_time_days: f.lead.trim() ? Number(f.lead) : null,
        safety_days: Number(f.safety) || 0, target_coverage_days: Number(f.target) || 0, excess_coverage_days: Number(f.excess) || 1,
      }));
      toast("success", "Parámetros guardados.");
    } catch (e) { toast("danger", errorMessage(e)); }
  }
  const num = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} inputMode="numeric" value={f[k]} disabled={!editable} suffix={k === "min" ? d.product.unit : "días"} hint={hint}
      onChange={(e) => setF({ ...f, [k]: k === "min" ? e.target.value : e.target.value.replace(/\D/g, "") })} inputClassName="text-right num" />
  );
  return (
    <Card title="Reposición" subtitle="Con estos datos NÚCLEO calcula cuándo y cuánto comprar.">
      <div className="flex flex-col gap-3">
        {num("min", "Stock mínimo", "Bajo esta cantidad se marca “Bajo el mínimo”.")}
        {num("lead", "Plazo del proveedor", "Días desde que pides hasta que llega (vacío = 7).")}
        <div className="grid grid-cols-2 gap-3">
          {num("safety", "Seguridad")}
          {num("target", "Cobertura objetivo")}
        </div>
        {num("excess", "Exceso sobre", "Más días de cobertura que esto se considera exceso.")}
        {editable && <Button icon={Save} variant="secondary" onClick={save}>Guardar</Button>}
      </div>
    </Card>
  );
}
