// Representación impresa de un documento tributario electrónico (muestras de impresión del SII):
// recuadro con RUT, tipo y folio, unidad del SII, emisor, receptor, referencias, detalle con
// descuentos, totales con separador de miles, timbre electrónico en PDF417 y, en el ejemplar cedible,
// el acuse de recibo de la Ley 19.983. Los datos vienen del XML firmado.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { errorMessage, useBackend, type SiiDocument, type SiiPrintDoc } from "../../data";
import { formatDate, formatRut } from "../../lib/format";
import { Button, Checkbox, Notice, Spinner } from "../../ui/kit";
import { Dialog } from "../../ui/overlay";

const ROJO = "#c00000";
const miles = (n: number) => Math.round(n).toLocaleString("es-CL");
const cantidad = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 3 });
const FORMA_PAGO: Record<number, string> = { 1: "Contado", 2: "Crédito", 3: "Sin costo" };
const TRASLADO: Record<number, string> = { 1: "Operación constituye venta", 2: "Venta por efectuar", 3: "Consignación", 4: "Entrega gratuita", 5: "Traslado interno", 6: "Otros traslados no venta", 7: "Guía de devolución" };
const COD_REF: Record<number, string> = { 1: "Anula documento", 2: "Corrige texto", 3: "Corrige montos" };
const TITULO: Record<number, string> = { 33: "FACTURA ELECTRÓNICA", 34: "FACTURA NO AFECTA O EXENTA ELECTRÓNICA", 52: "GUÍA DE DESPACHO ELECTRÓNICA", 56: "NOTA DE DÉBITO ELECTRÓNICA", 61: "NOTA DE CRÉDITO ELECTRÓNICA" };

