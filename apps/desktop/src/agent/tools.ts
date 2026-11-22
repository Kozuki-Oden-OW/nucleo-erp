// Herramientas que NÚCLEO ofrece a Claude (definidas en tools.json, compartido con el puente en Rust).
// Las de pantalla actúan sobre la interfaz; las de datos usan el mismo Backend que las pantallas, así
// valen las mismas reglas, permisos y auditoría.
import type { Backend } from "../data";
import { errorMessage } from "../data";
import type { Customer, HistoricalSale, SiiDocument, SiiLibro, SiiLineaLibro, LineInput, Product, SaleSummary, SaleTerms, ShipmentInput, ShipmentSize, Supplier } from "../data/types";
import { EMPTY_TERMS } from "../data/saleTerms";
import { formatMoney, todayIso } from "../lib/format";
import { navigate } from "../lib/router";
import { hitHref } from "../shell/CommandPalette";
import { choose, click, key, resolveRoute, scroll, settle, snapshot, type } from "./dom";
import TOOLS from "./tools.json";

export type AgentLevel = "ver" | "borradores" | "completo";
export const LEVELS: AgentLevel[] = ["ver", "borradores", "completo"];

export interface ToolDef { name: string; nivel: AgentLevel; description: string; inputSchema: unknown }
export const TOOL_DEFS = TOOLS as ToolDef[];

export interface ToolResult { content: { type: "text"; text: string }[]; isError?: boolean }

type Args = Record<string, unknown>;
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

const str = (a: Args, k: string): string => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
const num = (a: Args, k: string): number | null => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : null);
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const rutKey = (s: string | null | undefined) => (s ?? "").replace(/[.\s-]/g, "").toUpperCase();
const pesos = (n: number) => formatMoney(Math.round(n));

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Elige un solo resultado: exacto por RUT/SKU o nombre; si hay varios parecidos, pide precisar. */
function pickOne<T extends { name: string }>(items: T[], q: string, keyOf: (x: T) => string, what: string): T {
  const k = norm(q);
  const exact = items.filter((x) => keyOf(x) && rutKey(keyOf(x)) === rutKey(q));
  if (exact.length === 1) return exact[0]!;
  const byName = items.filter((x) => norm(x.name) === k);
  if (byName.length === 1) return byName[0]!;
  if (items.length === 1) return items[0]!;
  if (items.length === 0) throw new Error(`No encontré ${what} «${q}».`);
  throw new Error(`Hay varios ${what}s que coinciden con «${q}»: ${items.slice(0, 8).map((x) => `${x.name}${keyOf(x) ? ` (${keyOf(x)})` : ""}`).join("; ")}. Indica el nombre exacto, RUT o SKU.`);
}

/** Busca por el texto tal cual y, si parece RUT, también sin puntos ni guion (sin repetir). */
async function searchBoth<T extends { uid: string }>(search: (q: string) => Promise<T[]>, q: string): Promise<T[]> {
  const a = await search(q);
  const k = rutKey(q);
  if (!/^\d{6,9}[0-9K]$/.test(k)) return a;
  // La búsqueda compara texto: un RUT con puntos no encuentra uno guardado sin puntos (y al revés).
  // Probamos también «cuerpo-dv» y el cuerpo solo.
  const out = [...a];
  for (const v of [`${k.slice(0, -1)}-${k.slice(-1)}`, k.slice(0, -1)]) {
    if (v === q) continue;
    for (const x of await search(v)) if (!out.some((y) => y.uid === x.uid)) out.push(x);
  }
  return out;
}

/** Documento del SII por «tipo-folio» (33-1) o id interno. */
async function findSiiDoc(backend: Backend, ref: string): Promise<SiiDocument> {
  const docs = await backend.siiDocuments(1000);
  const m = ref.trim().match(/^(\d{2,3})\s*[-–]\s*(\d+)$/);
  const d = m ? docs.find((x) => x.tipo === Number(m[1]) && x.folio === Number(m[2])) : docs.find((x) => String(x.id) === ref.trim());
  if (!d) throw new Error(`No encontré el documento «${ref}». Usa tipo-folio (ej. 33-1).`);
  return d;
}
const siiLine = (d: SiiDocument) => `- ${d.tipo}-${d.folio} ${d.tipo_nombre} N° ${d.folio} · ${d.fecha} · ${d.receptor} (${d.receptor_rut}) · ${pesos(d.total_minor)} · ${d.estado}${d.track_id ? ` · track ${d.track_id}` : ""}${d.glosa ? ` · ${d.glosa}` : ""}${d.ambiente === "certificacion" ? " · certificación" : ""}`;

const libroLine = (l: SiiLibro) => `- libro ${l.id}: ${l.operacion === "venta" ? "ventas" : "compras"} ${l.periodo} · ${l.tipo_libro}${l.folio_notificacion ? ` (notificación ${l.folio_notificacion})` : ""} · ${l.documentos} docs · ${l.estado}${l.track_id ? ` · track ${l.track_id}` : ""}${l.glosa ? ` · ${l.glosa}` : ""}`;

const METHOD: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta de débito", cheque: "Cheque", credito: "" };

/** Tipos de referencia del texto de una factura del SII → códigos de las condiciones de venta. */
const REF_KINDS: [RegExp, string][] = [
  [/orden\s+(de\s+)?compra/i, "801"],
  [/gu[ií]a\s+(de\s+)?despacho/i, "52"],
  [/\bHES\b/i, "HES"],
  [/\bHEM\b/i, "HEM"],
  [/nota\s+(de\s+)?pedido/i, "802"],
  [/nota\s+(de\s+)?venta/i, "NV"],
  [/contrato/i, "803"],
];

/**
 * Condiciones de una venta histórica a partir de la factura: forma de pago (crédito con la fecha de
 * «Pagos:») y referencias («Orden Compra N° 22.112 del 2026-11-18», guía, HES, nota de pedido…).
 */
