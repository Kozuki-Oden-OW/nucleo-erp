// Piezas de la ficha de producto: precio neto o con IVA, costo avanzado y categorías.
import { useEffect, useMemo, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Star, Tags, Trash2, X } from "lucide-react";
import { useBackend, errorMessage, type BusinessSettings, type CurrencyRow, type Product, type ProductCategory, type StockPolicy } from "../../data";
import { computeCostSheet, costSheetUsed, EMPTY_COST_SHEET, grossFromNet, netFromGross, type CostSheet } from "../../data/costing";
import { CURRENCY_DIGITS, formatMoney, formatPpm, formatQty, parseQty } from "../../lib/format";
import { MoneyField } from "../../ui/doc";
import { Button, Checkbox, EmptyState, Field, Notice, Select, cx } from "../../ui/kit";
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
 * Precio de venta: dos campos enlazados, «con IVA» y «neto». Al escribir uno, el otro se calcula con la
 * tasa de IVA del negocio. Siempre se guarda el neto.
 */
export function PriceInput({ net, onNet, taxPpm, taxable, label = "Precio de venta" }: {
  net: number | null; onNet: (v: number | null) => void; taxPpm: number | null; taxable: boolean; label?: string;
}) {
  const withTax = taxPpm !== null && taxable;
  const gross = net !== null && withTax ? grossFromNet(net, taxPpm) : null;
  if (!withTax) {
    return <MoneyField label={taxPpm !== null ? `${label} (exento de IVA)` : label} value={net} onValue={onNet} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField label={`${label} (Con IVA)`} value={gross} onValue={(v) => onNet(v === null ? null : netFromGross(v, taxPpm))}
          hint="Lo que paga el cliente." />
        <MoneyField label="Precio neto (sin IVA)" value={net} onValue={onNet} hint="Se calcula solo; también puedes escribirlo." />
      </div>
      {net !== null && net > 0 && gross !== null && (
        <p className="num text-xs text-muted">Neto {formatMoney(net)} + IVA {formatPpm(taxPpm!, 0)} {formatMoney(gross - net)} = <strong className="text-ink">{formatMoney(gross)}</strong></p>
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

/**
 * Categorías del producto: puede estar en varias (ej. «Ropa» y «One Piece»). La primera es la
 * principal, con la que se agrupan los reportes por categoría.
 */
export function CategoriesField({ main, extras, onChange, categories, onManage }: {
  main: string | null; extras: string[]; onChange: (main: string | null, extras: string[]) => void; categories: ProductCategory[]; onManage?: () => void;
}) {
  const chosen = [main, ...extras].filter((u): u is string => !!u);
  const name = (u: string) => categories.find((c) => c.uid === u)?.name ?? "—";
  const free = categories.filter((c) => !chosen.includes(c.uid));
  const add = (u: string) => (main ? onChange(main, [...extras, u]) : onChange(u, extras));
  const remove = (u: string) => {
    if (u === main) onChange(extras[0] ?? null, extras.slice(1));
    else onChange(main, extras.filter((x) => x !== u));
  };
  const makeMain = (u: string) => onChange(u, [main, ...extras].filter((x): x is string => !!x && x !== u));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">Categorías <span className="font-normal text-muted">(opcional, puede tener varias)</span></span>
        {onManage && <Button variant="ghost" size="sm" icon={Tags} onClick={onManage}>Administrar</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chosen.map((u) => (
          <span key={u} className={cx("inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 text-sm",
            u === main ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface-2 text-ink")}>
            {u === main ? <span className="inline-flex items-center gap-1"><Star size={12} className="fill-current" aria-hidden />{name(u)}</span>
              : <button type="button" className="hover:underline" title="Hacerla principal" onClick={() => makeMain(u)}>{name(u)}</button>}
            <button type="button" aria-label={`Quitar ${name(u)}`} className="rounded-full p-1 hover:bg-surface-3" onClick={() => remove(u)}><X size={12} /></button>
          </span>
        ))}
        {free.length > 0 && (
          <select aria-label="Agregar categoría" value="" onChange={(e) => e.target.value && add(e.target.value)}
            className="h-8 rounded-full border border-dashed border-line-strong bg-transparent px-3 text-sm text-muted hover:border-accent hover:text-accent">
            <option value="">+ Agregar categoría</option>
            {free.map((c) => <option key={c.uid} value={c.uid}>{c.name}</option>)}
          </select>
        )}
        {categories.length === 0 && <span className="text-sm text-muted">Aún no tienes categorías.</span>}
      </div>
      {chosen.length > 1 && <span className="text-xs text-muted">★ Principal: se usa en los reportes por categoría. Toca otra para hacerla principal.</span>}
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
          ¿Eliminar «{deleting?.name}»?{deleting && deleting.product_count > 0 ? ` Sus ${deleting.product_count} productos dejan de estar en ella (si tienen otra categoría, esa pasa a ser la principal); no se borra ningún producto.` : ""}
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
    return products.filter((p) => p.category_uid !== category.uid && !p.extra_category_uids.includes(category.uid) && (!onlyFree || !p.category_uid)
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
                {p.category && <span className="truncate text-xs text-muted">{[p.category, ...p.extra_categories].join(" · ")}</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

export const STOCK_POLICY_OPTIONS: { value: StockPolicy; label: string; hint: string }[] = [
  { value: "general", label: "Usar la regla del negocio", hint: "Sigue lo que elegiste en Inventario: permitir o no vender sin stock." },
  { value: "bloquear", label: "No vender sin stock", hint: "Solo se vende lo que hay en bodega." },
  { value: "vender", label: "Vender igual (sin stock)", hint: "Se vende aunque no haya; el stock queda en negativo hasta que compres." },
  { value: "reservar", label: "Tomar reservas", hint: "La venta aparta lo que hay y deja pendiente lo que falta. El stock se descuenta al despachar (Inventario → Por despachar)." },
];
export const stockPolicyLabel = (p: StockPolicy) => STOCK_POLICY_OPTIONS.find((o) => o.value === p)?.label ?? p;

/** Qué hacer cuando el producto no tiene stock. */
export function StockPolicySelect({ value, onChange }: { value: StockPolicy; onChange: (v: StockPolicy) => void }) {
  return (
    <Select label="Si no hay stock" value={value} onChange={(e) => onChange(e.target.value as StockPolicy)}
      options={STOCK_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      hint={STOCK_POLICY_OPTIONS.find((o) => o.value === value)?.hint} />
  );
}
