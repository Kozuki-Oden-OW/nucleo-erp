// Descuentos y promociones: packs a precio fijo o con %, descuento por cantidad (tramos), lleva X
// paga Y, por cliente y para clientes preferenciales. Se aplican al vender («Aplicar promociones»).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgePercent, CalendarClock, Crown, Layers, Package, Pause, Pencil, Play, Plus, Trash2, UserCheck, X } from "lucide-react";
import { useBackend, errorMessage, type Customer, type Product, type ProductCategory, type Promotion, type PromoKind, type PromoRule, type PromoStatus } from "../../data";
import { EMPTY_RULE, PROMO_KIND_HINT, PROMO_KIND_LABEL, packMargin } from "../../data/promos";
import { formatDate, formatMoney, formatPpm, formatQty, parseQty } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Notice, PageHeader, Segmented, Select, Spinner, Tabs, TextArea, type Tone } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";
import { PriceInput, useTaxPpm } from "../productos/parts";
import { CustomerPicker, ProductPicker } from "../ventas/pickers";

const STATUS: Record<PromoStatus, [Tone, string]> = {
  activa: ["success", "Activa"], programada: ["info", "Programada"], pausada: ["neutral", "Pausada"], vencida: ["warning", "Vencida"],
};
const KIND_ICON: Record<PromoKind, typeof Package> = { pack: Package, cantidad: Layers, lleva_paga: BadgePercent, cliente: UserCheck, preferencial: Crown };

const pctText = (ppm: number | null) => (ppm ? String(ppm / 10_000).replace(".", ",") : "");
function parsePct(t: string): number | null {
  const v = Number(t.trim().replace(",", "."));
  return t.trim() && Number.isFinite(v) && v > 0 && v < 100 ? Math.round(v * 10_000) : null;
}

/** Resumen en palabras de la regla. */
export function promoSummary(p: Promotion): string {
  const r = p.rule;
  const scope = r.all_products ? "todos los productos" : p.category ? `la categoría ${p.category}` : p.products.map((x) => x.name).join(", ") || "—";
  switch (p.kind) {
    case "pack": {
      const items = p.products.map((x) => `${formatQty(x.qty_milli)} × ${x.name}`).join(" + ");
      return `${items} ${r.pack_price_minor != null ? `por ${formatMoney(r.pack_price_minor)} (neto)` : `con ${formatPpm(r.pct_ppm ?? 0, 0)} de descuento`}`;
    }
    case "cantidad":
      return `${r.tiers.map((t) => `${formatPpm(t.pct_ppm, 0)} desde ${formatQty(t.min_milli)}`).join(" · ")} en ${scope}${r.mixed ? " (sumando productos)" : ""}`;
    case "lleva_paga":
      return `Lleva ${r.buy} y paga ${r.pay} en ${scope}`;
    case "cliente":
      return `${formatPpm(r.pct_ppm ?? 0, 0)} para ${p.customers.map((c) => c.name).join(", ")} en ${scope}`;
    case "preferencial":
      return `${formatPpm(r.pct_ppm ?? 0, 0)} para clientes preferenciales en ${scope}`;
  }
}

type Filter = "todas" | "activa" | "programada" | "otras";