export function historicalTerms(formaPago: string, referencias: string, ordenCompra = ""): SaleTerms | null {
  const references: SaleTerms["references"] = [];
  const re = /([A-Za-zÁÉÍÓÚáéíóúñÑ.]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ.]+){0,3})\s+N[°º]\s*(.+?)\s+del\s+(\d{4}-\d{2}-\d{2})/g;
  for (const m of referencias.matchAll(re)) {
    const label = m[1] ?? "";
    const kind = REF_KINDS.find(([k]) => k.test(label))?.[1];
    const folio = (m[2] ?? "").replace(/^[-\s]+|[-\s]+$/g, "").slice(0, 40);
    if (!kind || !folio || references.some((r) => r.kind === kind && r.folio === folio)) continue;
    references.push({ kind, folio, date: m[3] ?? null, note: null });
  }
  const oc = ordenCompra.trim();
  if (oc && !references.some((r) => r.kind === "801" && r.folio === oc)) references.unshift({ kind: "801", folio: oc.slice(0, 40), date: null, note: null });
  const credit = /cr[eé]dito/i.test(formaPago);
  const due = credit ? /Pagos:\s*(\d{4}-\d{2}-\d{2})/i.exec(referencias)?.[1] ?? null : null;
  if (!credit && !references.length) return null;
  return {
    payment: credit ? "credito" : "", card: null, credit_days: null, due_date: due, bank: null, transfer_date: null,
    operation: null, references, receiver: null,
  } as SaleTerms;
}

async function findSale(backend: Backend, ref: string, view: "borradores" | "por_cobrar"): Promise<SaleSummary> {
  const label = view === "borradores" ? "en borrador" : "por cobrar";
  const list = await backend.listSales({ view, query: ref });
  const hit = list.find((s) => s.uid === ref || norm(s.number) === norm(ref)) ?? (list.length === 1 ? list[0] : undefined);
  if (hit) return hit;
  // Por identificador: la búsqueda solo mira número y cliente.
  const all = await backend.listSales({ view });
  const byUid = all.find((s) => s.uid === ref);
  if (byUid) return byUid;
  throw new Error(list.length ? `Hay varias ventas ${label} que coinciden con «${ref}»: ${list.slice(0, 8).map((s) => s.number).join(", ")}.` : `No encontré una venta ${label} «${ref}».`);
}

function productLine(p: Product): string {
  const stock = p.kind === "servicio" ? "servicio" : `stock ${p.on_hand_milli / 1000} ${p.unit}`;
  return `- ${p.name} · SKU ${p.sku || "—"} · neto ${pesos(p.price_minor)} · costo ${pesos(p.cost_e4 / 10_000)} · ${stock} · ${p.taxable ? "afecto a IVA" : "exento"}`;
}
const customerLine = (c: Customer) => `- ${c.name} · RUT ${c.rut ?? "—"} · ${c.email ?? "sin correo"} · ${c.phone ?? "sin teléfono"}`;
const supplierLine = (s: Supplier) => `- ${s.name} · RUT ${s.rut ?? "—"} · ${s.email ?? "sin correo"} · plazo ${s.payment_terms_days} días`;
const saleLine = (s: SaleSummary) =>
  `- ${s.number || "(borrador)"} · ${s.issue_date} · ${s.customer_name || "sin cliente"} · total ${pesos(s.total_minor)} · pagado ${pesos(s.paid_minor)} · ${s.commercial_state}/${s.payment_state}/${s.documentation_state}`;

/** Avisa a la pantalla que cambiaron datos (para recargar listas, sin tocar un formulario a medio llenar). */
function dataChanged() { if (typeof window !== "undefined") window.dispatchEvent(new Event("nucleo:datos")); }

async function screenAfter(done: string): Promise<ToolResult> {
  await settle();
  return text(`${done}\n\n${snapshot()}`);
}

export function allowed(def: ToolDef | undefined, level: AgentLevel): boolean {
  return !!def && LEVELS.indexOf(def.nivel) <= LEVELS.indexOf(level);
}

export async function runTool(backend: Backend, level: AgentLevel, name: string, args: Args = {}): Promise<ToolResult> {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return text(`No existe la herramienta «${name}».`, true);
  if (!allowed(def, level)) {
    const need = def.nivel === "completo" ? "«Acceso completo»" : "«Crear borradores»";
    return text(`El acceso de Claude a NÚCLEO está en «${level === "ver" ? "Solo ver" : "Crear borradores"}». Para usar ${name} la persona debe elegir ${need} en Configuración → Claude.`, true);
  }
  try {
    return await exec(backend, level, name, args);
  } catch (e) {
    return text(errorMessage(e), true);
  }
}

