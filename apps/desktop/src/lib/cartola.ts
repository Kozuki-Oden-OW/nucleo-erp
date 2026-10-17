// Lectura de cartolas bancarias (CSV, TXT, Excel .xlsx y las «.xls» que en realidad son tablas HTML,
// como las que descargan varios bancos chilenos). Devuelve movimientos normalizados: fecha, detalle,
// referencia, monto con signo (abono +, cargo −) y saldo. Las columnas se reconocen por su nombre.

export interface ParsedLine { date: string; description: string; reference: string | null; amount_minor: number; balance_minor: number | null }
export interface ParsedStatement { lines: ParsedLine[]; columns: string[]; skipped: number; warnings: string[] }

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/* ───────────── Montos y fechas ───────────── */

/** «1.234.567», «-1.234», «(1.234)», «$ 1.234,50», «1,234.50» → pesos enteros. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$\s]|CLP|clp/g, "");
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  let n: number;
  if (lastDot >= 0 && lastComma >= 0) {
    n = lastComma > lastDot ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s.replace(/,/g, ""));
  } else if (lastComma >= 0) {
    const dec = s.length - lastComma - 1;
    n = dec <= 2 && s.indexOf(",") === lastComma ? Number(s.replace(",", ".")) : Number(s.replace(/,/g, ""));
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    n = parts.length > 2 || parts[parts.length - 1]!.length === 3 ? Number(s.replace(/\./g, "")) : Number(s);
  } else n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(neg ? -n : n);
}

const pad = (n: number) => String(n).padStart(2, "0");
function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** «31/10/2026», «31-10-26», «2026-10-31», «31/10» (año deducido), «31 oct 2026» o número de serie de Excel. */
export function parseBankDate(raw: string | null | undefined, today: string): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return valid(y, Number(m[2]), Number(m[1])); }
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  m = fold(s).match(/^(\d{1,2})[ -/]?([a-z]{3})[a-z]*[ -/]?(\d{2,4})?/);
  if (m && months.includes(m[2]!)) {
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    const out = valid(y, months.indexOf(m[2]!) + 1, Number(m[1]));
    return out && !m[3] && out > today ? valid(y - 1, months.indexOf(m[2]!) + 1, Number(m[1])) : out;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = Number(today.slice(0, 4));
    const out = valid(y, Number(m[2]), Number(m[1]));
    return out && out > today ? valid(y - 1, Number(m[2]), Number(m[1])) : out;
  }
  return null;
}

/* ───────────── Filas a movimientos ───────────── */

const H = {
  date: /^fecha|^fec\b|^dia$/,
  desc: /descrip|detalle|glosa|concepto|movimiento|transacci|operaci[oó]n$|^nombre/,
  ref: /documento|n[°º.]? ?doc|^doc|referencia|n[°º] ?operaci|^folio|^nro|^numero/,
  debit: /cargo|d[eé]bito|giro|egreso|retiro|salida|debe$/,
  credit: /abono|cr[eé]dito|dep[oó]sito|ingreso|entrada|haber$/,
  amount: /^monto|importe|^valor|^cantidad/,
  balance: /saldo/,
  type: /^tipo|cargo ?\/ ?abono|^c\/a|^d\/c/,
};