export function Promotions({ route }: { route: Route }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | "nueva" | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const filter = (route.query.get("ver") as Filter) || "todas";
  const edit = can("productos.editar");
  useEffect(() => { backend.promotions().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend]);
  const shown = useMemo(() => (rows ?? []).filter((p) => filter === "todas" || (filter === "otras" ? p.status === "pausada" || p.status === "vencida" : p.status === filter)), [rows, filter]);
  const count = (f: Filter) => (rows ?? []).filter((p) => (f === "otras" ? p.status === "pausada" || p.status === "vencida" : p.status === f)).length;

  async function toggle(p: Promotion) {
    try { setRows(await backend.setPromotionActive(p.uid, !p.active)); toast("success", p.active ? "Promoción pausada." : "Promoción activada."); }
    catch (e) { toast("danger", errorMessage(e)); }
  }

  return (
    <div className="anim-in">
      <PageHeader
        title="Descuentos y promociones"
        subtitle="Packs, descuentos por cantidad, lleva X paga Y y precios para clientes. Se aplican al vender con un clic."
        actions={edit && <Button icon={Plus} onClick={() => setEditing("nueva")}>Nueva promoción</Button>}
      />
      <Tabs value={filter} onChange={(f) => navigate(f === "todas" ? "/promociones" : `/promociones?ver=${f}`, { replace: true })}
        tabs={[{ value: "todas", label: "Todas", count: rows?.length }, { value: "activa", label: "Activas", count: count("activa") },
          { value: "programada", label: "Programadas", count: count("programada") }, { value: "otras", label: "Pausadas y vencidas", count: count("otras") }]} />
      <p className="my-4 text-sm text-muted">
        Al vender, NÚCLEO muestra qué promociones calzan y las aplica como descuento por línea. Si varias tocan el mismo producto,
        usa la de mayor ahorro (no se suman). Marca a tus clientes preferenciales en su ficha.
      </p>
      {err && <Notice tone="danger">{err}</Notice>}
      {!rows ? <Spinner /> : shown.length === 0 ? (
        <EmptyState icon={BadgePercent} title={rows.length ? "Sin promociones en esta vista" : "Aún no tienes promociones"}
          action={edit && <Button icon={Plus} onClick={() => setEditing("nueva")}>Crear la primera</Button>}>
          Por ejemplo: dos productos a un precio especial, 10 % llevando 12 unidades o 5 % para tus clientes preferenciales.
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((p) => {
            const I = KIND_ICON[p.kind];
            const [tone, label] = STATUS[p.status];
            const m = p.kind === "pack" ? packMargin(p) : null;
            const below = m && m.cost > 0 && m.promo < m.cost;
            return (
              <article key={p.uid} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                <header className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><I size={18} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-ink">{p.name}</h3>
                    <p className="text-xs text-muted">{PROMO_KIND_LABEL[p.kind]}</p>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </header>
                <p className="text-sm text-ink-2">{promoSummary(p)}</p>
                {m && (
                  <p className="num text-xs text-muted">
                    Precio normal {formatMoney(m.regular)} → pack {formatMoney(m.promo)} · ahorro {formatMoney(m.regular - m.promo)}
                    {m.cost > 0 && ` · margen ${formatMoney(m.promo - m.cost)}`}
                  </p>
                )}
                {below && <p className="flex items-center gap-1.5 text-xs font-medium text-danger"><AlertTriangle size={13} aria-hidden /> El pack queda bajo el costo.</p>}
                <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <CalendarClock size={13} aria-hidden />
                    {p.starts_on || p.ends_on ? `${p.starts_on ? `Desde ${formatDate(p.starts_on)}` : "Desde hoy"}${p.ends_on ? ` hasta ${formatDate(p.ends_on)}` : ", sin término"}` : "Sin fecha de término"}
                  </span>
                  {edit && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" icon={p.active ? Pause : Play} onClick={() => toggle(p)}>{p.active ? "Pausar" : "Activar"}</Button>
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)}>Editar</Button>
                      <IconButton icon={Trash2} label={`Eliminar ${p.name}`} size={15} onClick={() => setDeleting(p)} />
                    </span>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {editing && <PromoDrawer promo={editing === "nueva" ? null : editing} onClose={() => setEditing(null)} onSaved={(r) => { setRows(r); setEditing(null); }} />}
      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} title="Eliminar promoción"
          footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="danger" icon={Trash2} onClick={async () => {
            try { setRows(await backend.deletePromotion(deleting.uid)); toast("success", "Promoción eliminada."); } catch (e) { toast("danger", errorMessage(e)); }
            setDeleting(null);
          }}>Eliminar</Button></>}>
          <p className="text-sm text-muted">«{deleting.name}» deja de aplicarse. Las ventas ya hechas conservan su descuento. Si solo quieres detenerla un tiempo, usa «Pausar».</p>
        </Dialog>
      )}
    </div>
  );
}

interface ProdRef { uid: string; name: string; sku: string; unit: string; price_minor: number; cost_e4: number }

