// Texto que recibe Claude del Navegador de NÚCLEO: la página con sus marcos y los controles numerados.
import type { BrowserControl, BrowserPage, BrowserPageState } from "../data/types";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** La dirección sin parámetros: no aportan y pueden llevar datos de la sesión. */
export function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u.split("?")[0] ?? u;
  }
}

function controlLine(c: BrowserControl): string {
  let s = `[w${c.n}] ${c.k} «${c.l}»`;
  if (c.k === "clave") s += c.v ? " (con contenido)" : " (la rellena NÚCLEO: web_ingresar)";
  else if (c.v !== undefined && c.v !== "") s += ` = «${c.v}»`;
  if (c.o?.length) s += ` (opciones: ${c.o.join(" | ")})`;
  if (c.d) s += " (desactivado)";
  return s;
}

export function stateLines(st: BrowserPageState): string[] {
  const out: string[] = [];
  if (st.loading) out.push("La página todavía está cargando: vuelve a leerla en un momento.");
  if (st.blocked) out.push(`Bloqueado: la página quiso ir a ${st.blocked}, que no está entre los sitios permitidos. Si hace falta, la persona lo agrega en Configuración → Integraciones → Navegador.`);
  const last = st.downloads.slice(-3);
  if (last.length) out.push(`Descargas recientes (${st.folder}): ${last.map((d) => (d.ok ? d.name : `${d.name || "archivo"} — ${d.note ?? "falló"}`)).join(" · ")}`);
  return out;
}

const LIMIT = 14000;
const MAX_CONTROLS = 160;

/** Página completa, o solo lo que contiene `buscar`; `desde` continúa un texto largo. */
export function formatPage(page: BrowserPage, st: BrowserPageState, buscar = "", desde = 0): string {
  const head = [`Navegador de NÚCLEO — ${page.title || "(sin título)"}`, shortUrl(page.url ?? st.url), ...stateLines(st)];
  const frames = page.frames ?? [];
  const q = norm(buscar.trim());
  const body: string[] = [];
  const controls: string[] = [];
  for (const f of frames) {
    const label = f.path === "" ? "" : `── Marco ${f.path} · ${shortUrl(f.href)} ──`;
    let lines = f.text.split("\n");
    let cs = f.controls;
    if (q) {
      lines = lines.filter((l) => norm(l).includes(q));
      cs = cs.filter((c) => norm(`${c.l} ${c.v ?? ""}`).includes(q));
    }
    if (lines.join("").trim()) {
      if (label) body.push(label);
      if (f.type && /pdf/i.test(f.type)) body.push("(documento PDF: se guarda con web_guardar)");
      body.push(...lines);
    } else if (!q && f.type && /pdf/i.test(f.type)) {
      body.push(label || "── Página ──", "(documento PDF: se guarda con web_guardar)");
    }
    if (cs.length) {
      if (label) controls.push(label);
      controls.push(...cs.map(controlLine));
    }
  }
  const full = body.join("\n");
  const start = Math.min(Math.max(0, Math.trunc(desde)), full.length);
  const slice = full.slice(start, start + LIMIT);
  const out = [...head, ""];
  if (q) out.push(`Coincidencias con «${buscar.trim()}»:`);
  out.push(slice || (q ? "(ninguna línea)" : "(la página no tiene texto)"));
  if (start + LIMIT < full.length) out.push(`\n[…sigue: web_leer con desde=${start + LIMIT} — ${full.length - start - LIMIT} caracteres más; o usa «buscar»]`);
  if (start === 0 || q) {
    out.push("", "Controles:");
    if (!controls.length) out.push(q ? "(ninguno calza)" : "(ninguno)");
    else {
      out.push(...controls.slice(0, MAX_CONTROLS));
      if (controls.length > MAX_CONTROLS) out.push(`… ${controls.length - MAX_CONTROLS} más: usa «buscar» para encontrarlos`);
    }
  }
  return out.join("\n");
}

/** «w12» → 12. */
export function refNumber(s: string): number | null {
  const m = /^\s*w?(\d{1,5})\s*$/i.exec(s);
  return m ? Number(m[1]) : null;
}
