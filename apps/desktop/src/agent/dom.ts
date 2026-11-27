// Lo que Claude «ve» y «toca» de la pantalla: un resumen en texto de la interfaz, con un identificador
// por cada control, y acciones (clic, escribir, elegir, tecla) que pasan por los mismos eventos que el
// mouse y el teclado, así React reacciona igual que con una persona.
import { NAV, NAV_FOOTER } from "../shell/nav";
import { pointAt } from "./cursor";

const INTERACTIVE = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
  "[role=button]", "[role=tab]", "[role=menuitem]", "[role=option]", "[role=radio]", "[role=checkbox]", "[role=switch]",
  "[role=combobox]", "[contenteditable=true]",
].join(",");

const MAX_ELEMENTS = 180;
const MAX_TEXT = 6000;

let registry = new Map<string, HTMLElement>();

function visible(el: Element): boolean {
  if (el.closest("[aria-hidden=true], [inert], [data-agent-ignore]")) return false;
  // Contenido de un <details> cerrado (menos su título).
  const closed = el.closest("details:not([open])");
  if (closed && !(el.tagName === "SUMMARY" && el.parentElement === closed)) return false;
  if (typeof (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility === "function" && !(el as HTMLElement & { checkVisibility: () => boolean }).checkVisibility()) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
}

function clean(t: string | null | undefined, max = 70): string {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" ");
    if (t.trim()) return clean(t);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const l = el.labels?.[0]?.innerText;
    if (l) return clean(l.replace(/\(opcional\)/, ""));
    if ("placeholder" in el && el.placeholder) return clean(el.placeholder);
    if (el.name) return clean(el.name);
  }
  const text = clean(el.innerText);
  if (text) return text;
  return clean(el.getAttribute("title") ?? el.getAttribute("name") ?? "");
}

function kindOf(el: HTMLElement): string {
  const role = el.getAttribute("role");
  if (role === "tab") return "pestaña";
  if (role === "menuitem") return "opción de menú";
  if (role === "option") return "opción";
  if (role === "radio") return "opción";
  if (role === "checkbox" || role === "switch") return "casilla";
  if (role === "combobox") return "buscador";
  if (el instanceof HTMLSelectElement) return "lista";
  if (el instanceof HTMLTextAreaElement) return "texto largo";
  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case "checkbox": return "casilla";
      case "radio": return "opción";
      case "number": return "número";
      case "date": return "fecha";
      case "file": return "archivo";
      case "search": return "buscador";
      case "email": return "correo";
      case "password": return "contraseña";
      default: return "campo";
    }
  }
  if (el.tagName === "A") return "enlace";
  return "botón";
}