function PromoDrawer({ promo, onClose, onSaved }: { promo: Promotion | null; onClose: () => void; onSaved: (rows: Promotion[]) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { taxPpm } = useTaxPpm();
  const [kind, setKind] = useState<PromoKind | null>(promo?.kind ?? null);
  const [name, setName] = useState(promo?.name ?? "");
  const [rule, setRule] = useState<PromoRule>(promo?.rule ?? EMPTY_RULE);
  const [prods, setProds] = useState<ProdRef[]>(promo?.products ?? []);
  const [custs, setCusts] = useState<{ uid: string; name: string }[]>(promo?.customers ?? []);
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [starts, setStarts] = useState(promo?.starts_on ?? "");
  const [ends, setEnds] = useState(promo?.ends_on ?? "");
  const [active, setActive] = useState(promo?.active ?? true);
  const [notes, setNotes] = useState(promo?.notes ?? "");
  const [pct, setPct] = useState(pctText(promo?.rule.pct_ppm ?? null));
  const [packMode, setPackMode] = useState<"precio" | "porcentaje">(promo?.rule.pct_ppm != null && promo.kind === "pack" ? "porcentaje" : "precio");
  const [tiers, setTiers] = useState<{ min: string; pct: string }[]>(promo?.rule.tiers.map((t) => ({ min: formatQty(t.min_milli), pct: pctText(t.pct_ppm) })) ?? [{ min: "", pct: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.productCategories().then(setCats).catch(() => setCats([])); }, [backend]);
  const set = (patch: Partial<PromoRule>) => setRule((r) => ({ ...r, ...patch }));
  const scopeMode: "productos" | "categoria" | "todos" = rule.all_products ? "todos" : rule.category_uid ? "categoria" : "productos";

  function addProduct(p: Product | null) {
    if (!p) return;
    if (rule.items.some((i) => i.product_uid === p.uid)) return;
    setProds((ps) => [...ps, { uid: p.uid, name: p.name, sku: p.sku, unit: p.unit, price_minor: p.price_minor, cost_e4: p.cost_e4 }]);
    set({ items: [...rule.items, { product_uid: p.uid, qty_milli: kind === "pack" ? 1000 : 0 }], all_products: false, category_uid: null });
  }
  const prodOf = (uid: string) => prods.find((p) => p.uid === uid);

  async function save() {
    if (!kind) return;
    setErr(null);
    const r: PromoRule = { ...rule };
    if (kind === "pack") {
      if (packMode === "porcentaje") { r.pct_ppm = parsePct(pct); r.pack_price_minor = null; if (!r.pct_ppm) { setErr("Escribe el % de descuento del pack (entre 0 y 100)."); return; } }
      else { r.pct_ppm = null; if (!r.pack_price_minor) { setErr("Escribe el precio del pack."); return; } }
    } else if (kind === "cliente" || kind === "preferencial") {
      r.pct_ppm = parsePct(pct);
      if (!r.pct_ppm) { setErr("Escribe el % de descuento (entre 0 y 100)."); return; }
      r.customer_uids = kind === "cliente" ? custs.map((c) => c.uid) : [];
    } else if (kind === "cantidad") {
      const ts = tiers.filter((t) => t.min.trim() || t.pct.trim()).map((t) => ({ min_milli: parseQty(t.min) ?? 0, pct_ppm: parsePct(t.pct) ?? 0 }));
      if (!ts.length || ts.some((t) => !t.min_milli || !t.pct_ppm)) { setErr("Revisa los tramos: cantidad desde y % de descuento."); return; }
      r.tiers = ts;
    }
    setBusy(true);
    try {
      const rows = await backend.savePromotion(promo?.uid ?? null, { name: name.trim() || PROMO_KIND_LABEL[kind], kind, rule: r, starts_on: starts || null, ends_on: ends || null, active, notes: notes || null });
      toast("success", promo ? "Promoción actualizada." : "Promoción creada.");
      onSaved(rows);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  // Vista previa del pack: precio normal, precio de la promoción y margen.
  const preview = kind === "pack" ? packMargin({
    rule: { ...rule, pct_ppm: packMode === "porcentaje" ? parsePct(pct) : null, pack_price_minor: packMode === "precio" ? rule.pack_price_minor : null },
    products: rule.items.map((i) => { const p = prodOf(i.product_uid)!; return { ...p, qty_milli: i.qty_milli }; }).filter((p) => p.uid),
  }) : null;

  const scope = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">¿A qué productos aplica?</span>
        <Segmented label="Alcance" value={scopeMode}
          onChange={(v) => set(v === "todos" ? { all_products: true, category_uid: null, items: [] } : v === "categoria" ? { all_products: false, category_uid: cats[0]?.uid ?? null, items: [] } : { all_products: false, category_uid: null })}
          options={[{ value: "productos", label: "Productos" }, { value: "categoria", label: "Categoría" }, { value: "todos", label: "Todos" }]} />
      </div>
      {scopeMode === "categoria" && (
        <Select label="Categoría" value={rule.category_uid ?? ""} onChange={(e) => set({ category_uid: e.target.value || null })} options={cats.map((c) => ({ value: c.uid, label: c.name }))} />
      )}
      {scopeMode === "productos" && <ProductList />}
    </div>
  );

  function ProductList() {
    return (
      <div className="flex flex-col gap-2">
        {rule.items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rule.items.map((it) => {
              const p = prodOf(it.product_uid);
              return (
                <li key={it.product_uid} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1"><span className="text-ink">{p?.name ?? "Producto"}</span><span className="ml-2 font-mono text-xs text-muted">{p?.sku}</span></span>
                  {kind === "pack" && (
                    <input aria-label={`Cantidad de ${p?.name}`} inputMode="decimal" defaultValue={formatQty(it.qty_milli)}
                      onBlur={(e) => { const q = parseQty(e.target.value); if (q) set({ items: rule.items.map((x) => (x.product_uid === it.product_uid ? { ...x, qty_milli: q } : x)) }); }}
                      className="num h-8 w-20 rounded-md border border-line bg-surface px-2 text-right focus:border-accent focus:outline-none" />
                  )}
                  {kind === "pack" && <span className="w-10 text-xs text-muted">{p?.unit}</span>}
                  <span className="num w-24 text-right text-muted">{p ? formatMoney(p.price_minor) : ""}</span>
                  <IconButton icon={X} label="Quitar" size={14} onClick={() => set({ items: rule.items.filter((x) => x.product_uid !== it.product_uid) })} />
                </li>
              );
            })}
          </ul>
        )}
        <ProductPicker onPick={(p) => addProduct(p)} />
      </div>
    );
  }

  return (
    <Drawer open onClose={onClose} width="w-[min(640px,100vw)]" title={promo ? "Editar promoción" : "Nueva promoción"}
      subtitle={kind ? PROMO_KIND_HINT[kind] : "Elige qué tipo de promoción quieres crear."}
      footer={kind && <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy}>{busy ? "Guardando…" : promo ? "Guardar cambios" : "Crear promoción"}</Button></>}>
      {!kind ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(PROMO_KIND_LABEL) as PromoKind[]).map((k) => {
            const I = KIND_ICON[k];
            return (
              <button key={k} type="button" onClick={() => { setKind(k); setRule({ ...EMPTY_RULE, all_products: k === "cliente" || k === "preferencial" }); setProds([]); }}
                className="flex items-start gap-3 rounded-xl border border-line p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><I size={18} aria-hidden /></span>
                <span><span className="block font-semibold text-ink">{PROMO_KIND_LABEL[k]}</span><span className="text-sm text-muted">{PROMO_KIND_HINT[k]}</span></span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {!promo && <button type="button" onClick={() => setKind(null)} className="self-start text-sm text-accent hover:underline">← Cambiar tipo ({PROMO_KIND_LABEL[kind]})</button>}
          <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "pack" ? "Ej. Kit taladro + brocas" : kind === "lleva_paga" ? "Ej. Guantes 3x2" : "Ej. Mayorista"} data-autofocus />

          {kind === "pack" && (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-ink">Productos del pack</span>
                <ProductList />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Precio del pack</span>
                <Segmented label="Tipo de precio" value={packMode} onChange={setPackMode} options={[{ value: "precio", label: "Precio fijo" }, { value: "porcentaje", label: "% de descuento" }]} />
              </div>
              {packMode === "precio"
                ? <PriceInput label="Precio del pack completo" net={rule.pack_price_minor} onNet={(v) => set({ pack_price_minor: v })} taxPpm={taxPpm} taxable />
                : <Field label="Descuento sobre el pack" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} suffix="%" className="max-w-[12rem]" inputClassName="text-right num" />}
              {preview && preview.regular > 0 && (
                <Notice tone={preview.cost > 0 && preview.promo < preview.cost ? "danger" : "info"}>
                  Precio normal <strong>{formatMoney(preview.regular)}</strong> → pack <strong>{formatMoney(preview.promo)}</strong> (ahorro {formatMoney(preview.regular - preview.promo)}).
                  {preview.cost > 0 && <> Costo {formatMoney(preview.cost)} · margen <strong>{formatMoney(preview.promo - preview.cost)}</strong>{preview.promo < preview.cost ? ": queda bajo el costo." : "."}</>}
                </Notice>
              )}
            </>
          )}

          {kind === "cantidad" && (
            <>
              {scope}
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-ink">Tramos</span>
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <Field label={i === 0 ? "Desde (unidades)" : undefined} aria-label="Desde" inputMode="decimal" value={t.min} placeholder="12"
                      onChange={(e) => setTiers((ts) => ts.map((x, k) => (k === i ? { ...x, min: e.target.value } : x)))} className="w-36" inputClassName="text-right num" />
                    <Field label={i === 0 ? "Descuento" : undefined} aria-label="Descuento" inputMode="decimal" value={t.pct} placeholder="10" suffix="%"
                      onChange={(e) => setTiers((ts) => ts.map((x, k) => (k === i ? { ...x, pct: e.target.value } : x)))} className="w-32" inputClassName="text-right num" />
                    {tiers.length > 1 && <IconButton icon={X} label="Quitar tramo" size={14} onClick={() => setTiers((ts) => ts.filter((_, k) => k !== i))} />}
                  </div>
                ))}
                {tiers.length < 10 && <Button size="sm" variant="ghost" icon={Plus} className="self-start" onClick={() => setTiers((ts) => [...ts, { min: "", pct: "" }])}>Agregar tramo</Button>}
              </div>
              <Checkbox label="Sumar las unidades de distintos productos" checked={rule.mixed} onChange={(v) => set({ mixed: v })}
                hint="Ej. 6 brochas + 6 rodillos cuentan como 12 unidades para alcanzar el tramo." />
            </>
          )}

          {kind === "lleva_paga" && (
            <>
              {scope}
              <div className="flex items-end gap-3">
                <Field label="Lleva" inputMode="numeric" value={String(rule.buy || "")} onChange={(e) => set({ buy: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="w-28" inputClassName="text-right num" />
                <Field label="Paga" inputMode="numeric" value={String(rule.pay || "")} onChange={(e) => set({ pay: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="w-28" inputClassName="text-right num" />
                <span className="pb-2 text-sm text-muted">Se regala {Math.max(0, rule.buy - rule.pay)} de cada {rule.buy || "—"} del mismo producto.</span>
              </div>
            </>
          )}

          {(kind === "cliente" || kind === "preferencial") && (
            <>
              {kind === "cliente" ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-medium text-ink">Clientes</span>
                  {custs.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {custs.map((c) => (
                        <span key={c.uid} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
                          {c.name}<IconButton icon={X} label={`Quitar ${c.name}`} size={13} className="h-6 w-6" onClick={() => setCusts((cs) => cs.filter((x) => x.uid !== c.uid))} />
                        </span>
                      ))}
                    </div>
                  )}
                  <CustomerPicker value={null} allowWalkIn={false} onCreate={() => {}}
                    onChange={(c: Customer | null) => { if (c && !custs.some((x) => x.uid === c.uid)) setCusts((cs) => [...cs, { uid: c.uid, name: c.name }]); }} />
                </div>
              ) : (
                <Notice tone="info">Aplica a los clientes marcados como <strong>preferenciales</strong> en su ficha (Clientes → Editar → Condiciones comerciales).</Notice>
              )}
              <Field label="Descuento" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} suffix="%" className="max-w-[12rem]" inputClassName="text-right num" />
              {scope}
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Desde" type="date" optional value={starts} onChange={(e) => setStarts(e.target.value)} hint="Vacío: desde hoy." />
            <Field label="Hasta" type="date" optional value={ends} onChange={(e) => setEnds(e.target.value)} hint="Vacío: sin término." />
          </div>
          <Checkbox label="Activa" checked={active} onChange={setActive} hint="Puedes pausarla y volver a activarla cuando quieras." />
          <TextArea label="Notas" optional rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. solo en tienda, hasta agotar stock…" />
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
      )}
    </Drawer>
  );
}

