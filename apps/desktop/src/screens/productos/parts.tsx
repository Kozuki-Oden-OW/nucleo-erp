// Piezas de la ficha de producto: precio neto o con IVA, costo avanzado y categorías.
import { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type CurrencyRow, type Product, type ProductCategory } from "../../data";
import { computeCostSheet, costSheetUsed, EMPTY_COST_SHEET, grossFromNet, netFromGross, type CostSheet } from "../../data/costing";
import { CURRENCY_DIGITS, formatMoney, formatPpm, formatQty, parseQty } from "../../lib/format";
import { usePrefs } from "../../lib/prefs";
import { MoneyField } from "../../ui/doc";
import { Button, Checkbox, EmptyState, Field, Notice, Segmented, Select, cx } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";

/** Tasa de IVA vigente del negocio (null si no calcula impuesto). */
export function useTaxPpm(): { taxPpm: number | null; biz: BusinessSettings | null } {
  const backend = useBackend();
  const [biz, setBiz] = useState<BusinessSettings | null>(null);
  useEffect(() => { backend.business().then(setBiz).catch(() => setBiz(null)); }, [backend]);
  return { taxPpm: biz?.tax_enabled ? biz.tax_rate_ppm : null, biz };
}

/* ───────────── Precio neto o con IVA ───────────── */

/**
 * Precio de venta: la persona elige si lo escribe neto o con IVA; siempre se entrega neto.
 * Muestra el desglose (neto, IVA y precio con IVA).
 */
export function PriceInput({ net, onNet, taxPpm, taxable, label = "Precio de venta" }: {
  net: number | null; onNet: (v: number | null) => void; taxPpm: number | null; taxable: boolean; label?: string;
}) {
  const { prefs, set } = usePrefs();
  const withTax = taxPpm !== null && taxable;
  const mode = withTax ? prefs.priceEntry : "neto";
  const [typed, setTyped] = useState<number | null>(() => (net === null ? null : mode === "con_iva" ? grossFromNet(net, taxPpm) : net));
  // Si cambia el modo o la tasa, el campo muestra el mismo precio en el nuevo modo.
  useEffect(() => { setTyped(net === null ? null : mode === "con_iva" ? grossFromNet(net, taxPpm) : net); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, taxPpm]);
  function change(v: number | null) {
    setTyped(v);
    onNet(v === null ? null : mode === "con_iva" ? netFromGross(v, taxPpm) : v);
  }
  const gross = net !== null && withTax ? grossFromNet(net, taxPpm) : null;
  return (
    <div className="flex flex-col gap-2">
      {withTax && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">{label}</span>
          <Segmented label="Cómo escribes el precio" value={mode} onChange={(v) => set({ priceEntry: v })}
            options={[{ value: "neto", label: "Neto" }, { value: "con_iva", label: "Con IVA" }]} />
        </div>
      )}
      <MoneyField label={withTax ? undefined : label} aria-label={label} value={typed} onValue={change}
        hint={mode === "con_iva" ? "Escribe el precio final que paga el cliente; NÚCLEO guarda el neto." : withTax ? "Precio sin IVA." : undefined} />
      {net !== null && net > 0 && withTax && gross !== null && (
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <div><div className="text-muted">Neto</div><div className="num font-medium text-ink">{formatMoney(net)}</div></div>
          <div><div className="text-muted">IVA ({formatPpm(taxPpm!, 0)})</div><div className="num text-ink">{formatMoney(gross - net)}</div></div>
          <div><div className="text-muted">Con IVA</div><div className="num font-medium text-ink">{formatMoney(gross)}</div></div>
        </div>
      )}
      {mode === "con_iva" && typed !== null && gross !== null && gross !== typed && (
        <p className="text-xs text-warning">Con el redondeo del neto a peso, el precio con IVA queda en {formatMoney(gross)}.</p>
      )}
    </div>
  );
}

/* ───────────── Costo avanzado ───────────── */

function parseRate(text: string): number | null {
  const clean = text.trim().replace(/\./g, "").replace(",", ".");
  if (clean === "" || !/^\d+(\.\d{1,6})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 1_000_000);
}
const rateText = (e6: number) => (e6 ? String(e6 / 1_000_000).replace(".", ",") : "");