function describe(id: string, el: HTMLElement): string {
  const kind = kindOf(el);
  let line = `[${id}] ${kind} «${labelOf(el) || "sin nombre"}»`;
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") line += el.checked ? " ✓" : " ☐";
    else if (el.type === "password") line += el.value ? " = (escrita)" : " = (vacía)";
    else if (el.type !== "file") line += ` = "${clean(el.value, 80)}"`;
  } else if (el instanceof HTMLTextAreaElement) {
    line += ` = "${clean(el.value, 120)}"`;
  } else if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options).map((o) => clean(o.text, 40));
    line += ` = «${clean(el.selectedOptions[0]?.text ?? "")}»`;
    line += ` (opciones: ${opts.slice(0, 14).join(" | ")}${opts.length > 14 ? ` | … ${opts.length - 14} más` : ""})`;
  }
  const role = el.getAttribute("role");
  if ((role === "tab" || role === "radio" || role === "option") && (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true")) line += " (seleccionada)";
  if ((role === "checkbox" || role === "switch")) line += el.getAttribute("aria-checked") === "true" ? " ✓" : " ☐";
  if (el.getAttribute("aria-current") === "page") line += " (actual)";
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") line += " (desactivado)";
  if (el.getAttribute("aria-invalid") === "true") line += " (con error)";
  return line;
}

/** El diálogo abierto más arriba, si lo hay: mientras está abierto solo se puede usar lo de adentro. */
function topDialog(): HTMLElement | null {
  const ds = Array.from(document.querySelectorAll<HTMLElement>("[role=dialog][aria-modal=true]")).filter(visible);
  return ds.at(-1) ?? null;
}

function sectionName(): string {
  const path = (window.location.hash.replace(/^#/, "") || "/inicio").split("?")[0] ?? "";
  const first = `/${path.split("/").filter(Boolean)[0] ?? "inicio"}`;
  if (first === "/config") return "Configuración";
  const item = [...NAV, ...NAV_FOOTER].find((n) => `/${n.href.split("?")[0]?.split("/")[1] ?? ""}` === first);
  return item?.label ?? first.slice(1);
}

const MAX_ROWS = 60;

/** Una tabla (o grilla) como filas «celda | celda | …», más fácil de leer que una celda por línea. */
function tableText(t: HTMLElement): string {
  const rows = Array.from(t.querySelectorAll<HTMLElement>("[role=row], tr")).filter(visible);
  const out = rows.slice(0, MAX_ROWS).map((r) => {
    const cells = Array.from(r.querySelectorAll<HTMLElement>("[role=gridcell], [role=columnheader], [role=cell], [role=rowheader], td, th"));
    return (cells.length ? cells : [r]).map((c) => clean(c.innerText, 60) || "—").join(" | ");
  });
  if (rows.length > MAX_ROWS) out.push(`… ${rows.length - MAX_ROWS} filas más (usa desplazar o un filtro)`);
  return out.join("\n");
}

function mainText(root: HTMLElement): string {
  const main = root === document.body ? (document.querySelector("main") as HTMLElement | null) ?? document.body : root;
  let t = main.innerText ?? "";
  for (const table of Array.from(main.querySelectorAll<HTMLElement>("[role=grid], [role=table], table"))) {
    if (table.parentElement?.closest("[role=grid], [role=table], table") || !visible(table)) continue;
    const raw = table.innerText.trim();
    if (raw && t.includes(raw)) t = t.replace(raw, `\n${tableText(table)}\n`);
  }
  // Datos secretos (clave de recuperación): Claude no los ve.
  for (const sec of Array.from(main.querySelectorAll<HTMLElement>("[data-agent-secret]"))) {
    const raw = sec.innerText.trim();
    if (raw) t = t.split(raw).join("(dato secreto, oculto para Claude)");
  }
  // Las opciones de las listas ya aparecen en «Controles».
  for (const sel of Array.from(main.querySelectorAll<HTMLSelectElement>("select"))) {
    const raw = sel.innerText.trim();
    if (raw) t = t.replace(raw, "");
  }
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n… (hay más contenido: usa desplazar)` : t;
}

/** Resumen en texto de la pantalla, con identificadores nuevos para cada control visible. */
export function snapshot(): string {
  registry = new Map();
  const dialog = topDialog();
  const root = dialog ?? document.body;
  const lines: string[] = [];
  lines.push(`Sección: ${sectionName()} — ruta ${window.location.hash.replace(/^#/, "") || "/inicio"}`);
  if (dialog) {
    const h = dialog.querySelector("h1,h2,h3");
    lines.push(`Diálogo abierto: «${clean(h?.textContent ?? "", 90)}» (solo se puede usar lo que está adentro; Escape lo cierra)`);
  }
  const toasts = Array.from(document.querySelectorAll<HTMLElement>("[aria-live] > *, [role=alert]")).filter(visible).map((t) => clean(t.innerText, 160)).filter(Boolean);
  if (toasts.length) lines.push(`Avisos: ${[...new Set(toasts)].join(" · ")}`);

  lines.push("", "Contenido:", mainText(root));

  const els = Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE)).filter(visible);
  lines.push("", "Controles:");
  let n = 0;
  for (const el of els) {
    if (n >= MAX_ELEMENTS) { lines.push(`… y ${els.length - n} controles más (desplaza o abre la sección para verlos)`); break; }
    // Una etiqueta que envuelve un input ya cuenta con el input.
    if (el.tagName === "SUMMARY" && !labelOf(el)) continue;
    if (el.closest("[data-agent-secret]")) continue;
    const id = `e${++n}`;
    registry.set(id, el);
    lines.push(describe(id, el) + (el.closest("[data-agent-human]") ? " (solo la persona)" : ""));
  }
  if (n === 0) lines.push("(ninguno)");
  return lines.join("\n");
}

function find(id: string): HTMLElement {
  const key = id.trim().replace(/^\[|\]$/g, "");
  const el = registry.get(key);
  if (!el || !el.isConnected) throw new Error(`No encuentro «${id}» en la pantalla actual. Usa ver_pantalla para obtener identificadores nuevos.`);
  return el;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a que la interfaz termine de reaccionar (sin «Cargando…» y sin cambios por un instante). */
export async function settle(maxMs = 4000): Promise<void> {
  const start = Date.now();
  await sleep(120);
  let last = -1;
  while (Date.now() - start < maxMs) {
    const busy = Array.from(document.querySelectorAll("[role=status]")).some((s) => /cargando|abriendo|guardando/i.test(s.textContent ?? ""));
    const size = document.body.innerHTML.length;
    if (!busy && size === last) return;
    last = size;
    await sleep(150);
  }
}

async function reach(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ block: "center", inline: "nearest" });
  await sleep(60);
  const r = el.getBoundingClientRect();
  await pointAt(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2);
}

function mouse(el: HTMLElement, type: string) {
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: window };
  el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, init));
}

function humanOnly(el: HTMLElement) {
  if (el.closest("[data-agent-human], [data-agent-secret]")) throw new Error("Esta confirmación la tiene que hacer la persona en NÚCLEO, no Claude.");
}

export async function click(id: string): Promise<void> {
  const el = find(id);
  humanOnly(el);
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") throw new Error(`«${labelOf(el)}» está desactivado.`);
  await reach(el);
  mouse(el, "pointerdown"); mouse(el, "mousedown");
  if (typeof el.focus === "function") el.focus({ preventScroll: true });
  mouse(el, "pointerup"); mouse(el, "mouseup");
  el.click();
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
}

