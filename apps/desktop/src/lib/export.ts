// Exportar un reporte a Excel (.xlsx) o CSV, sin bibliotecas externas: el archivo se arma aquí
// (XML de Office Open dentro de un ZIP sin compresión) y funciona igual en el escritorio y en la
// demostración. Los montos van como números con formato chileno; las fechas, como fechas de Excel.
import type { Report, ReportCell, ReportColumnKind } from "../data/types";

/* ───────────── ZIP (método «store») ───────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fecha fija (1-1-2026 00:00): el contenido no depende de la hora.
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

/* ───────────── Valores ───────────── */

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]}-${ym.slice(0, 4)}` : ym;
}

/** Valor "humano" para CSV: números sin separador de miles y con coma decimal. */
function csvValue(v: ReportCell, kind: ReportColumnKind): string {
  if (v === null) return "";
  if (typeof v === "string") {
    if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`;
    if (kind === "month") return monthLabel(v);
    return v;
  }
  switch (kind) {
    case "qty": return String(v / 1000).replace(".", ",");
    case "pct": return String(Math.round(v / 100) / 100).replace(".", ",");
    case "ratio": return String(v / 100).replace(".", ",");
    case "fx": return String(v / 100).replace(".", ",");
    default: return String(v);
  }
}

function csvEscape(s: string): string {
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con punto y coma (como lo abre Excel en Chile), UTF-8 con BOM y fin de línea CRLF. */
export function reportToCsv(r: Report): Uint8Array {
  const lines: string[] = [];
  lines.push(r.columns.map((c) => csvEscape(c.label)).join(";"));
  for (const row of r.rows) lines.push(row.map((v, i) => csvEscape(csvValue(v, r.columns[i]!.kind))).join(";"));
  if (r.totals) lines.push(r.totals.map((v, i) => csvEscape(csvValue(v, r.columns[i]!.kind))).join(";"));
  const body = new TextEncoder().encode(lines.join("\r\n") + "\r\n");
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

/* ───────────── XLSX ───────────── */

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Caracteres de control no válidos en XML.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Días desde el 30-12-1899 (fecha serial de Excel). */
function excelDate(iso: string): number {
  return Math.round((Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// Estilos: 0 normal · 1 título · 2 encabezado · 3 pesos · 4 cantidad · 5 porcentaje · 6 entero · 7 fecha · 8 razón ·
// 9..13 lo mismo en negrita para la fila de totales (9 texto, 10 pesos, 11 cantidad, 12 %, 13 entero) · 14 decimal 2
const STYLE: Record<ReportColumnKind, number> = { text: 0, rut: 0, month: 0, money: 3, qty: 4, pct: 5, int: 6, days: 6, date: 7, ratio: 8, fx: 14 };
const STYLE_TOTAL: Record<ReportColumnKind, number> = { text: 9, rut: 9, month: 9, money: 10, qty: 11, pct: 12, int: 13, days: 13, date: 9, ratio: 9, fx: 9 };

function cellXml(ref: string, v: ReportCell, kind: ReportColumnKind, total: boolean): string {
  const st = total ? STYLE_TOTAL[kind] : STYLE[kind];
  if (v === null || v === "") return "";
  if (typeof v === "string") {
    if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="${st}"><v>${excelDate(v)}</v></c>`;
    const text = kind === "month" ? monthLabel(v) : v;
    return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
  }
  const n = kind === "qty" ? v / 1000 : kind === "pct" ? v / 1_000_000 : kind === "ratio" || kind === "fx" ? v / 100 : v;
  return `<c r="${ref}" s="${st}"><v>${n}</v></c>`;
}

export function reportToXlsx(r: Report, business: string): Uint8Array {
  const enc = new TextEncoder();
  const ncol = r.columns.length;
  const rows: string[] = [];
  const period = r.uses_period ? `Del ${csvValue(r.from, "date")} al ${csvValue(r.to, "date")}` : `Al ${csvValue(r.to, "date")}`;
  rows.push(`<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>${xml(r.title)}</t></is></c></row>`);
  rows.push(`<row r="2"><c r="A2" t="inlineStr"><is><t>${xml(`${business} · ${period} · NÚCLEO ERP`)}</t></is></c></row>`);
  const header = 4;
  rows.push(`<row r="${header}">${r.columns.map((c, i) => `<c r="${colName(i)}${header}" s="2" t="inlineStr"><is><t>${xml(c.label)}</t></is></c>`).join("")}</row>`);
  let n = header;
  for (const row of r.rows) {
    n++;
    rows.push(`<row r="${n}">${row.map((v, i) => cellXml(`${colName(i)}${n}`, v, r.columns[i]!.kind, false)).join("")}</row>`);
  }
  if (r.totals) {
    n++;
    rows.push(`<row r="${n}">${r.totals.map((v, i) => cellXml(`${colName(i)}${n}`, v, r.columns[i]!.kind, true)).join("")}</row>`);
  }
  if (r.notes.length) {
    n++;
    for (const note of r.notes) { n++; rows.push(`<row r="${n}"><c r="A${n}" t="inlineStr"><is><t xml:space="preserve">${xml(note)}</t></is></c></row>`); }
  }
  const widths = r.columns.map((c, i) => {
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 500).map((row) => { const v = row[i]; return v === null || v === undefined ? 0 : String(typeof v === "number" ? csvValue(v, c.kind) : v).length + (c.kind === "money" ? 3 : 0); }));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(9, longest + 2))}" customWidth="1"/>`;
  }).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols><sheetData>${rows.join("")}</sheetData>
${r.rows.length ? `<autoFilter ref="A${header}:${colName(ncol - 1)}${header + r.rows.length}"/>` : ""}
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="6"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0;[Red]\\-&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="#,##0.###"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="dd\\-mm\\-yyyy"/><numFmt numFmtId="168" formatCode="0.00"/><numFmt numFmtId="169" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F1F2"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"><color rgb="FF8A9BA0"/></top></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="3" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const sheetName = xml(r.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  const files = [
    { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${r.rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$${header}:$${colName(ncol - 1)}$${header + r.rows.length}</definedName></definedNames>` : ""}</workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
    { name: "xl/styles.xml", data: enc.encode(styles) },
  ];
  return zipStore(files);
}

/** Nombre de archivo sugerido: "ventas_producto_2026-10-01_2026-10-31.xlsx". */
export function reportFileName(r: Report, ext: "xlsx" | "csv"): string {
  return r.uses_period ? `${r.id}_${r.from}_${r.to}.${ext}` : `${r.id}_${r.to}.${ext}`;
}
