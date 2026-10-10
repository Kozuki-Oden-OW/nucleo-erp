// Formato imprimible de cotización, venta y factura interna (solo visible al imprimir o guardar PDF).
// La leyenda "DOCUMENTO INTERNO — NO TRIBUTARIO" es fija y no se puede quitar (Blueprint §7.3, D-09).
import { useState } from "react";
import { Printer } from "lucide-react";
import { useBackend, type BusinessSettings, type QuoteDetail, type SaleDetail } from "../../data";
import { Button } from "../../ui/kit";
import { Dialog } from "../../ui/overlay";
import { formatDate, formatMoney, formatPpm, formatQty } from "../../lib/format";

export const INTERNAL_LEGEND = "DOCUMENTO INTERNO — NO TRIBUTARIO";

/** Datos y logo del negocio en el encabezado de los documentos imprimibles. */
export function PrintIssuer({ biz, activity = true }: { biz: BusinessSettings | null; activity?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      {biz?.logo && <img src={biz.logo} alt="" className="max-h-16 max-w-[160px] object-contain" />}
      <div>
        <div className="text-[16px] font-bold">{biz?.legal_name || biz?.name || "Mi negocio"}</div>
        {biz?.rut && <div>RUT {biz.rut}</div>}
        {activity && biz?.activity && <div>{biz.activity}</div>}
        {biz?.address && <div>{biz.address}</div>}
        {(biz?.phone || biz?.email) && <div>{[biz?.phone, biz?.email].filter(Boolean).join(" · ")}</div>}
      </div>
    </div>
  );
}
const PRINT_TITLE = { COT: "COTIZACIÓN", VEN: "COMPROBANTE DE VENTA", FV: "FACTURA INTERNA" } as const;

type Props = { kind: "COT" | "VEN" | "FV"; doc: QuoteDetail | SaleDetail; biz: BusinessSettings | null };

/** En el escritorio abre el diálogo de impresión de Windows (imprimir o guardar PDF);
 *  en la demostración del navegador muestra una vista previa. */
export function PrintButton(props: Props) {
  const backend = useBackend();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={Printer} onClick={() => (backend.kind === "tauri" ? window.print() : setOpen(true))}>Imprimir</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Vista previa de impresión" size="lg">
        <div className="overflow-x-auto rounded-lg border border-line bg-white p-4">
          <div className="min-w-[560px]"><PrintDoc {...props} preview /></div>
        </div>
        <p className="mt-3 text-xs text-muted">En el programa instalado, “Imprimir” abre el diálogo de Windows para imprimir o guardar en PDF.</p>
      </Dialog>
    </>
  );
}

export function PrintDoc({ kind, doc, biz, preview = false }: Props & { preview?: boolean }) {
  const tax = doc.totals.tax_minor > 0;
  return (
    <article className={`${preview ? "block" : "hidden print:block"} bg-white p-2 text-[12px] leading-snug text-black`} aria-hidden={!preview}>
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <PrintIssuer biz={biz} />
        <div className="min-w-[220px] border-2 border-black p-3 text-center">
          <div className="text-[15px] font-bold tracking-wide">{PRINT_TITLE[kind]}</div>
          <div className="mt-1 font-mono text-[14px] font-bold">{doc.number}</div>
          <div className="mt-2 border-t border-black pt-1 text-[10px] font-bold tracking-wider">{INTERNAL_LEGEND}</div>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-2 gap-2">
        <div><strong>Cliente:</strong> {doc.customer_name}</div>
        <div className="text-right"><strong>Fecha:</strong> {formatDate(doc.issue_date)}</div>
        {"valid_until" in doc && doc.valid_until && <div><strong>Válida hasta:</strong> {formatDate(doc.valid_until)}</div>}
        {"due_date" in doc && doc.due_date && <div><strong>Vencimiento:</strong> {formatDate(doc.due_date)}</div>}
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1">Descripción</th>
            <th className="py-1 text-right">Cant.</th>
            <th className="py-1 text-right">Precio</th>
            <th className="py-1 text-right">Desc.</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.line_no} className="border-b border-neutral-300">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right">{formatQty(l.qty_milli)}</td>
              <td className="py-1 text-right">{formatMoney(l.unit_price_minor)}</td>
              <td className="py-1 text-right">{l.discount_ppm ? formatPpm(l.discount_ppm, 0) : ""}</td>
              <td className="py-1 text-right">{formatMoney(l.net_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 ml-auto w-64">
        {tax && <div className="flex justify-between"><span>Neto</span><span>{formatMoney(doc.totals.net_minor)}</span></div>}
        {tax && doc.totals.exempt_minor > 0 && <div className="flex justify-between"><span>Exento</span><span>{formatMoney(doc.totals.exempt_minor)}</span></div>}
        {tax && <div className="flex justify-between"><span>IVA (referencial)</span><span>{formatMoney(doc.totals.tax_minor)}</span></div>}
        <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[14px] font-bold"><span>TOTAL</span><span>{formatMoney(doc.totals.total_minor)}</span></div>
      </section>

      {doc.notes && <p className="mt-4"><strong>Observaciones:</strong> {doc.notes}</p>}

      <footer className="mt-8 border-t border-black pt-2 text-center text-[10px]">
        <div className="font-bold tracking-wider">{INTERNAL_LEGEND}</div>
        <div>Este documento no reemplaza ni constituye una factura, boleta u otro documento tributario.</div>
        <div className="mt-1 text-neutral-600">Generado con NÚCLEO ERP · www.nucleoerp.cl</div>
      </footer>
    </article>
  );
}