export async function type(id: string, text: string, enter = false): Promise<void> {
  const el = find(id);
  humanOnly(el);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.getAttribute("contenteditable") !== "true") {
    throw new Error(`«${labelOf(el)}» no es un campo de texto.`);
  }
  if (el instanceof HTMLInputElement && el.type === "password") throw new Error("Las contraseñas las escribe la persona, no Claude.");
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) throw new Error(`«${labelOf(el)}» no se puede editar.`);
  await reach(el);
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // Se escribe en pocos tramos para que se vea el avance sin hacerlo lento.
    const steps = Math.min(6, Math.max(1, Math.ceil(text.length / 6)));
    for (let i = 1; i <= steps; i++) {
      setNativeValue(el, text.slice(0, Math.round((text.length * i) / steps)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (steps > 1) await sleep(25);
    }
    if (text === "") { setNativeValue(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (enter) key("Enter");
}

export async function choose(id: string, option: string): Promise<string> {
  const el = find(id);
  humanOnly(el);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`«${labelOf(el)}» no es una lista desplegable. Si es un buscador, escribe en él y luego haz clic en la opción.`);
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const want = norm(option);
  const opts = Array.from(el.options);
  const hit = opts.find((o) => norm(o.text) === want || o.value === option) ?? opts.find((o) => norm(o.text).startsWith(want)) ?? opts.find((o) => norm(o.text).includes(want));
  if (!hit) throw new Error(`No hay una opción «${option}». Opciones: ${opts.map((o) => o.text).join(" | ")}`);
  await reach(el);
  el.focus();
  setNativeValue(el, hit.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return hit.text;
}

export function key(k: string): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const init = { key: k, code: k === "Enter" ? "Enter" : k, bubbles: true, cancelable: true, composed: true };
  const down = new KeyboardEvent("keydown", init);
  const ok = target.dispatchEvent(down);
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  if (!ok) return;
  if (k === "Enter" && target instanceof HTMLInputElement && target.form) target.form.requestSubmit();
  if (k === "Tab") {
    const focusables = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE)).filter((e) => visible(e) && !(e as HTMLButtonElement).disabled);
    const i = focusables.indexOf(target);
    focusables[(i + 1) % Math.max(1, focusables.length)]?.focus();
  }
}

function scroller(): HTMLElement {
  const dialog = topDialog();
  const candidates = Array.from((dialog ?? document).querySelectorAll<HTMLElement>("*")).filter((e) => {
    const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4 && visible(e);
  });
  candidates.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
  return candidates[0] ?? (document.scrollingElement as HTMLElement) ?? document.body;
}

export function scroll(dir: "arriba" | "abajo" | "inicio" | "final"): void {
  const s = scroller();
  const page = Math.round(s.clientHeight * 0.75);
  const top = dir === "inicio" ? 0 : dir === "final" ? s.scrollHeight : s.scrollTop + (dir === "abajo" ? page : -page);
  s.scrollTo({ top, behavior: "auto" });
}

/** Rutas por nombre de sección (con o sin tildes). */
const ROUTES: Record<string, string> = {
  inicio: "/inicio", ventas: "/ventas", vender: "/ventas", "nueva venta": "/ventas/nueva", "nueva factura": "/ventas/nueva?doc=factura", "nueva boleta": "/ventas/nueva?doc=boleta",
  "nueva guia": "/ventas/nueva?doc=guia", "nueva guia de despacho": "/ventas/nueva?doc=guia", "factura interna": "/ventas/nueva?tipo=FV",
  cotizaciones: "/ventas?tab=cotizaciones", "nueva cotizacion": "/cotizaciones/nueva", clientes: "/clientes", productos: "/productos",
  "productos y servicios": "/productos", promociones: "/promociones", descuentos: "/promociones", compras: "/compras", comprar: "/compras",
  proveedores: "/compras?tab=proveedores", "nueva orden de compra": "/compras/oc/nueva", "nueva compra": "/compras/doc/nueva",
  inventario: "/inventario", envios: "/envios", gastos: "/gastos", dinero: "/dinero", comex: "/comex", importaciones: "/comex",
  impuestos: "/contabilidad", contabilidad: "/contabilidad", remuneraciones: "/remuneraciones", analisis: "/analisis", reportes: "/analisis",
  "analisis y reportes": "/analisis", documentos: "/documentos", "mi negocio": "/config/negocio", configuracion: "/config/respaldos",
  respaldos: "/config/respaldos", claude: "/config/claude",
};

export function resolveRoute(dest: string): string {
  const d = dest.trim();
  if (d.startsWith("/")) return d;
  if (d.startsWith("#/")) return d.slice(1);
  const k = d.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const r = ROUTES[k];
  if (!r) throw new Error(`No conozco la sección «${dest}». Secciones: ${Object.keys(ROUTES).join(", ")}.`);
  return r;
}
