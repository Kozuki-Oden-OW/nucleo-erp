// Herramientas que NÚCLEO ofrece a Claude (definidas en tools.json, compartido con el puente en Rust).
// Las de pantalla actúan sobre la interfaz; las de datos usan el mismo Backend que las pantallas, así
// valen las mismas reglas, permisos y auditoría.
import type { Backend } from "../data";
import { errorMessage } from "../data";
import type { Customer, LineInput, Product, SaleSummary, Supplier } from "../data/types";
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
  if (!/^\d{6,9}[0-9K]$/.test(k) || k === q) return a;
  const b = await search(k);
  return [...a, ...b.filter((x) => !a.some((y) => y.uid === x.uid))];
}

const METHOD: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta de débito", cheque: "Cheque", credito: "" };

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