/**
 * Calculadora de costo: compra en pesos u otra moneda con su tipo de cambio, transporte, envío,
 * mano de obra y otros (todo opcional), repartido entre las unidades del lote.
 */
export function CostCalculator({ sheet, onSheet, taxPpm, unit }: {
  sheet: CostSheet; onSheet: (s: CostSheet) => void; taxPpm: number | null; unit: string;
}) {
  const backend = useBackend();
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [rate, setRate] = useState(rateText(sheet.fx_rate_e6));
  const [units, setUnits] = useState(formatQty(sheet.units_milli || 1000));
  useEffect(() => { backend.currencies().then(setCurrencies).catch(() => setCurrencies([])); }, [backend]);
  const r = useMemo(() => computeCostSheet(sheet, taxPpm), [sheet, taxPpm]);
  const foreign = sheet.currency !== "CLP";
  const put = (patch: Partial<CostSheet>) => onSheet({ ...sheet, ...patch });
  function pickCurrency(code: string) {
    const c = currencies.find((x) => x.code === code);
    const e6 = code === "CLP" ? 0 : c?.last_rate_e6 ?? 0;
    setRate(rateText(e6));
    put({ currency: code, currency_digits: code === "CLP" ? 0 : c?.decimals ?? CURRENCY_DIGITS[code] ?? 2, fx_rate_e6: e6, purchase_minor: 0 });
  }
  const options = [{ value: "CLP", label: "CLP · Peso chileno" }, ...currencies.filter((c) => c.code !== "CLP").map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))];
  if (!options.some((o) => o.value === sheet.currency)) options.push({ value: sheet.currency, label: sheet.currency });
  const line = (label: string, v: number) => v > 0 && (
    <div className="flex justify-between"><dt className="text-muted">{label}</dt><dd className="num text-ink">{formatMoney(v)}</dd></div>
  );
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <Select label="Moneda de compra" value={sheet.currency} onChange={(e) => pickCurrency(e.target.value)} options={options} />
        <MoneyField key={sheet.currency} label="Valor de compra" currency={sheet.currency} value={sheet.purchase_minor || null}
          onValue={(v) => put({ purchase_minor: v ?? 0 })} hint={foreign ? "Del lote completo" : "Del lote completo, en pesos"} />
      </div>
      {foreign && (
        <Field label={`Tipo de cambio (pesos por 1 ${sheet.currency})`} inputMode="decimal" value={rate} className="max-w-[16rem]" inputClassName="text-right num"
          onChange={(e) => { setRate(e.target.value); put({ fx_rate_e6: parseRate(e.target.value) ?? 0 }); }}
          hint={currencies.find((c) => c.code === sheet.currency)?.last_rate_date ? "Sugerido desde Configuración → Monedas; puedes cambiarlo." : "Anótalo del día de la compra."} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Transporte o flete" value={sheet.freight_minor || null} onValue={(v) => put({ freight_minor: v ?? 0 })} />
        <MoneyField label="Envío o despacho" value={sheet.shipping_minor || null} onValue={(v) => put({ shipping_minor: v ?? 0 })} />
        <MoneyField label="Mano de obra" value={sheet.labor_minor || null} onValue={(v) => put({ labor_minor: v ?? 0 })} hint="Armado, fabricación, horas" />
        <MoneyField label="Otros" value={sheet.other_minor || null} onValue={(v) => put({ other_minor: v ?? 0 })} hint="Embalaje, comisiones, aduana…" />
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label="Unidades de este lote" inputMode="decimal" value={units} suffix={unit} inputClassName="text-right num"
          onChange={(e) => { setUnits(e.target.value); put({ units_milli: parseQty(e.target.value) ?? 0 }); }}
          hint="Los montos se reparten entre ellas" />
        {taxPpm !== null && (
          <Checkbox label="Los montos en pesos incluyen IVA" hint="Se llevan a neto (la mano de obra no lleva IVA)." checked={sheet.pesos_include_tax}
            onChange={(v) => put({ pesos_include_tax: v })} />
        )}
      </div>
      {costSheetUsed(sheet) && (
        <dl className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
          {line(foreign ? `Compra en pesos (${sheet.currency})` : "Compra", r.purchase_clp)}
          {line("Transporte", r.freight)}
          {line("Envío", r.shipping)}
          {line("Mano de obra", r.labor)}
          {line("Otros", r.other)}
          <div className="flex justify-between border-t border-line pt-1"><dt className="text-muted">Total del lote</dt><dd className="num font-medium text-ink">{formatMoney(r.total)}</dd></div>
          <div className="flex justify-between text-[15px]"><dt className="font-semibold text-ink">Costo por {unit}</dt><dd className="num font-semibold text-ink">{formatMoney(r.unit_cost)}</dd></div>
        </dl>
      )}
      {r.notes.map((n) => <Notice key={n} tone="warning">{n}</Notice>)}
    </div>
  );
}