export function parseRows(rows: string[][], today: string): ParsedStatement {
  const warnings: string[] = [];
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i]!.map((c) => fold(c ?? ""));
    if (r.some((c) => H.date.test(c)) && r.some((c) => H.debit.test(c) || H.credit.test(c) || H.amount.test(c))) { hi = i; break; }
  }
  if (hi < 0) throw new Error("No encontramos los encabezados de la cartola (Fecha, Descripción, Cargos, Abonos o Monto). Revisa que sea el archivo del banco.");
  const head = rows[hi]!.map((c) => fold(c ?? ""));
  const find = (re: RegExp, not: number[] = []) => head.findIndex((c, i) => !not.includes(i) && re.test(c));
  const date = find(H.date);
  const balance = find(H.balance);
  const typeCol = find(H.type, [date, balance]);
  const debit = find(H.debit, [date, balance, typeCol]);
  const credit = find(H.credit, [date, balance, debit, typeCol]);
  const amount = debit < 0 && credit < 0 ? find(H.amount, [date, balance, typeCol]) : -1;
  const type = amount >= 0 ? typeCol : -1;
  const desc = find(H.desc, [date, debit, credit, amount, balance, typeCol]);
  const ref = find(H.ref, [date, debit, credit, amount, balance, desc, typeCol]);
  if (debit < 0 && credit < 0 && amount < 0) throw new Error("No encontramos las columnas de montos (Cargos y Abonos, o Monto).");
  const columns = [date, desc, ref, debit, credit, amount, balance].filter((i) => i >= 0).map((i) => rows[hi]![i]!.trim());
  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(hi + 1)) {
    const cell = (i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const d = parseBankDate(cell(date), today);
    let value: number | null = null;
    if (amount >= 0) {
      value = parseAmount(cell(amount));
      const t = fold(cell(type));
      if (value !== null && t) {
        if (/cargo|debito|giro|egreso|^c$|^d$/.test(t) && !/abono|credito/.test(t)) value = -Math.abs(value);
        else if (/abono|credito|deposito|ingreso|^a$/.test(t)) value = Math.abs(value);
      }
    } else {
      const de = parseAmount(cell(debit)) ?? 0, cr = parseAmount(cell(credit)) ?? 0;
      value = Math.abs(cr) - Math.abs(de);
    }
    const text = desc >= 0 ? cell(desc) : row.filter((_, i) => ![date, debit, credit, amount, balance, ref].includes(i)).join(" ").trim();
    if (!d || !value) { if (row.some((c) => String(c ?? "").trim())) skipped++; continue; }
    if (/saldo (inicial|anterior|final)|^total/.test(fold(text))) { skipped++; continue; }
    lines.push({ date: d, description: text.replace(/\s+/g, " ") || "Movimiento", reference: cell(ref) || null, amount_minor: value, balance_minor: balance >= 0 ? parseAmount(cell(balance)) : null });
  }
  if (lines.length === 0) throw new Error("La cartola no trae movimientos con fecha y monto.");
  const future = lines.filter((l) => l.date > today).length;
  if (future) warnings.push(`${future} movimientos tienen fecha futura: revisa el formato de fecha del archivo.`);
  return { lines, columns, skipped, warnings };
}

/* ───────────── Formatos de archivo ───────────── */

export function parseCsv(text: string): string[][] {
  const sample = text.split(/\r?\n/).slice(0, 15).join("\n");
  const count = (ch: string) => sample.split(ch).length;
  const sep = [";", "\t", ",", "|"].sort((a, b) => count(b) - count(a))[0]!;
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", deg: "°", ordm: "º" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));

/** Tabla HTML (las «.xls» de varios bancos) → filas. */
export function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1]!.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim());
    if (cells.length) rows.push(cells);
  }
  return rows;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Archivos de un .zip (solo los pedidos), con su contenido como texto. */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf), u8 = new Uint8Array(buf), out = new Map<string, string>();
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66_000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("El archivo Excel está dañado o no es .xlsx.");
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const td = new TextDecoder("utf-8");
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    out.set(name, td.decode(method === 8 ? await inflate(raw) : raw));
  }
  return out;
}

/** Primera hoja de un .xlsx → filas (los números quedan como texto; las fechas como serie de Excel). */
export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheetName = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new Error("El archivo Excel no tiene hojas.");
  const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const rows: string[][] = [];
  for (const rm of files.get(sheetName)!.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, body = cm[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/t="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const val = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")) : decode(v);
      const i = ref ? colIndex(ref) : row.length;
      while (row.length < i) row.push("");
      row[i] = val;
    }
    rows.push(row);
  }
  return rows;
}

