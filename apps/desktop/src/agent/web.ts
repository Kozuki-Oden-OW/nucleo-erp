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

const alertLines = (p: BrowserPage) => (p.alerts ?? []).map((a) => `Aviso de la página: «${a}»`);

/**
 * Lo que cambió en la página después de una acción (los controles conservan su número entre
 * lecturas). Devuelve null cuando conviene mostrar la página completa: no hay lectura anterior, la
 * página es otra o cambió casi todo.
 */
export function formatChange(before: BrowserPage | null, after: BrowserPage, st: BrowserPageState): string | null {
  if (!before || shortUrl(before.url ?? "") !== shortUrl(after.url ?? st.url)) return null;
  const old = new Map((before.frames ?? []).map((f) => [f.path, f]));
  const text: string[] = [];
  const controls: string[] = [];
  const gone: number[] = [];
  let chars = 0;
  for (const f of after.frames ?? []) {
    const prev = old.get(f.path);
    const same = prev && shortUrl(prev.href) === shortUrl(f.href) ? prev : null;
    const seen = new Map<string, number>();
    for (const l of same?.text.split("\n") ?? []) { const k = l.trim(); if (k) seen.set(k, (seen.get(k) ?? 0) + 1); }
    const fresh: string[] = [];
    for (const l of f.text.split("\n")) {
      const k = l.trim();
      if (!k) continue;
      const n = seen.get(k) ?? 0;
      if (n > 0) seen.set(k, n - 1); else fresh.push(k);
    }
    const had = new Set((same?.controls ?? []).map(controlLine));
    const cs = f.controls.filter((c) => !had.has(controlLine(c))).map(controlLine);
    if (same) { const now = new Set(f.controls.map((c) => c.n)); for (const c of same.controls) if (!now.has(c.n)) gone.push(c.n); }
    const label = f.path === "" ? [] : [`── Marco ${f.path} · ${shortUrl(f.href)} ──`];
    if (fresh.length) { text.push(...label, ...fresh); chars += fresh.join("\n").length; }
    if (cs.length) controls.push(...label, ...cs);
  }
  if (chars > 5000 || controls.length > 90) return null;
  const out = [`La página sigue siendo: ${after.title || "(sin título)"} — ${shortUrl(after.url ?? st.url)}`, ...stateLines(st), ...alertLines(after)];
  if (!text.length && !controls.length && !gone.length) out.push("Sin cambios visibles. Los controles conservan su número.");
  if (text.length) out.push("", "Texto nuevo:", ...text);
  if (controls.length) out.push("", "Controles nuevos o cambiados:", ...controls);
  if (gone.length) out.push("", `Ya no están: ${gone.slice(0, 40).map((n) => `w${n}`).join(", ")}${gone.length > 40 ? "…" : ""}`);
  if (text.length || controls.length || gone.length) out.push("", "Los demás controles conservan su número. Para ver todo: web_leer.");
  return out.join("\n");
}

const LIMIT = 14000;
const MAX_CONTROLS = 160;

/** Página completa, o solo lo que contiene `buscar`; `desde` continúa un texto largo. */
export function formatPage(page: BrowserPage, st: BrowserPageState, buscar = "", desde = 0): string {
  const head = [`Navegador de NÚCLEO — ${page.title || "(sin título)"}`, shortUrl(page.url ?? st.url), ...stateLines(st), ...alertLines(page)];
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