/**
 * Costo del producto: un monto simple o, en «avanzado», la calculadora. Devuelve el costo en
 * pesos y la hoja (si se usó).
 */
export function CostInput({ cost, onCost, sheet, onSheet, taxPpm, unit, disabled, disabledText }: {
  cost: number | null; onCost: (v: number | null) => void; sheet: CostSheet | null; onSheet: (s: CostSheet | null) => void;
  taxPpm: number | null; unit: string; disabled?: boolean; disabledText?: string;
}) {
  const [open, setOpen] = useState(costSheetUsed(sheet));
  const advanced = open && sheet !== null;
  function toggle() {
    if (open) { setOpen(false); onSheet(null); }
    else { setOpen(true); onSheet(sheet ?? { ...EMPTY_COST_SHEET }); }
  }
  useEffect(() => {
    if (advanced && costSheetUsed(sheet)) onCost(computeCostSheet(sheet!, taxPpm).unit_cost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, taxPpm, advanced]);
  return (
    <div className="flex flex-col gap-2">
      <MoneyField label="Costo" value={cost} onValue={onCost} disabled={disabled || advanced}
        hint={disabled ? disabledText : advanced ? "Calculado con el costo avanzado" : "Lo que te cuesta a ti, sin IVA si lo recuperas"} />
      {!disabled && (
        <button type="button" onClick={toggle} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-accent hover:underline">
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <Calculator size={14} aria-hidden /> Costo avanzado (dólar, transporte, mano de obra…)
        </button>
      )}
      {advanced && <CostCalculator sheet={sheet!} onSheet={onSheet} taxPpm={taxPpm} unit={unit} />}
    </div>
  );
}

/* ───────────── Categorías ───────────── */

export function CategorySelect({ value, onChange, categories, onManage }: {
  value: string | null; onChange: (v: string | null) => void; categories: ProductCategory[]; onManage?: () => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <Select label="Categoría" optional className="flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
        options={[{ value: "", label: "Sin categoría" }, ...categories.map((c) => ({ value: c.uid, label: c.name }))]} />
      {onManage && <Button variant="ghost" size="sm" icon={Tags} onClick={onManage}>Categorías</Button>}
    </div>
  );
}

/** Administrar categorías: crear, renombrar, eliminar y agregar productos. */
export function CategoriesDrawer({ open, onClose, categories, onChanged, products }: {
  open: boolean; onClose: () => void; categories: ProductCategory[]; onChanged: (c: ProductCategory[]) => void; products: Product[];
}) {
  const backend = useBackend();
  const toast = useToast();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<ProductCategory | null>(null);
  const [adding, setAdding] = useState<ProductCategory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(""); setEditing(null); setErr(null); } }, [open]);
  async function run(p: Promise<ProductCategory[]>, ok: string) {
    try { onChanged(await p); toast("success", ok); setErr(null); return true; } catch (e) { setErr(errorMessage(e)); return false; }
  }
  return (
    <Drawer open={open} onClose={onClose} title="Categorías de productos" subtitle="Agrupa tus productos para buscarlos, filtrarlos y ver reportes por categoría.">
      <div className="flex flex-col gap-4">
        <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(backend.saveCategory(null, name), `Categoría «${name.trim()}» creada.`)) setName(""); }}>
          <Field label="Nueva categoría" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Sensores de temperatura" />
          <Button type="submit" icon={FolderPlus} disabled={!name.trim()}>Crear</Button>
        </form>
        {err && <Notice tone="danger">{err}</Notice>}
        {categories.length === 0 ? <EmptyState icon={Tags} title="Aún no tienes categorías" /> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {categories.map((c) => (
              <li key={c.uid} className="flex items-center gap-2 px-3 py-2">
                {editing === c.uid ? (
                  <form className="flex flex-1 items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(backend.saveCategory(c.uid, editName), "Categoría renombrada.")) setEditing(null); }}>
                    <Field aria-label="Nombre de la categoría" className="flex-1" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                    <Button type="submit" size="sm" disabled={!editName.trim()}>Guardar</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                  </form>
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate font-medium text-ink" title={c.name}>{c.name}</span>
                      <span className="text-xs text-muted">{c.product_count} {c.product_count === 1 ? "producto" : "productos"}</span>
                    </span>
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(c)}>Agregar</Button>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label={`Renombrar ${c.name}`} onClick={() => { setEditing(c.uid); setEditName(c.name); }} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Eliminar ${c.name}`} onClick={() => setDeleting(c)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} size="sm" title="Eliminar categoría"
        footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" onClick={async () => { if (deleting && await run(backend.deleteCategory(deleting.uid), "Categoría eliminada.")) setDeleting(null); }}>Eliminar</Button></>}>
        <p className="text-sm text-ink">
          ¿Eliminar «{deleting?.name}»?{deleting && deleting.product_count > 0 ? ` Sus ${deleting.product_count} productos quedan sin categoría; no se borra ningún producto.` : ""}
        </p>
      </Dialog>
      {adding && (
        <AssignProducts category={adding} products={products} onClose={() => setAdding(null)}
          onSave={async (uids) => { if (await run(backend.assignCategory(uids, adding.uid), `${uids.length} ${uids.length === 1 ? "producto agregado" : "productos agregados"} a «${adding.name}».`)) setAdding(null); }} />
      )}
    </Drawer>
  );
}

function AssignProducts({ category, products, onClose, onSave }: {
  category: ProductCategory; products: Product[]; onClose: () => void; onSave: (uids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [onlyFree, setOnlyFree] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = useMemo(() => {
    const words = q.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/\s+/).filter(Boolean);
    return products.filter((p) => p.category_uid !== category.uid && (!onlyFree || !p.category_uid)
      && words.every((w) => `${p.name} ${p.sku}`.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").includes(w)));
  }, [products, q, onlyFree, category.uid]);
  const toggle = (u: string) => setPicked((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  return (
    <Dialog open onClose={onClose} size="lg" title={`Agregar productos a «${category.name}»`}
      footer={<><span className="mr-auto text-sm text-muted">{picked.size} elegidos</span><Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => onSave([...picked])} disabled={picked.size === 0}>Agregar</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field aria-label="Buscar productos" className="min-w-[14rem] flex-1" placeholder="Nombre o código" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <Checkbox label="Solo productos sin categoría" checked={onlyFree} onChange={setOnlyFree} />
        </div>
        <div className="flex gap-2 text-[13px]">
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setPicked(new Set([...picked, ...list.map((p) => p.uid)]))}>Elegir todos ({list.length})</button>
          {picked.size > 0 && <button type="button" className="text-muted hover:underline" onClick={() => setPicked(new Set())}>Quitar selección</button>}
        </div>
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No hay productos para agregar con este filtro.</li>}
          {list.map((p) => (
            <li key={p.uid}>
              <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2", picked.has(p.uid) && "bg-accent-soft")}>
                <input type="checkbox" checked={picked.has(p.uid)} onChange={() => toggle(p.uid)} className="h-4 w-4 accent-[var(--accent)]" />
                <span className="w-20 shrink-0 font-mono text-[12px] text-muted">{p.sku}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                {p.category && <span className="truncate text-xs text-muted">{p.category}</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
