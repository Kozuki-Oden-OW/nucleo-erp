// Facturación SII → «Nuevo documento»: arma una factura, exenta, nota de crédito/débito o guía, la
// timbra con el siguiente folio del CAF y la firma con el certificado. NO la envía: el envío al SII es
// un paso aparte (y se confirma), así se puede revisar el documento antes.
import { useEffect, useMemo, useState } from "react";
import { Plus, Stamp, Trash2 } from "lucide-react";
import { errorMessage, useBackend, type SiiDetalle, type SiiDocument, type SiiFolios, type SiiIssueInput, type SiiReferencia } from "../../data";
import { formatCLP } from "../../lib/format";
import { Button, Checkbox, Field, IconButton, Notice, Select } from "../../ui/kit";
import { Dialog } from "../../ui/overlay";

export const DTE_TIPOS = [
  { value: 33, label: "Factura electrónica" },
  { value: 34, label: "Factura exenta" },
  { value: 61, label: "Nota de crédito" },
  { value: 56, label: "Nota de débito" },
  { value: 52, label: "Guía de despacho" },
] as const;

const REF_TIPOS = [
  { value: "SET", label: "SET — caso del set de pruebas" },
  { value: "33", label: "33 — Factura electrónica" },
  { value: "34", label: "34 — Factura exenta" },
  { value: "61", label: "61 — Nota de crédito" },
  { value: "56", label: "56 — Nota de débito" },
  { value: "52", label: "52 — Guía de despacho" },
  { value: "801", label: "801 — Orden de compra" },
  { value: "HES", label: "HES — Hoja de entrada de servicio" },
];

const TRASLADOS = ["Constituye venta", "Venta por efectuar", "Consignación", "Entrega gratuita", "Traslado interno", "Otros traslados", "Guía de devolución"]
  .map((label, i) => ({ value: String(i + 1), label }));

interface LineForm { nombre: string; cantidad: string; precio: string; descuento: string; unidad: string; exento: boolean }
const emptyLine = (): LineForm => ({ nombre: "", cantidad: "1", precio: "", descuento: "", unidad: "", exento: false });
const emptyRef = (tipo = "SET"): SiiReferencia => ({ tipo, folio: "", fecha: "", codigo: null, razon: null });

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Neto de la línea como lo calcula el SII: cantidad × precio, menos el descuento, redondeado. */
export function lineAmounts(l: LineForm) {
  const q = num(l.cantidad || "0"), p = num(l.precio || "0"), pct = num(l.descuento || "0");
  if (!Number.isFinite(q) || !Number.isFinite(p) || !Number.isFinite(pct)) return null;
  const bruto = Math.round(q * p);
  const desc = pct > 0 ? Math.round((bruto * pct) / 100) : 0;
  return { q, p, pct, desc, monto: bruto - desc };
}