async function exec(backend: Backend, level: AgentLevel, name: string, a: Args): Promise<ToolResult> {
  switch (name) {
    /* ───── Pantalla ───── */
    case "ver_pantalla":
      await settle(1500);
      return text(snapshot());
    case "ir_a": {
      const to = resolveRoute(str(a, "destino"));
      navigate(to);
      return screenAfter(`Abrí ${to}.`);
    }
    case "desplazar":
      scroll((str(a, "direccion") || "abajo") as "arriba");
      return screenAfter(`Desplacé ${str(a, "direccion")}.`);
    case "clic":
      await click(str(a, "elemento"));
      return screenAfter(`Hice clic en ${str(a, "elemento")}.`);
    case "escribir":
      await type(str(a, "elemento"), typeof a.texto === "string" ? a.texto : String(a.texto ?? ""), a.enter === true);
      return screenAfter(`Escribí en ${str(a, "elemento")}.`);
    case "elegir": {
      const chosen = await choose(str(a, "elemento"), str(a, "opcion"));
      return screenAfter(`Elegí «${chosen}».`);
    }
    case "tecla":
      key(str(a, "tecla"));
      return screenAfter(`Presioné ${str(a, "tecla")}.`);

    /* ───── Consultas ───── */
    case "resumen_negocio": {
      const d = await backend.dashboard();
      const out = [
        `Hoy: ventas ${pesos(d.today_sales_minor)} en ${d.today_sales_count} ventas · utilidad ${pesos(d.today_profit_minor)}`,
        `Este mes: ventas ${pesos(d.month_sales_minor)} (mes anterior a la misma fecha ${pesos(d.month_prev_same_minor)}) · compras ${pesos(d.month_purchases_minor)} · gastos ${pesos(d.month_expenses_minor)} · utilidad ${pesos(d.month_profit_minor)}`,
        `Disponible: ${pesos(d.cash_minor)} · Te deben: ${pesos(d.receivable_minor)} (atrasado ${pesos(d.receivable_overdue_minor)}) · Debes: ${pesos(d.payable_minor)}`,
        d.tax_estimate_minor !== null ? `IVA estimado del mes: ${pesos(d.tax_estimate_minor)}` : "",
        `Ventas por documentar: ${d.pending_documentation}`,
        d.low_stock.length ? `Poco stock: ${d.low_stock.map((p) => `${p.name} (${p.on_hand_milli / 1000}, mínimo ${p.min_milli / 1000})`).join("; ")}` : "",
        d.upcoming_payments.length ? `Próximos: ${d.upcoming_payments.slice(0, 8).map((u) => `${u.date} ${u.kind} ${u.label} ${pesos(u.amount_minor)}`).join("; ")}` : "",
        d.alerts.length ? `Avisos:\n${d.alerts.map((x) => `- [${x.severity}] ${x.title}: ${x.detail} (ir_a ${x.href})`).join("\n")}` : "Sin avisos.",
      ];
      return text(out.filter(Boolean).join("\n"));
    }
    case "buscar": {
      const hits = await backend.globalSearch(str(a, "texto"));
      return text(hits.length ? hits.slice(0, 30).map((h) => `- ${h.kind}: ${h.title} — ${h.subtitle} (ir_a ${hitHref(h)})`).join("\n") : "Sin resultados.");
    }
    case "buscar_clientes": {
      const r = await backend.searchCustomers(str(a, "texto"));
      return text(r.length ? `${r.length} clientes:\n${r.slice(0, 40).map(customerLine).join("\n")}` : "Sin clientes que coincidan.");
    }
    case "buscar_productos": {
      const r = await backend.searchProducts(str(a, "texto"));
      return text(r.length ? `${r.length} productos y servicios:\n${r.slice(0, 40).map(productLine).join("\n")}` : "Sin productos que coincidan.");
    }
    case "buscar_proveedores": {
      const r = await backend.searchSuppliers(str(a, "texto"));
      return text(r.length ? `${r.length} proveedores:\n${r.slice(0, 40).map(supplierLine).join("\n")}` : "Sin proveedores que coincidan.");
    }
    case "listar_ventas": {
      const view = (str(a, "vista") || "todas") as "todas";
      const r = await backend.listSales({ view, query: str(a, "texto") || undefined });
      return text(r.length ? `${r.length} ventas (${view}):\n${r.slice(0, 50).map(saleLine).join("\n")}${r.length > 50 ? "\n…" : ""}` : "No hay ventas en esa vista.");
    }
    case "sincronizar_mercadolibre": {
      const r = await backend.mlSync(str(a, "desde") || null);
      return text([
        `Mercado Libre: ventas nuevas ${r.imported} · completadas ${r.completed} · por revisar ${r.to_review} · por facturar ${r.to_invoice} · canceladas ${r.cancelled} · sin cambios ${r.unchanged}.`,
        ...r.messages.map((m) => `- ${m}`),
      ].join("\n"));
    }
    case "pedidos_mercadolibre": {
      const r = (await backend.mlOrders(Math.min(Math.max(num(a, "limite") || 50, 1), 300)));
      return text(r.length
        ? `${r.length} pedidos de Mercado Libre:\n${r.map((o) => `- ${o.date_created} · ${o.pack_id ?? o.order_id} · ${o.buyer ?? "—"} · total ${pesos(o.total_minor)} · comisión ${pesos(o.sale_fee_minor)} · envío ${pesos(o.shipping_cost_minor)} · a recibir ${pesos(o.net_minor)} · ${o.status}${o.needs_invoice ? " · por facturar" : ""}${o.sale_number ? ` · ${o.sale_number}` : ""}${o.issue ? ` · ${o.issue}` : ""}`).join("\n")}`
        : "Aún no hay pedidos de Mercado Libre en NÚCLEO.");
    }
    case "listar_envios": {
      let saleUid: string | null = null;
      const ref = str(a, "venta");
      if (ref) {
        const list = await backend.listSales({ view: "todas", query: ref });
        const s = list.find((x) => norm(x.number) === norm(ref)) ?? (list.length === 1 ? list[0] : undefined);
        if (!s) throw new Error(`No encontré la venta «${ref}».`);
        saleUid = s.uid;
      }
      const q = norm(str(a, "texto"));
      const r = (await backend.shipments(saleUid)).filter((e) => !q || norm([e.tracking, e.carrier, e.customer_name, e.commune, e.number, e.sale_number].join(" ")).includes(q));
      return text(r.length
        ? `${r.length} envíos:\n${r.slice(0, 50).map((e) => `- ${e.number}${e.sale_number ? ` · venta ${e.sale_number}` : ""} · ${e.customer_name ?? [e.first_name, e.last_name].filter(Boolean).join(" ")} · ${e.carrier ?? "sin agencia"} ${e.tracking ?? "sin seguimiento"} · ${e.status} · ${[e.address, e.commune].filter(Boolean).join(", ")}${e.size ? ` · talla ${e.size}` : ""}${e.cost_minor != null ? ` · costo ${pesos(e.cost_minor)}` : ""}`).join("\n")}`
        : "No hay envíos que coincidan.");
    }
    case "listar_gastos": {
      const r = await backend.listExpenses({ from: str(a, "desde") || undefined, to: str(a, "hasta") || undefined, query: str(a, "texto") || undefined });
      return text(r.length
        ? `${r.length} gastos:\n${r.slice(0, 50).map((g) => `- ${g.number} · ${g.date} · ${g.category} · ${g.description} · ${pesos(g.total_minor)} · pagado ${pesos(g.paid_minor)}${g.supplier_name ? ` · ${g.supplier_name}` : ""}`).join("\n")}`
        : "No hay gastos en ese período.");
    }
    case "datos_de_apoyo": {
      const [cats, accounts] = await Promise.all([backend.expenseCategories(), backend.moneyAccounts().catch(() => [])]);
      return text([
        "Categorías de gasto:",
        ...cats.filter((c) => !c.archived).map((c) => `- ${c.name} (${c.group_name}, ${c.behavior})`),
        "", "Cuentas de dinero:",
        ...(accounts.filter((x) => !x.archived).map((x) => `- ${x.name} (${x.kind})`) || []),
      ].join("\n"));
    }

    /* ───── Crear (borradores) ───── */
    case "crear_cliente": {
      const rut = str(a, "rut");
      if (rut) {
        const found = [...(await backend.searchCustomers(rut)), ...(await backend.searchCustomers(rutKey(rut)))];
        const existing = found.find((c) => rutKey(c.rut) === rutKey(rut));
        if (existing) return text(`Ya existía: ${customerLine(existing).slice(2)}`);
      }
      const c = await backend.addCustomer({
        name: str(a, "nombre"), rut: rut || undefined, email: str(a, "correo") || undefined, phone: str(a, "telefono") || undefined,
        address: str(a, "direccion") || null, commune: str(a, "comuna") || null, business_activity: str(a, "giro") || null,
      });
      dataChanged();
      return text(`Cliente creado: ${customerLine(c).slice(2)}`);
    }
    case "importar_clientes": {
      const list = Array.isArray(a.clientes) ? (a.clientes as Args[]) : [];
      if (!list.length || list.length > 200) throw new Error("Envía entre 1 y 200 clientes.");
      let created = 0, updated = 0, same = 0;
      const errors: string[] = [];
      for (const c of list) {
        const name = str(c, "nombre");
        const rut = str(c, "rut");
        try {
          const found = rut ? (await searchBoth((q) => backend.searchCustomers(q), rut)).find((x) => rutKey(x.rut) === rutKey(rut)) : undefined;
          const notes = str(c, "notas");
          if (!found) {
            await backend.addCustomer({
              name, rut: rut || undefined, email: str(c, "correo") || undefined, phone: str(c, "telefono") || undefined,
              kind: rut && Number(rutKey(rut).slice(0, -1)) >= 50_000_000 ? "empresa" : "persona",
              contact_name: str(c, "contacto") || null, address: str(c, "direccion") || null, commune: str(c, "comuna") || null,
              business_activity: str(c, "giro") || null, notes: notes || null,
            });
            created++;
            continue;
          }
          const d = await backend.customer(found.uid);
          const patch = {
            email: d.email || str(c, "correo") || null, phone: d.phone || str(c, "telefono") || null,
            contact_name: d.contact_name || str(c, "contacto") || null, address: d.address || str(c, "direccion") || null,
            commune: d.commune || str(c, "comuna") || null, business_activity: d.business_activity || str(c, "giro") || null,
            notes: notes && !(d.notes ?? "").includes(notes) ? [d.notes, notes].filter(Boolean).join("\n") : d.notes,
          };
          const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((k) => (patch[k] ?? null) !== ((d as unknown as Record<string, unknown>)[k] ?? null));
          if (!changed) { same++; continue; }
          await backend.updateCustomer(found.uid, {
            name: d.name, rut: d.rut ?? undefined, email: patch.email ?? undefined, phone: patch.phone ?? undefined,
            kind: d.kind, trade_name: d.trade_name, business_activity: patch.business_activity, address: patch.address, commune: patch.commune,
            city: d.city, region: d.region, contact_name: patch.contact_name, invoice_email: d.invoice_email, payment_terms_days: d.payment_terms_days,
            credit_limit_minor: d.credit_limit_minor, notes: patch.notes ?? null, credit_enabled: d.credit_enabled, credit_conditions: d.credit_conditions,
            preferred: d.preferred,
          });
          updated++;
        } catch (e) {
          errors.push(`${name}${rut ? ` (${rut})` : ""}: ${errorMessage(e)}`);
        }
      }
      if (created || updated) dataChanged();
      return text([`Clientes nuevos ${created} · completados ${updated} · sin cambios ${same} · con error ${errors.length}.`, ...errors.map((x) => `- ${x}`)].join("\n"), created + updated + same === 0);
    }
    case "crear_proveedor": {
      const rut = str(a, "rut");
      if (rut) {
        const found = [...(await backend.searchSuppliers(rut)), ...(await backend.searchSuppliers(rutKey(rut)))];
        const existing = found.find((s) => rutKey(s.rut) === rutKey(rut));
        if (existing) return text(`Ya existía: ${supplierLine(existing).slice(2)}`);
      }
      const s = await backend.addSupplier({
        name: str(a, "nombre"), rut: rut || undefined, email: str(a, "correo") || undefined, phone: str(a, "telefono") || undefined,
        payment_terms_days: num(a, "dias_pago") ?? undefined,
      });
      dataChanged();
      return text(`Proveedor creado: ${supplierLine(s).slice(2)}`);
    }
    case "crear_producto": {
      const sku = str(a, "sku");
      if (sku) {
        const existing = (await backend.searchProducts(sku)).find((p) => norm(p.sku) === norm(sku));
        if (existing) return text(`Ya existía: ${productLine(existing).slice(2)}`);
      }
      const kind = str(a, "tipo") === "servicio" ? "servicio" : "producto";
      const stock = num(a, "stock_inicial");
      const p = await backend.addProduct({
        name: str(a, "nombre"), kind, sku: sku || undefined, unit: str(a, "unidad") || undefined,
        price_minor: Math.round(num(a, "precio_neto") ?? 0), cost_minor: num(a, "costo") !== null ? Math.round(num(a, "costo")!) : undefined,
        taxable: a.afecto_iva !== false, initial_stock_milli: kind === "producto" && stock ? Math.round(stock * 1000) : undefined,
      });
      dataChanged();
      return text(`Producto creado: ${productLine(p).slice(2)}`);
    }
    case "crear_venta_borrador": {
      let customer_uid: string | null = null;
      let customerName = "sin cliente";
      const cq = str(a, "cliente");
      if (cq) {
        const c = pickOne(await searchBoth((q) => backend.searchCustomers(q), cq), cq, (x) => x.rut ?? "", "cliente");
        customer_uid = c.uid;
        customerName = c.name;
      }
      const raw = Array.isArray(a.lineas) ? (a.lineas as Args[]) : [];
      if (!raw.length) throw new Error("La venta necesita al menos una línea.");
      const lines: LineInput[] = [];
      for (const [i, l] of raw.entries()) {
        const qty = num(l, "cantidad") ?? 1;
        const disc = Math.round((num(l, "descuento") ?? 0) * 10_000);
        const pq = str(l, "producto");
        if (pq) {
          const p = pickOne(await backend.searchProducts(pq), pq, (x) => x.sku, "producto");
          lines.push({
            product_uid: p.uid, description: str(l, "descripcion") || p.name, qty_milli: Math.round(qty * 1000),
            unit_price_minor: Math.round(num(l, "precio_neto") ?? p.price_minor), discount_ppm: disc,
            taxable: typeof l.afecto_iva === "boolean" ? l.afecto_iva : p.taxable,
          });
        } else {
          const desc = str(l, "descripcion");
          const price = num(l, "precio_neto");
          if (!desc || price === null) throw new Error(`La línea ${i + 1} necesita un producto, o una descripción con precio_neto.`);
          lines.push({ product_uid: null, description: desc, qty_milli: Math.round(qty * 1000), unit_price_minor: Math.round(price), discount_ppm: disc, taxable: l.afecto_iva !== false });
        }
      }
      const sale = await backend.saveSale({
        doc_type: str(a, "tipo") === "FV" ? "FV" : "VEN", customer_uid, issue_date: str(a, "fecha") || todayIso(), lines,
        notes: str(a, "notas") || undefined, terms: EMPTY_TERMS,
      });
      dataChanged();
      return text([
        `Venta en borrador creada (${sale.number || "sin número hasta confirmarla"}) para ${customerName}.`,
        ...sale.lines.map((l) => `- ${l.description}: ${l.qty_milli / 1000} × ${pesos(l.unit_price_minor)}${l.discount_ppm ? ` (−${l.discount_ppm / 10_000} %)` : ""} = ${pesos(l.net_minor)} neto`),
        `Neto ${pesos(sale.totals.net_minor)} · exento ${pesos(sale.totals.exempt_minor)} · IVA ${pesos(sale.totals.tax_minor)} · total ${pesos(sale.totals.total_minor)}`,
        `Identificador: ${sale.uid} · se ve en ir_a /ventas/${sale.uid}`,
        level === "completo" ? "Para confirmarla usa confirmar_venta." : "La persona la confirma en NÚCLEO (Vender → Borradores).",
      ].join("\n"));
    }
    case "registrar_gasto": {
      const cats = (await backend.expenseCategories()).filter((c) => !c.archived);
      const cq = norm(str(a, "categoria"));
      const cat = cats.find((c) => norm(c.name) === cq) ?? cats.find((c) => norm(c.name).includes(cq)) ?? cats.find((c) => norm(c.group_name).includes(cq));
      if (!cat) throw new Error(`No hay una categoría de gasto «${str(a, "categoria")}». Categorías: ${cats.map((c) => c.name).join(", ")}.`);
      let supplier_uid: string | null = null;
      const sq = str(a, "proveedor");
      if (sq) supplier_uid = pickOne(await searchBoth((q) => backend.searchSuppliers(q), sq), sq, (x) => x.rut ?? "", "proveedor").uid;
      const paid = str(a, "pagado_con");
      if (paid && level !== "completo") throw new Error("Marcar un gasto como pagado mueve dinero: requiere «Acceso completo». Sin indicar pagado_con queda por pagar.");
      const g = await backend.registerExpense({
        category_id: cat.id, supplier_uid, date: str(a, "fecha") || todayIso(), description: str(a, "descripcion"),
        total_minor: Math.round(num(a, "total") ?? 0), tax_included: a.con_iva === true, due_date: str(a, "vencimiento") || null,
        paid_method: paid ? METHOD[paid] ?? paid : null, paid_account_uid: null, notes: str(a, "notas") || undefined, recurring_id: null,
      });
      dataChanged();
      return text(`Gasto ${g.number} registrado: ${g.description} · ${cat.name} · ${pesos(g.total_minor)} · ${g.paid_minor >= g.total_minor ? "pagado" : "por pagar"}.`);
    }

    /* ───── Acceso completo ───── */
    case "confirmar_venta": {
      const s = await findSale(backend, str(a, "venta"), "borradores");
      const credito = str(a, "modo") === "credito";
      const today = todayIso();
      const done = await backend.effectSale(s.uid, credito
        ? { mode: "credito", method: "", due_date: str(a, "vencimiento") || addDays(today, 30) }
        : { mode: "contado", method: METHOD[str(a, "medio") || "efectivo"] ?? "Efectivo", due_date: null });
      dataChanged();
      return text(`Venta ${done.number} confirmada · total ${pesos(done.total_minor)} · ${credito ? `por cobrar hasta ${done.due_date ?? ""}` : `pagada (${done.payment_method ?? ""})`}.`);
    }
    case "registrar_envio": {
      let saleUid: string | null = null;
      const ref = str(a, "venta");
      if (ref) {
        const list = await backend.listSales({ view: "todas", query: ref });
        const s = list.find((x) => norm(x.number) === norm(ref)) ?? (list.length === 1 ? list[0] : undefined);
        if (!s) throw new Error(`No encontré la venta «${ref}».`);
        saleUid = s.uid;
      }
      const all = await backend.shipments(null);
      const envRef = str(a, "envio");
      const existing = envRef ? all.find((e) => norm(e.number) === norm(envRef))
        : str(a, "seguimiento") ? all.find((e) => e.tracking && norm(e.tracking) === norm(str(a, "seguimiento"))) : undefined;
      if (envRef && !existing) throw new Error(`No encontré el envío «${envRef}».`);
      const pick = <T,>(key: string, cur: T | null | undefined, conv: (v: unknown) => T): T | null => (a[key] === undefined || a[key] === "" ? (cur ?? null) : conv(a[key]));
      const s2 = (v: unknown) => String(v).trim();
      const n2 = (v: unknown) => Math.round(Number(v));
      const e = existing;
      const input: ShipmentInput = {
        sale_uid: saleUid ?? e?.sale_uid ?? null, customer_uid: e?.customer_uid ?? null,
        status: (str(a, "estado") || e?.status || "no_despachado") as ShipmentInput["status"],
        carrier: pick("agencia", e?.carrier, s2), tracking: pick("seguimiento", e?.tracking, s2),
        first_name: pick("nombre", e?.first_name, s2), last_name: pick("apellido", e?.last_name, s2), phone: pick("telefono", e?.phone, s2), email: pick("correo", e?.email, s2),
        region: pick("region", e?.region, s2), commune: pick("comuna", e?.commune, s2), city: pick("ciudad", e?.city, s2),
        street: pick("calle", e?.street, s2), street_number: pick("numero", e?.street_number, s2), unit: pick("depto", e?.unit, s2), reference: pick("referencia", e?.reference, s2),
        address: a.calle !== undefined ? null : (e?.address ?? null),
        delivery_mode: pick("tipo_entrega", e?.delivery_mode, (v) => s2(v) as "domicilio" | "punto"), origin_point: pick("punto_origen", e?.origin_point, s2), service: pick("servicio", e?.service, s2),
        content: pick("contenido", e?.content, s2), declared_value_minor: pick("valor_declarado", e?.declared_value_minor, n2),
        size: pick("talla", e?.size, (v) => s2(v).toUpperCase() as ShipmentSize), weight_g: pick("peso_g", e?.weight_g, n2),
        length_cm: pick("largo_cm", e?.length_cm, n2), width_cm: pick("ancho_cm", e?.width_cm, n2), height_cm: pick("alto_cm", e?.height_cm, n2),
        no_dangerous: a.sin_mercancias_peligrosas === undefined ? !!e?.no_dangerous : a.sin_mercancias_peligrosas === true,
        cost_minor: pick("costo", e?.cost_minor, n2), payment_ref: pick("transaccion", e?.payment_ref, s2),
        shipped_on: pick("fecha_envio", e?.shipped_on, s2), delivered_on: e?.delivered_on ?? null, notes: pick("notas", e?.notes, s2),
      };
      const saved = await backend.saveShipment(e?.uid ?? null, input);
      dataChanged();
      return text(`Envío ${saved.number} ${e ? "actualizado" : "creado"}${saved.sale_number ? ` y unido a la venta ${saved.sale_number}` : ""}: ${saved.carrier ?? "sin agencia"} ${saved.tracking ?? ""} · ${saved.status} · ${[saved.address, saved.commune].filter(Boolean).join(", ")}${saved.size ? ` · talla ${saved.size}` : ""}${saved.cost_minor != null ? ` · costo ${pesos(saved.cost_minor)}` : ""}.`);
    }
    case "documentar_venta": {
      const ref = str(a, "venta");
      const list = await backend.listSales({ view: "todas", query: ref });
      const s = list.find((x) => x.uid === ref || norm(x.number) === norm(ref)) ?? (list.length === 1 ? list[0] : undefined)
        ?? (await backend.listSales({ view: "todas" })).find((x) => x.uid === ref);
      if (!s) throw new Error(`No encontré la venta «${ref}».`);
      const done = await backend.markDocumented(s.uid, {
        doc_kind: str(a, "tipo_documento") || "Factura electrónica", external_number: str(a, "folio"),
        issue_date: str(a, "fecha") || undefined, observation: str(a, "referencias") || undefined,
      });
      dataChanged();
      return text(`Venta ${done.number} documentada con ${str(a, "tipo_documento") || "Factura electrónica"} Nº ${str(a, "folio")} · estado ${done.commercial_state}.`);
    }
    case "importar_ventas_historicas": {
      const docs = Array.isArray(a.documentos) ? (a.documentos as Args[]) : [];
      if (!docs.length) throw new Error("No hay documentos para importar.");
      const items: HistoricalSale[] = docs.map((d) => {
        const c = (d.cliente ?? null) as Args | null;
        const lines = (Array.isArray(d.lineas) ? d.lineas : []) as Args[];
        return {
          doc_kind: str(d, "tipo_documento"), number: str(d, "folio"), issue_date: str(d, "fecha"),
          customer: c && str(c, "nombre") ? { name: str(c, "nombre"), rut: str(c, "rut") || null, business_activity: str(c, "giro") || null, address: str(c, "direccion") || null, commune: str(c, "comuna") || null, city: str(c, "ciudad") || null, email: str(c, "correo") || null } : null,
          lines: lines.map((l) => ({ product_sku: str(l, "sku") || null, description: str(l, "descripcion"), qty_milli: Math.round((num(l, "cantidad") ?? 0) * 1000), unit_price_minor: Math.round(num(l, "precio_unitario") ?? 0), net_minor: Math.round(num(l, "valor_neto") ?? 0), taxable: l.afecto_iva !== false })),
          net_minor: Math.round(num(d, "neto") ?? 0), exempt_minor: Math.round(num(d, "exento") ?? 0), tax_minor: Math.round(num(d, "iva") ?? 0), total_minor: Math.round(num(d, "total") ?? 0),
          payment_terms: str(d, "forma_pago") || null, references: str(d, "referencias") || null, void_reason: str(d, "anulada_por") || null,
          documented: d.documentada !== false, notes: str(d, "notas") || null,
          due_date: str(d, "vencimiento") || null,
          terms: historicalTerms(str(d, "forma_pago"), str(d, "referencias"), str(d, "orden_compra")),
        };
      });
      const r = await backend.importHistoricalSales(items);
      if (r.imported || r.updated) dataChanged();
      const errs = r.results.filter((x) => x.status === "error");
      return text([
        `Importadas ${r.imported} · actualizadas ${r.updated ?? 0} · ya estaban ${r.skipped} · con error ${r.errors} · clientes nuevos ${r.customers_created}.`,
        ...r.results.filter((x) => x.status === "actualizada").map((x) => `- Folio ${x.number}: ${x.message ?? "actualizada"}`),
        ...errs.map((x) => `- Folio ${x.number}: ${x.message}`),
      ].join("\n"), r.imported === 0 && r.errors > 0);
    }
    case "listar_documentos_sii": {
      const st = await backend.siiStatus();
      const docs = await backend.siiDocuments(Math.round(num(a, "limite") ?? 30));
      return text([
        `Ambiente: ${st.ambiente === "certificacion" ? "certificación (maullin)" : "producción (palena)"} · emisor ${st.razon_social ?? "?"} ${st.rut ?? ""}`,
        st.faltantes.length ? `Falta para emitir: ${st.faltantes.join("; ")}.` : "Listo para emitir.",
        `Folios: ${st.folios.length ? st.folios.map((f) => `${f.tipo} ${f.tipo_nombre} (${f.ambiente}) ${f.desde}–${f.hasta}, siguiente ${f.siguiente}, quedan ${f.restantes}`).join("; ") : "ninguno"}.`,
        docs.length ? `Documentos (${docs.length}):\n${docs.map(siiLine).join("\n")}` : "Aún no hay documentos.",
        ...(await backend.siiLibros()).map(libroLine),
      ].join("\n"));
    }
    case "cargar_folios_sii": {
      const ruta = str(a, "ruta");
      if (!/\.xml$/i.test(ruta)) throw new Error("Indica la ruta completa del archivo .xml de folios.");
      const st = await backend.siiLoadCaf(ruta);
      dataChanged();
      return text(`Folios cargados. Disponibles: ${st.folios.map((f) => `${f.tipo} ${f.tipo_nombre} (${f.ambiente}) ${f.desde}–${f.hasta}, quedan ${f.restantes}`).join("; ")}.`);
    }
    case "emitir_documento_sii": {
      const tipo = Math.round(num(a, "tipo") ?? 0);
      const rec = (a.receptor ?? {}) as Args;
      const lineas = Array.isArray(a.lineas) ? (a.lineas as Args[]) : [];
      const refs = Array.isArray(a.referencias) ? (a.referencias as Args[]) : [];
      const o = (x: Args, k: string) => str(x, k) || null;
      const fp = str(a, "forma_pago") || "contado";
      const fecha = str(a, "fecha") || null;
      const d = await backend.siiIssue({
        tipo, fecha,
        receptor: { rut: str(rec, "rut"), razon_social: str(rec, "razon_social"), giro: o(rec, "giro"), direccion: o(rec, "direccion"), comuna: o(rec, "comuna"), ciudad: o(rec, "ciudad"), contacto: null, correo: o(rec, "correo") },
        detalle: lineas.map((l) => {
          const q = num(l, "cantidad") ?? 1, p = num(l, "precio"), pct = num(l, "descuento_pct") ?? 0;
          const bruto = p == null ? 0 : Math.round(q * p);
          const desc = pct > 0 ? Math.round((bruto * pct) / 100) : 0;
          return { codigo: null, nombre: str(l, "nombre").slice(0, 80), descripcion: null, cantidad_milli: p == null ? null : Math.round(q * 1000), unidad: o(l, "unidad"),
            precio: p == null ? null : Math.round(p), descuento_pct: pct > 0 ? pct : null, descuento_monto: desc > 0 ? desc : null, monto: bruto - desc, exento: l.exento === true || tipo === 34 };
        }),
        descuentos_globales: (num(a, "descuento_global_pct") ?? 0) > 0 ? [{ recargo: false, glosa: "Descuento global", porcentaje: num(a, "descuento_global_pct"), monto: null, exento: false }] : [],
        referencias: refs.map((r) => ({ tipo: str(r, "tipo"), folio: str(r, "folio") || "0", fecha: str(r, "fecha") || fecha || todayIso(), codigo: num(r, "codigo"), razon: o(r, "razon") })),
        forma_pago: tipo === 52 ? null : fp === "credito" ? 2 : fp === "sin_costo" ? 3 : 1,
        vencimiento: fp === "credito" ? o(a, "vencimiento") : null,
        ind_traslado: tipo === 52 ? Math.round(num(a, "tipo_traslado") ?? 1) : null,
        tipo_despacho: tipo === 52 ? num(a, "tipo_despacho") : null,
        sale_uid: null,
      });
      dataChanged();
      return text(`Timbrado y firmado (aún NO enviado al SII):\n${siiLine(d)}\nPara enviarlo usa enviar_documentos_sii con «${d.tipo}-${d.folio}», después de que la persona lo confirme.`);
    }
    case "enviar_documentos_sii": {
      const refs = Array.isArray(a.documentos) ? (a.documentos as unknown[]).map(String) : [];
      const docs: SiiDocument[] = [];
      for (const r of refs) docs.push(await findSiiDoc(backend, r));
      const ya = docs.filter((d) => d.estado !== "firmado");
      if (ya.length) throw new Error(`Ya fueron enviados: ${ya.map((d) => `${d.tipo}-${d.folio}`).join(", ")}.`);
      const out = await backend.siiSend(docs.map((d) => d.id));
      dataChanged();
      const sent = out.filter((d) => docs.some((x) => x.id === d.id));
      return text(`Enviado al SII (track id ${sent[0]?.track_id ?? "?"}):\n${sent.map(siiLine).join("\n")}\nConsulta el estado en unos minutos con consultar_estado_sii.`);
    }
    case "consultar_estado_sii": {
      const d = await findSiiDoc(backend, str(a, "documento"));
      if (!d.track_id) throw new Error(`${d.tipo}-${d.folio} aún no se envía al SII.`);
      const out = await backend.siiCheck(d.id);
      dataChanged();
      const same = out.filter((x) => x.track_id === d.track_id);
      return text(`Estado del envío ${d.track_id}:\n${same.map(siiLine).join("\n")}`);
    }
    case "crear_libro_sii": {
      const op = str(a, "operacion") === "compra" ? "compra" : "venta";
      const docRefs = Array.isArray(a.documentos) ? (a.documentos as unknown[]).map(String) : [];
      const ids: number[] = [];
      for (const r of docRefs) ids.push((await findSiiDoc(backend, r)).id);
      const compras: SiiLineaLibro[] = (Array.isArray(a.compras) ? (a.compras as Args[]) : []).map((c) => {
        const neto = Math.round(num(c, "neto") ?? 0), exento = Math.round(num(c, "exento") ?? 0);
        const ivaCalc = num(c, "iva") ?? Math.round(neto * 0.19);
        const usoComun = c.iva_uso_comun === true, noRec = num(c, "iva_no_recuperable_codigo"), ret = c.retencion_total === true;
        return {
          tipo: Math.round(num(c, "tipo") ?? 0), folio: Math.round(num(c, "folio") ?? 0), tasa_iva: neto ? 19 : null,
          fecha: str(c, "fecha") || `${str(a, "periodo")}-01`, rut: str(c, "rut"), razon_social: str(c, "razon_social"),
          tipo_ref: num(c, "tipo_ref"), folio_ref: num(c, "folio_ref"), exento, neto,
          iva: usoComun || noRec ? 0 : ivaCalc,
          iva_uso_comun: usoComun ? ivaCalc : null, iva_no_recuperable: noRec ? [noRec, ivaCalc] : null, iva_retenido_total: ret ? ivaCalc : null,
          total: exento + neto + ivaCalc - (ret ? ivaCalc : 0),
        };
      });
      const l = await backend.siiLibroCreate({ operacion: op, periodo: str(a, "periodo"), tipo_libro: (str(a, "tipo_libro") || "MENSUAL") as "MENSUAL", folio_notificacion: num(a, "folio_notificacion"),
        fct_prop: num(a, "factor_proporcionalidad"), documentos: ids, compras });
      dataChanged();
      return text(`Libro firmado (aún NO enviado):\n${libroLine(l)}${compras.length ? `\n${compras.map((c) => `  · ${c.tipo}-${c.folio} ${c.razon_social}: exento ${pesos(c.exento)}, neto ${pesos(c.neto)}, IVA ${pesos(c.iva)}${c.iva_uso_comun ? `, uso común ${pesos(c.iva_uso_comun)}` : ""}${c.iva_no_recuperable ? `, no recuperable ${pesos(c.iva_no_recuperable[1])} (cód. ${c.iva_no_recuperable[0]})` : ""}${c.iva_retenido_total ? `, retenido ${pesos(c.iva_retenido_total)}` : ""}, total ${pesos(c.total)}`).join("\n")}` : ""}`);
    }
    case "enviar_libro_sii": {
      const l = await backend.siiLibroSend(Math.round(num(a, "libro") ?? 0));
      dataChanged();
      return text(`Libro enviado al SII:\n${libroLine(l)}`);
    }
    case "consultar_libro_sii": {
      const l = await backend.siiLibroCheck(Math.round(num(a, "libro") ?? 0));
      dataChanged();
      return text(libroLine(l));
    }
    case "registrar_cobro": {
      const s = await findSale(backend, str(a, "venta"), "por_cobrar");
      const amount = Math.round(num(a, "monto") ?? 0);
      const pending = s.total_minor - s.paid_minor;
      if (amount > pending) throw new Error(`La venta ${s.number} tiene ${pesos(pending)} por cobrar; el monto ${pesos(amount)} es mayor.`);
      const done = await backend.registerPayment(s.uid, amount, METHOD[str(a, "medio") || "transferencia"] ?? "Transferencia", str(a, "fecha") || todayIso());
      dataChanged();
      return text(`Cobro registrado en ${done.number}: ${pesos(amount)}. Queda por cobrar ${pesos(done.total_minor - done.paid_minor)}.`);
    }
  }
  return text(`La herramienta «${name}» no está implementada.`, true);
}