/** Una hoja: ejemplar tributario o, con `cedible`, la copia cedible con el acuse de recibo. */
export function SiiPrintPage({ d, cedible = false }: { d: SiiPrintDoc; cedible?: boolean }) {
  const e = d.emisor, r = d.receptor, t = d.totales;
  const conDescuento = d.lineas.some((l) => l.descuento_monto || l.descuento_pct);
  const conUnidad = d.lineas.some((l) => l.unidad);
  return (
    <article className="sii-page mx-auto flex min-h-[25cm] w-full max-w-[19cm] flex-col bg-white p-1 text-[11px] leading-snug text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 pt-1">
          <div className="text-[15px] font-bold uppercase">{e.razon_social}</div>
          {e.giro && <div className="mt-0.5">{e.giro}</div>}
          <div>{[e.direccion, e.comuna, e.ciudad].filter(Boolean).join(", ")}</div>
          {(e.telefono || e.correo) && <div>{[e.telefono && `Tel. ${e.telefono}`, e.correo].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="shrink-0 text-center" style={{ color: ROJO }}>
          <div className="flex min-h-[2.6cm] w-[7.2cm] flex-col items-center justify-center gap-1 px-2 py-2 text-[14px] font-bold" style={{ border: `3px solid ${ROJO}` }}>
            <div>R.U.T.: {formatRut(e.rut)}</div>
            <div className="leading-tight">{TITULO[d.tipo] ?? d.tipo_nombre.toUpperCase()}</div>
            <div>N° {d.folio}</div>
          </div>
          <div className="mt-1 text-[12px] font-bold">S.I.I. {d.unidad_sii ? `- ${d.unidad_sii}` : ""}</div>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-[1fr_auto] gap-x-8 gap-y-0.5 border border-black p-2">
        <div><strong>Señor(es):</strong> {r.razon_social}</div>
        <div><strong>Fecha de emisión:</strong> {formatDate(d.fecha)}</div>
        <div><strong>R.U.T.:</strong> {formatRut(r.rut)}</div>
        <div>{d.forma_pago ? <><strong>Forma de pago:</strong> {FORMA_PAGO[d.forma_pago] ?? d.forma_pago}</> : d.ind_traslado ? <><strong>Traslado:</strong> {TRASLADO[d.ind_traslado] ?? d.ind_traslado}</> : null}</div>
        <div><strong>Giro:</strong> {r.giro ?? ""}</div>
        <div>{d.vencimiento && <><strong>Vencimiento:</strong> {formatDate(d.vencimiento)}</>}</div>
        <div><strong>Dirección:</strong> {r.direccion ?? ""}</div>
        <div />
        <div><strong>Comuna:</strong> {r.comuna ?? ""}{r.ciudad ? <> &nbsp; <strong>Ciudad:</strong> {r.ciudad}</> : null}</div>
        <div />
        {(r.contacto || r.correo) && <div className="col-span-2"><strong>Contacto:</strong> {[r.contacto, r.correo].filter(Boolean).join(" · ")}</div>}
      </section>

      {d.referencias.length > 0 && (
        <table className="mt-2 w-full border-collapse text-[10.5px]">
          <thead><tr className="border-y border-black text-left"><th className="py-0.5 pr-2">Documento de referencia</th><th className="py-0.5 pr-2">Folio</th><th className="py-0.5 pr-2">Fecha</th><th className="py-0.5">Razón de la referencia</th></tr></thead>
          <tbody>{d.referencias.map((x, i) => (
            <tr key={i} className="border-b border-neutral-300 align-top">
              <td className="py-0.5 pr-2">{x.tipo_nombre}</td><td className="py-0.5 pr-2">{x.folio}</td><td className="py-0.5 pr-2">{formatDate(x.fecha)}</td>
              <td className="py-0.5">{[x.codigo ? COD_REF[x.codigo] : null, x.razon].filter(Boolean).join(": ")}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-y-2 border-black text-left">
            <th className="py-1 pr-2">Detalle</th>
            <th className="py-1 pr-2 text-right">Cantidad</th>
            {conUnidad && <th className="py-1 pr-2">Unidad</th>}
            <th className="py-1 pr-2 text-right">Precio unitario</th>
            {conDescuento && <th className="py-1 pr-2 text-right">Descuento</th>}
            <th className="py-1 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {d.lineas.map((l, i) => (
            <tr key={i} className="border-b border-neutral-300 align-top">
              <td className="py-1 pr-2">{l.nombre}{l.exento && d.tipo !== 34 ? " (exento)" : ""}{l.descripcion && <div className="text-[10px] text-neutral-700">{l.descripcion}</div>}</td>
              <td className="py-1 pr-2 text-right">{l.cantidad != null ? cantidad(l.cantidad) : ""}</td>
              {conUnidad && <td className="py-1 pr-2">{l.unidad ?? ""}</td>}
              <td className="py-1 pr-2 text-right">{l.precio != null ? miles(l.precio) : ""}</td>
              {conDescuento && <td className="py-1 pr-2 text-right">{l.descuento_monto ? `${l.descuento_pct ? `${l.descuento_pct.toLocaleString("es-CL")}% · ` : ""}${miles(l.descuento_monto)}` : l.descuento_pct ? `${l.descuento_pct.toLocaleString("es-CL")}%` : ""}</td>}
              <td className="py-1 text-right">{miles(l.monto)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-auto flex items-end justify-between gap-6 pt-6">
        <div className="w-[9.4cm] shrink-0 text-center">
          <div className="mx-auto w-[9cm]" dangerouslySetInnerHTML={{ __html: d.timbre_svg }} />
          <div className="mt-1 text-[10px] font-bold">Timbre Electrónico SII</div>
          <div className="text-[10px]">Res. {d.resolucion_numero} de {d.resolucion_anio} — Verifique documento: www.sii.cl</div>
        </div>
        <table className="w-[7cm] border-collapse text-[12px]">
          <tbody>
            {d.globales.length > 0 && <tr><td className="py-0.5 pr-3">Subtotal</td><td className="py-0.5 text-right">$ {miles(d.lineas.reduce((x, l) => x + l.monto, 0))}</td></tr>}
            {d.globales.map((g, i) => {
              const base = d.lineas.filter((l) => l.exento === g.exento).reduce((x, l) => x + l.monto, 0);
              const monto = g.tipo_valor === "%" ? Math.round((base * g.valor) / 100) : g.valor;
              return (
                <tr key={i}><td className="py-0.5 pr-3">{g.recargo ? "Recargo" : "Descuento"} global{g.tipo_valor === "%" ? ` ${g.valor.toLocaleString("es-CL")}%` : ""}{g.exento ? " (exentos)" : d.lineas.some((l) => l.exento) ? " (afectos)" : ""}</td>
                  <td className="py-0.5 text-right">{g.recargo ? "" : "−"}$ {miles(monto)}</td></tr>
              );
            })}
            {t.neto != null && <tr><td className="py-0.5 pr-3">Monto neto</td><td className="py-0.5 text-right">$ {miles(t.neto)}</td></tr>}
            {t.exento != null && t.exento !== 0 && <tr><td className="py-0.5 pr-3">Monto exento</td><td className="py-0.5 text-right">$ {miles(t.exento)}</td></tr>}
            {t.iva != null && <tr><td className="py-0.5 pr-3">I.V.A. {t.tasa_iva != null ? `${t.tasa_iva.toLocaleString("es-CL")}%` : ""}</td><td className="py-0.5 text-right">$ {miles(t.iva)}</td></tr>}
            <tr className="border-t-2 border-black text-[13px] font-bold"><td className="py-1 pr-3">TOTAL</td><td className="py-1 text-right">$ {miles(t.total)}</td></tr>
          </tbody>
        </table>
      </div>

      {cedible && (
        <section className="mt-4">
          <div className="border border-black p-2 text-[10px]">
            <div className="grid grid-cols-[1.4fr_1fr] gap-x-6 gap-y-2">
              <div>Nombre: <span className="inline-block w-[70%] border-b border-black align-bottom">&nbsp;</span></div>
              <div>R.U.T.: <span className="inline-block w-[60%] border-b border-black align-bottom">&nbsp;</span></div>
              <div>Recinto: <span className="inline-block w-[70%] border-b border-black align-bottom">&nbsp;</span></div>
              <div>Fecha: <span className="inline-block w-[60%] border-b border-black align-bottom">&nbsp;</span></div>
              <div className="col-span-2">Firma: <span className="inline-block w-[40%] border-b border-black align-bottom">&nbsp;</span></div>
            </div>
            <p className="mt-2 text-[9px] leading-tight">
              El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4°, y la letra c) del Art. 5° de la Ley 19.983,
              acredita que la entrega de mercaderías o servicio(s) prestado(s) ha(n) sido recibido(s).
            </p>
          </div>
          <div className="mt-1 text-right text-[13px] font-bold">{d.tipo === 52 ? "CEDIBLE CON SU FACTURA" : "CEDIBLE"}</div>
        </section>
      )}
    </article>
  );
}

/** Vista previa del documento impreso y botón para imprimir o guardar como PDF. */
export function SiiPrintDialog({ doc, onClose }: { doc: SiiDocument | null; onClose: () => void }) {
  const backend = useBackend();
  const [data, setData] = useState<SiiPrintDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conCedible, setConCedible] = useState(true);

  useEffect(() => {
    setData(null); setErr(null);
    if (!doc) return;
    let alive = true;
    backend.siiPrintData(doc.id).then((d) => { if (alive) { setData(d); setConCedible(d.cedible); } }).catch((e) => { if (alive) setErr(errorMessage(e)); });
    return () => { alive = false; };
  }, [backend, doc]);

  // Mientras el diálogo está abierto, al imprimir solo sale el documento (ver styles.css).
  useEffect(() => {
    if (!doc) return;
    document.documentElement.classList.add("sii-printing");
    return () => document.documentElement.classList.remove("sii-printing");
  }, [doc]);

  const cedible = !!data?.cedible && conCedible;
  return (
    <>
      <Dialog open={!!doc} onClose={onClose} size="lg" title={doc ? `${doc.tipo_nombre} N° ${doc.folio}` : ""}
        footer={<>
          {data?.cedible && <span className="mr-auto"><Checkbox label="Incluir ejemplar cedible" checked={conCedible} onChange={setConCedible} /></span>}
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          <Button icon={Printer} onClick={() => window.print()} disabled={!data}>Imprimir o guardar PDF</Button>
        </>}>
        {err ? <Notice tone="danger">{err}</Notice> : !data ? <Spinner /> : (
          <div className="flex flex-col gap-3">
            {!data.unidad_sii && <Notice tone="warning">Falta la «Unidad del SII» en los datos ante el SII: debe ir bajo el recuadro rojo (por ejemplo «S.I.I. - SANTIAGO ORIENTE»).</Notice>}
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-white p-3">
              <div className="min-w-[17cm]"><SiiPrintPage d={data} /></div>
            </div>
            <p className="text-xs text-muted">En el diálogo de impresión elige «Guardar como PDF» o «Microsoft Print to PDF», tamaño carta, para las muestras de impresión del SII{cedible ? "; salen dos hojas: ejemplar tributario y cedible" : ""}.</p>
          </div>
        )}
      </Dialog>
      {doc && data && createPortal(
        <div className="sii-print-root">
          <SiiPrintPage d={data} />
          {cedible && <SiiPrintPage d={data} cedible />}
        </div>,
        document.body,
      )}
    </>
  );
}