export function SiiIssueDialog({ open, onClose, folios, ambiente, onIssued, initial = null }: {
  open: boolean;
  onClose: () => void;
  folios: SiiFolios[];
  ambiente: string;
  onIssued: (d: SiiDocument) => void;
  /** Borrador ya armado (por ejemplo, desde una venta): se revisa y se timbra. */
  initial?: SiiIssueInput | null;
}) {
  const backend = useBackend();
  const disponibles = useMemo(() => new Set(folios.filter((f) => f.ambiente === ambiente && f.restantes > 0).map((f) => f.tipo)), [folios, ambiente]);
  const [tipo, setTipo] = useState<number>(33);
  const [fecha, setFecha] = useState("");
  const [rec, setRec] = useState({ rut: "", razon_social: "", giro: "", direccion: "", comuna: "", ciudad: "", correo: "" });
  const [formaPago, setFormaPago] = useState("1");
  const [venc, setVenc] = useState("");
  const [traslado, setTraslado] = useState("1");
  const [despacho, setDespacho] = useState("");
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [refs, setRefs] = useState<SiiReferencia[]>([]);
  const [dg, setDg] = useState("");
  // Tasa de IVA de la empresa (Configuración → Mi negocio); NÚCLEO no la escribe en el código.
  const [taxPpm, setTaxPpm] = useState<number>(0);
  useEffect(() => { void backend.business().then((b) => setTaxPpm(b.tax_enabled ? b.tax_rate_ppm ?? 0 : 0)).catch(() => setTaxPpm(0)); }, [backend]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Con un borrador de venta, las líneas que no se tocan se timbran con sus montos exactos.
  const [tocado, setTocado] = useState(false);
  useEffect(() => {
    if (!open || !initial) return;
    const r0 = initial.receptor;
    setTipo(initial.tipo); setFecha(initial.fecha ?? "");
    setRec({ rut: r0.rut, razon_social: r0.razon_social, giro: r0.giro ?? "", direccion: r0.direccion ?? "", comuna: r0.comuna ?? "", ciudad: r0.ciudad ?? "", correo: r0.correo ?? "" });
    setFormaPago(String(initial.forma_pago ?? 1)); setVenc(initial.vencimiento ?? "");
    setLines(initial.detalle.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad_milli == null ? "" : String(l.cantidad_milli / 1000).replace(".", ","), precio: l.precio == null ? "" : String(l.precio),
      descuento: l.descuento_pct ? String(l.descuento_pct).replace(".", ",") : "", unidad: l.unidad ?? "", exento: l.exento })));
    setRefs(initial.referencias.map((x) => ({ ...x })));
    setDg(""); setTocado(false); setError(null);
  }, [open, initial]);

  const isNota = tipo === 61 || tipo === 56;
  const amounts = lines.map((l, i) => { const a = lineAmounts(l); const fijo = initial && !tocado ? initial.detalle[i] : undefined; return a && fijo ? { ...a, monto: fijo.monto } : a; });
  const netoLineas = lines.reduce((a, l, i) => a + (!l.exento && tipo !== 34 ? amounts[i]?.monto ?? 0 : 0), 0);
  const dgPct = Number(dg.replace(",", ".")) || 0;
  const dgMonto = dgPct > 0 ? Math.round((netoLineas * dgPct) / 100) : 0;
  const neto = netoLineas - dgMonto;
  const exento = lines.reduce((a, l, i) => a + (l.exento || tipo === 34 ? amounts[i]?.monto ?? 0 : 0), 0);
  const iva = Math.round((neto * taxPpm) / 1_000_000);
  const setLine = (i: number, p: Partial<LineForm>) => { setTocado(true); setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l))); };
  const setRef = (i: number, p: Partial<SiiReferencia>) => setRefs(refs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const r = (k: keyof typeof rec) => ({ value: rec[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRec({ ...rec, [k]: e.target.value }) });
  const opt = (s: string) => (s.trim() ? s.trim() : null);

  const submit = async () => {
    setError(null);
    try {
      const detalle: SiiDetalle[] = initial && !tocado ? initial.detalle.map((l) => ({ ...l, exento: l.exento || tipo === 34 })) : lines.filter((l) => l.nombre.trim() || l.precio).map((l, i) => {
        const a = lineAmounts(l);
        if (!l.nombre.trim()) throw new Error(`Falta el nombre en la línea ${i + 1}.`);
        if (!a) throw new Error(`Revisa cantidad, precio o descuento en la línea ${i + 1}.`);
        const conPrecio = l.precio.trim() !== "";
        return {
          codigo: null, nombre: l.nombre.trim().slice(0, 80), descripcion: null,
          cantidad_milli: conPrecio ? Math.round(a.q * 1000) : null, unidad: opt(l.unidad),
          precio: conPrecio ? Math.round(a.p) : null,
          descuento_pct: a.pct > 0 ? a.pct : null, descuento_monto: a.desc > 0 ? a.desc : null,
          monto: conPrecio ? a.monto : 0, exento: l.exento || tipo === 34,
        };
      });
      if (!detalle.length) throw new Error("Agrega al menos una línea.");
      const referencias = refs.filter((x) => x.tipo && (x.folio || x.razon)).map((x) => ({ ...x, folio: x.folio.trim() || "0", fecha: x.fecha || fecha || new Date().toISOString().slice(0, 10), razon: opt(x.razon ?? "") }));
      const input: SiiIssueInput = {
        tipo, fecha: fecha || null,
        receptor: { rut: rec.rut.trim(), razon_social: rec.razon_social.trim(), giro: opt(rec.giro), direccion: opt(rec.direccion), comuna: opt(rec.comuna), ciudad: opt(rec.ciudad), contacto: null, correo: opt(rec.correo) },
        detalle, referencias,
        descuentos_globales: dgPct > 0 ? [{ recargo: false, glosa: "Descuento global", porcentaje: dgPct, monto: null, exento: false }] : [],
        forma_pago: tipo === 52 ? null : Number(formaPago), vencimiento: formaPago === "2" ? venc || null : null,
        ind_traslado: tipo === 52 ? Number(traslado) : null, tipo_despacho: tipo === 52 && despacho ? Number(despacho) : null,
        sale_uid: initial?.sale_uid ?? null,
      };
      setBusy(true);
      const d = await backend.siiIssue(input);
      onIssued(d);
      setLines([emptyLine()]); setRefs([]);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Nuevo documento tributario"
      footer={<>
        <span className="mr-auto text-xs text-muted">Se timbra y firma en tu computador. El envío al SII es aparte.</span>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button icon={Stamp} onClick={() => void submit()} disabled={busy || !disponibles.has(tipo)}>{busy ? "Firmando…" : "Timbrar y firmar"}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Documento" value={String(tipo)} onChange={(e) => { const t = Number(e.target.value); setTipo(t); if ((t === 61 || t === 56) && !refs.some((x) => x.codigo)) setRefs([...refs, { ...emptyRef("33"), codigo: 1 }]); }}
            options={DTE_TIPOS.map((t) => ({ value: String(t.value), label: `${t.label}${disponibles.has(t.value) ? "" : " (sin folios)"}` }))} />
          <Field label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} hint="Vacío: hoy." />
          {tipo === 52 ? (
            <Select label="Tipo de traslado" value={traslado} onChange={(e) => setTraslado(e.target.value)}
              options={TRASLADOS} />
          ) : (
            <Select label="Forma de pago" value={formaPago} onChange={(e) => setFormaPago(e.target.value)}
              options={[{ value: "1", label: "Contado" }, { value: "2", label: "Crédito" }, { value: "3", label: "Sin costo" }]} />
          )}
          {formaPago === "2" && tipo !== 52 && <Field label="Vencimiento" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />}
          {tipo === 52 && (
            <Select label="Despacho" value={despacho} onChange={(e) => setDespacho(e.target.value)}
              options={[{ value: "", label: "Sin indicar" }, { value: "1", label: "Por cuenta del receptor" }, { value: "2", label: "Emisor a instalaciones del cliente" }, { value: "3", label: "Emisor a otras instalaciones" }]} />
          )}
        </div>
        {!disponibles.has(tipo) && <Notice tone="warning">No hay folios de este documento en {ambiente === "certificacion" ? "certificación" : "producción"}. Timbra folios en el SII y carga el CAF.</Notice>}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Receptor</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="RUT" placeholder="76.123.456-7" {...r("rut")} />
            <Field label="Razón social" maxLength={100} {...r("razon_social")} />
            <Field label="Giro" maxLength={40} optional={tipo === 52 || isNota} {...r("giro")} />
            <Field label="Dirección" maxLength={70} {...r("direccion")} />
            <Field label="Comuna" maxLength={20} {...r("comuna")} />
            <Field label="Ciudad" maxLength={20} optional {...r("ciudad")} />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Detalle</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_4.5rem_auto] items-end gap-2">
              <Field label={i === 0 ? "Producto o servicio" : undefined} aria-label="Producto o servicio" value={l.nombre} maxLength={80} onChange={(e) => setLine(i, { nombre: e.target.value })} />
              <Field label={i === 0 ? "Cant." : undefined} aria-label="Cantidad" inputMode="decimal" value={l.cantidad} onChange={(e) => setLine(i, { cantidad: e.target.value })} />
              <Field label={i === 0 ? "Precio neto" : undefined} aria-label="Precio unitario neto" inputMode="decimal" value={l.precio} onChange={(e) => setLine(i, { precio: e.target.value })} />
              <Field label={i === 0 ? "Desc. %" : undefined} aria-label="Descuento en porcentaje" inputMode="decimal" value={l.descuento} onChange={(e) => setLine(i, { descuento: e.target.value })} />
              <div className="flex items-center gap-1 pb-1">
                <span className="w-20 text-right text-sm tabular-nums">{amounts[i] ? formatCLP(amounts[i]!.monto) : "—"}</span>
                <IconButton icon={Trash2} label="Quitar línea" onClick={() => { setTocado(true); setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [emptyLine()]); }} />
              </div>
              {tipo !== 34 && tipo !== 52 && <div className="col-span-5 -mt-1"><Checkbox label="Línea exenta de IVA" checked={l.exento} onChange={(v) => setLine(i, { exento: v })} /></div>}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setTocado(true); setLines([...lines, emptyLine()]); }}>Agregar línea</Button>
            {tipo !== 34 && <Field className="w-44" label="Descuento global %" inputMode="decimal" value={dg} onChange={(e) => setDg(e.target.value)} optional hint="Sobre las líneas afectas." />}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Referencias {isNota && <span className="text-xs font-normal text-muted">(la nota debe indicar el documento que corrige)</span>}</legend>
          {refs.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
              <Select label="Tipo" value={x.tipo} onChange={(e) => setRef(i, { tipo: e.target.value })} options={REF_TIPOS} />
              <Field label="Folio" value={x.folio} onChange={(e) => setRef(i, { folio: e.target.value })} hint={x.tipo === "SET" ? "En el set: 0 o vacío." : undefined} />
              <Field label="Fecha" type="date" value={x.fecha} onChange={(e) => setRef(i, { fecha: e.target.value })} optional />
              {isNota && (
                <Select label="Código" value={x.codigo ? String(x.codigo) : ""} onChange={(e) => setRef(i, { codigo: e.target.value ? Number(e.target.value) : null })}
                  options={[{ value: "", label: "Sin código" }, { value: "1", label: "1 — Anula el documento" }, { value: "2", label: "2 — Corrige texto" }, { value: "3", label: "3 — Corrige montos" }]} />
              )}
              <Field className="sm:col-span-2" label="Razón" maxLength={90} value={x.razon ?? ""} onChange={(e) => setRef(i, { razon: e.target.value })} placeholder={x.tipo === "SET" ? "CASO 1234567-1" : ""} optional />
              <div className="sm:col-span-2"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRefs(refs.filter((_, j) => j !== i))}>Quitar referencia</Button></div>
            </div>
          ))}
          <div><Button size="sm" variant="ghost" icon={Plus} onClick={() => setRefs([...refs, emptyRef()])}>Agregar referencia</Button></div>
        </fieldset>

        <dl className="ml-auto grid w-64 grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {dgMonto > 0 && <><dt className="text-muted">Descuento {dgPct}%</dt><dd className="text-right tabular-nums">−{formatCLP(dgMonto)}</dd></>}
          {neto > 0 && <><dt className="text-muted">Neto</dt><dd className="text-right tabular-nums">{formatCLP(neto)}</dd><dt className="text-muted">IVA {taxPpm / 10_000}%</dt><dd className="text-right tabular-nums">{formatCLP(iva)}</dd></>}
          {exento > 0 && <><dt className="text-muted">Exento</dt><dd className="text-right tabular-nums">{formatCLP(exento)}</dd></>}
          <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{formatCLP(neto + iva + exento)}</dd>
        </dl>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}
