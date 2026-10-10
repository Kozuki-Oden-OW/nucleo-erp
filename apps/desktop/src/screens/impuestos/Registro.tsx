// Documentos tributarios del mes: registro del SII importado, documentos de NÚCLEO y los
// ingresados a mano. Importación del CSV del Registro de Compras y Ventas.
import { useRef, useState } from "react";
import { FilePlus2, FileUp, Trash2, X } from "lucide-react";
import { useBackend, errorMessage, type F29View, type TaxDocInput, type TaxDocLine } from "../../data";
import { SII_DOC_TYPE, type PurchaseKind } from "../../data/f29";
import { formatDate, formatMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import { MoneyField } from "../../ui/doc";
import { Badge, Button, Checkbox, Field, IconButton, Notice, Segmented, Select } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

export const KIND_LABEL: Record<PurchaseKind, string> = {
  giro: "Del giro", supermercado: "Supermercado", activo_fijo: "Activo fijo", uso_comun: "Uso común", sin_derecho: "Sin derecho a crédito", bien_raiz: "Bien raíz",
};
const ORIGIN: Record<TaxDocLine["origin"], { label: string; tone: "success" | "neutral" | "info" }> = {
  rcv: { label: "SII", tone: "success" }, nucleo: { label: "NÚCLEO", tone: "neutral" }, manual: { label: "A mano", tone: "info" },
};

/** Lee el archivo como UTF-8 y, si no es válido, como Windows-1252 (como suele venir del SII). */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

export function RcvImportButton({ period, direction, onView, replace }: { period: string; direction: "venta" | "compra"; onView: (v: F29View) => void; replace: boolean }) {
  const backend = useBackend();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const what = direction === "venta" ? "ventas" : "compras";
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const r = await backend.importRcv(period, direction, f.name, await readText(f));
      onView(r.view);
      const extra = [r.skipped.length ? `${r.skipped.length} fila(s) ignorada(s)` : "", r.other_period ? `${r.other_period} con fecha de otro mes (normal si llegaron tarde)` : ""].filter(Boolean).join(" · ");
      toast("success", `Registro de ${what}: ${r.rows} documento(s) importado(s)${extra ? ` · ${extra}` : ""}.`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function clear() {
    try { onView(await backend.clearRcv(period, direction)); toast("success", `Se quitó el registro de ${what}: se usan los datos de NÚCLEO.`); }
    catch (e) { toast("danger", errorMessage(e)); }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <input ref={input} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={`Archivo del registro de ${what}`} />
      <Button size="sm" variant="secondary" icon={FileUp} disabled={busy} onClick={() => input.current?.click()}>{replace ? "Reemplazar archivo" : `Importar registro de ${what}`}</Button>
      {replace && <Button size="sm" variant="ghost" icon={X} onClick={clear}>Quitar</Button>}
    </div>
  );
}

export function RegistroTab({ view, onView }: { view: F29View; onView: (v: F29View) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const edit = can("contabilidad.editar") && view.status === "borrador";
  const [dir, setDir] = useState<"venta" | "compra">("venta");
  const [adding, setAdding] = useState(false);
  const rows = view.docs.filter((d) => d.direction === dir);
  const total = (f: (d: TaxDocLine) => number) => rows.reduce((a, d) => a + f(d), 0);
  const act = (p: Promise<F29View>) => p.then(onView).catch((e) => toast("danger", errorMessage(e)));

  const cols: Column<TaxDocLine>[] = [
    { key: "o", header: "Origen", width: "6rem", render: (d) => <Badge tone={ORIGIN[d.origin].tone}>{ORIGIN[d.origin].label}</Badge> },
    { key: "t", header: "Documento", width: "minmax(11rem,1.2fr)", render: (d) => (
      <span className="min-w-0 truncate"><span className="font-mono text-[12px] text-muted">{d.sii_type}</span> {SII_DOC_TYPE[d.sii_type] ?? "Otro"}{d.count > 1 && <span className="text-muted"> × {d.count}</span>}</span>
    ) },
    { key: "f", header: "Folio", width: "6.5rem", render: (d) => <span className="num text-muted">{d.folio ?? d.reference ?? "—"}</span> },
    { key: "d", header: "Fecha", width: "6.5rem", render: (d) => <span className="num text-muted">{d.issue_date ? formatDate(d.issue_date) : "—"}</span> },
    { key: "c", header: dir === "venta" ? "Cliente" : "Proveedor", render: (d) => <span className="truncate">{d.counterpart ?? <span className="text-muted">—</span>}</span> },
    { key: "n", header: "Neto + exento", width: "8rem", align: "right", render: (d) => <span className="num">{formatMoney(d.net_minor + d.exempt_minor)}</span> },
    { key: "i", header: "IVA", width: "7rem", align: "right", render: (d) => <span className="num">{formatMoney(d.tax_minor)}{d.tax_non_rec_minor > 0 && <span className="block text-[11px] text-muted">no rec. {formatMoney(d.tax_non_rec_minor)}</span>}</span> },
    ...(dir === "compra" ? [{ key: "k", header: "Crédito", width: "10.5rem", render: (d: TaxDocLine) => (d.id !== null && edit && [33, 30, 914].includes(d.sii_type)
      ? <select aria-label="Clasificación de la compra" value={d.kind ?? "giro"} onChange={(e) => act(backend.setTaxDocumentKind(d.id!, e.target.value))}
          className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]">{(Object.keys(KIND_LABEL) as PurchaseKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
      : <span className="text-muted">{d.kind ? KIND_LABEL[d.kind] : "—"}</span>) } as Column<TaxDocLine>] : []),
    { key: "x", header: "", width: "2.75rem", render: (d) => d.origin === "manual" && edit ? <IconButton icon={Trash2} label="Quitar" size={15} onClick={() => act(backend.deleteTaxDocument(d.id!))} /> : null },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Registro" value={dir} onChange={setDir} options={[{ value: "venta", label: "Ventas" }, { value: "compra", label: "Compras" }]} />
        <div className="flex flex-wrap gap-2">
          {edit && <RcvImportButton period={view.period} direction={dir} onView={onView} replace={view.sources.find((s) => s.direction === dir)?.source === "rcv"} />}
          {edit && <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => setAdding(true)}>Agregar a mano</Button>}
        </div>
      </div>
      {view.sources.find((s) => s.direction === dir)?.source === "nucleo" && (
        <Notice tone="info">Estos son los documentos registrados en NÚCLEO. Para que el F29 coincida con el SII, descarga el detalle del Registro de {dir === "venta" ? "Ventas" : "Compras"} del mes en sii.cl e impórtalo aquí.</Notice>
      )}
      <DataTable label={`Documentos de ${dir === "venta" ? "ventas" : "compras"}`} columns={cols} rows={rows} rowKey={(d) => `${d.origin}-${d.id ?? d.reference}-${d.folio}-${d.sii_type}`}
        maxHeight="calc(100vh - 360px)" empty={<p className="p-6 text-sm text-muted">No hay documentos de {dir === "venta" ? "ventas" : "compras"} en este mes.</p>} />
      {rows.length > 0 && <p className="text-right text-sm text-muted">{rows.length} fila(s) · neto + exento <span className="num text-ink">{formatMoney(total((d) => d.net_minor + d.exempt_minor))}</span> · IVA <span className="num text-ink">{formatMoney(total((d) => d.tax_minor))}</span></p>}
      {adding && <AddDocDialog period={view.period} direction={dir} onClose={() => setAdding(false)} onView={onView} />}
    </div>
  );
}

const TYPES_V = [33, 34, 39, 41, 48, 56, 61, 110];
const TYPES_C = [33, 34, 56, 61, 914];

function AddDocDialog({ period, direction, onClose, onView }: { period: string; direction: "venta" | "compra"; onClose: () => void; onView: (v: F29View) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const [d, setD] = useState<TaxDocInput>({ direction, sii_type: direction === "venta" ? 39 : 33, folio: null, issue_date: null, counterpart_rut: null, counterpart_name: null, doc_count: 1, exempt_minor: 0, net_minor: 0, tax_minor: 0, purchase_kind: direction === "compra" ? "giro" : null, not_of_business: false, note: null });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { onView(await backend.addTaxDocument(period, d)); onClose(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title={`Agregar documento de ${direction === "venta" ? "venta" : "compra"}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={busy}>Agregar</Button></>}>
      <p className="mb-4 text-sm text-muted">Para lo que no está en el registro importado ni en NÚCLEO: por ejemplo, el resumen de boletas del mes o una declaración de ingreso.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <Select label="Tipo de documento" value={String(d.sii_type)} onChange={(e) => setD({ ...d, sii_type: Number(e.target.value) })}
          options={(direction === "venta" ? TYPES_V : TYPES_C).map((t) => ({ value: String(t), label: `${t} · ${SII_DOC_TYPE[t]}` }))} />
        <Field label="Cantidad de documentos" inputMode="numeric" value={d.doc_count ?? 1} onChange={(e) => setD({ ...d, doc_count: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} hint="Más de 1 para un resumen" />
        <Field label="Folio" optional value={d.folio ?? ""} onChange={(e) => setD({ ...d, folio: e.target.value })} />
        <Field label="Fecha" type="date" optional value={d.issue_date ?? ""} onChange={(e) => setD({ ...d, issue_date: e.target.value || null })} />
        <Field label={direction === "venta" ? "Cliente" : "Proveedor"} optional value={d.counterpart_name ?? ""} onChange={(e) => setD({ ...d, counterpart_name: e.target.value })} />
        <Field label="RUT" optional value={d.counterpart_rut ?? ""} onChange={(e) => setD({ ...d, counterpart_rut: e.target.value })} />
        <MoneyField label="Neto" value={d.net_minor} onValue={(v) => setD({ ...d, net_minor: v ?? 0 })} />
        <MoneyField label="Exento" value={d.exempt_minor} onValue={(v) => setD({ ...d, exempt_minor: v ?? 0 })} />
        <MoneyField label="IVA" value={d.tax_minor} onValue={(v) => setD({ ...d, tax_minor: v ?? 0 })} />
        {direction === "compra" && <Select label="Crédito fiscal" value={d.purchase_kind ?? "giro"} onChange={(e) => setD({ ...d, purchase_kind: e.target.value as PurchaseKind })}
          options={(Object.keys(KIND_LABEL) as PurchaseKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />}
        {direction === "venta" && <div className="flex items-end pb-2"><Checkbox label="No es del giro" hint="Venta de un activo fijo, por ejemplo" checked={!!d.not_of_business} onChange={(v) => setD({ ...d, not_of_business: v })} /></div>}
      </div>
    </Dialog>
  );
}