function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

/** Lee el archivo de la cartola que eligió el usuario. */
export async function readStatementFile(file: File, today: string): Promise<ParsedStatement> {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf.slice(0, 8));
  const name = file.name.toLowerCase();
  let rows: string[][];
  if (u8[0] === 0x50 && u8[1] === 0x4b) rows = await parseXlsx(buf);
  else if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error("Este Excel tiene el formato antiguo (.xls). Ábrelo en Excel y guárdalo como .xlsx o .csv, y vuelve a subirlo.");
  else {
    const text = decodeText(buf);
    rows = /<table|<tr/i.test(text.slice(0, 20_000)) || name.endsWith(".html") || name.endsWith(".htm") ? parseHtmlTable(text) : parseCsv(text);
  }
  return parseRows(rows, today);
}

/* ───────────── Categoría sugerida (igual que bank_ops::guess_category en Rust) ───────────── */

const CATEGORY_RULES: [string[], string][] = [
  [["copec", "shell", "petrobras", "enex", "aramco", "terpel", "bencin", "combustible"], "Combustible"],
  [["autopista", "peaje", "costanera", "vespucio", "tag ", "estacionam", "parking", "ruta 5", "ruta 68"], "Peajes y estacionamientos"],
  [["entel", "movistar", "claro", "wom ", "vtr", "gtd", "mundo pacifico", "telefonica", "internet"], "Internet y telefonía"],
  [["enel", "cge", "chilquinta", "saesa", "frontel", "luz "], "Electricidad"],
  [["aguas andinas", "essbio", "esval", "nuevosur", "aguas del", "agua potable", "smapa"], "Agua"],
  [["metrogas", "abastible", "lipigas", "gasco"], "Gas"],
  [["arriendo"], "Arriendo"],
  [["remuneracion", "sueldo", "liquidacion"], "Remuneraciones"],
  [["honorario"], "Honorarios"],
  [["seguro"], "Seguros"],
  [["interes"], "Intereses de créditos"],
  [["tesoreria", "tgr ", "servicio de impuestos", "contribucion", "impuesto", "f29", "formulario 29"], "Impuestos y contribuciones"],
  [["comision", "mantencion cuenta", "cargo mantencion", "costo mantencion", "timbre"], "Comisiones bancarias"],
  [["google ads", "facebook", "meta platforms", "fb me", "instagram", "mercado ads", "publicidad"], "Publicidad y marketing"],
  [["google", "microsoft", "adobe", "amazon web", "aws", "apple com", "dropbox", "zoom", "shopify", "wix", "hostgator", "canva", "openai", "anthropic", "software"], "Software"],
  [["mercado pago", "mercadopago", "transbank", "getnet", "flow ", "khipu", "sumup"], "Comisiones de venta y plataformas"],
  [["uber", "cabify", "didi", "metro ", "bip ", "turbus", "pullman", "taxi"], "Transporte"],
  [["latam", "sky airline", "jetsmart", "pasaje"], "Viajes y pasajes"],
  [["hotel", "airbnb", "booking", "hostal"], "Alojamiento"],
  [["restaurant", "rest ", "cafe", "starbucks", "mcdonald", "burger", "pedidosya", "rappi", "uber eats", "sushi", "pizza"], "Alimentación y comidas"],
  [["libreria", "office", "papeleria"], "Útiles de oficina"],
  [["chilexpress", "starken", "correos de chile", "bluexpress", "blue express"], "Logística"],
  [["sodimac", "easy ", "construmart", "imperial"], "Materiales"],
  [["contador", "contabilidad", "asesoria"], "Contabilidad y asesorías"],
];

export function guessCategory(description: string): string | null {
  const d = ` ${fold(description).replace(/[^a-z0-9ñ]+/g, " ").trim()} `;
  return CATEGORY_RULES.find(([keys]) => keys.some((k) => d.includes(` ${k}`)))?.[1] ?? null;
}
