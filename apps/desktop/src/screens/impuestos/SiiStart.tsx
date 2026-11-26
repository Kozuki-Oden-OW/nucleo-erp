// Partir con los datos reales del SII: la persona descarga su Registro de Compras y Ventas y suelta
// aquí todos los archivos. NÚCLEO reconoce cada uno y deja cargados los registros, los clientes, los
// proveedores y las ventas históricas. No se pide ninguna clave.
import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, FileUp, FolderInput, XCircle } from "lucide-react";
import { useBackend, errorMessage, type StartFile, type StartReport } from "../../data";
import { formatMoney } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, Card, Kpi, Notice, PageHeader, cx } from "../../ui/kit";
import { useToast } from "../../ui/overlay";

/** Lee el archivo como UTF-8 y, si no es válido, como Windows-1252 (como suele venir del SII). */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

const month = (p: string) => new Date(`${p}-15T12:00:00`).toLocaleDateString("es-CL", { month: "long", year: "numeric" });

export function SiiStart() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<StartReport | null>(null);
  const allowed = can("contabilidad.editar") && can("ventas.crear");

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (/\.(csv|txt)$/i.test(f.name) && !next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next.slice(0, 60));
  };
  async function run() {
    setBusy(true);
    try {
      const payload: StartFile[] = [];
      for (const f of files) payload.push({ name: f.name, text: await readText(f) });
      setRep(await backend.siiStartImport(payload));
      setFiles([]);
      window.dispatchEvent(new Event("nucleo:datos"));
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="anim-in">
      <PageHeader title="Parte con tus datos del SII"
        subtitle="Trae tus ventas y compras de los últimos meses en un par de minutos. Los archivos los descargas tú desde sii.cl: NÚCLEO no pide ni guarda tu clave tributaria." />
      {!allowed && <Notice tone="warning">Tu usuario no puede cargar los registros. Pídeselo al dueño o a quien lleva la contabilidad.</Notice>}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <Card title="1. Descarga tus registros">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
            <li>Entra a <strong>sii.cl</strong> con tu RUT y clave, como siempre.</li>
            <li>Ve a <strong>Servicios online → Factura electrónica → Registro de Compras y Ventas</strong>.</li>
            <li>Elige el mes y, en <strong>Compra</strong> y en <strong>Venta</strong>, pulsa <strong>Descargar detalles</strong>. Cada descarga es un archivo CSV.</li>
            <li>Repite con los meses que quieras traer (un año es un buen punto de partida: 24 archivos).</li>
          </ol>
          <p className="mt-3 text-[13px] text-muted">Deja los nombres como los entrega el SII (por ejemplo «RCV_VENTA_77334963-0_202610.csv»): con eso NÚCLEO sabe de qué mes y de qué registro es cada uno.</p>
        </Card>

        <Card title="2. Suéltalos aquí">
          <input ref={input} type="file" multiple accept=".csv,.txt,text/csv" className="hidden" aria-label="Archivos del Registro de Compras y Ventas" onChange={(e) => { add(e.target.files); if (input.current) input.current.value = ""; }} />
          <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
            className={cx("flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center", over ? "border-accent bg-accent-soft" : "border-line-strong")}>
            <FolderInput size={28} className="text-muted" aria-hidden />
            <p className="text-sm text-muted">Arrastra todos los archivos juntos, o</p>
            <Button variant="secondary" icon={FileUp} onClick={() => input.current?.click()} disabled={!allowed}>Elegir archivos</Button>
          </div>
          {files.length > 0 && (
            <>
              <ul className="mt-3 max-h-44 overflow-y-auto text-[13px] text-muted">
                {files.map((f) => <li key={f.name + f.size} className="flex items-center justify-between gap-3 py-0.5"><span className="truncate">{f.name}</span><button className="shrink-0 hover:text-ink" onClick={() => setFiles(files.filter((x) => x !== f))}>Quitar</button></li>)}
              </ul>
              <div className="mt-3"><Button icon={ArrowRight} onClick={run} disabled={busy || !allowed}>{busy ? "Cargando…" : `Cargar ${files.length} ${files.length === 1 ? "archivo" : "archivos"}`}</Button></div>
            </>
          )}
        </Card>
      </div>

      {rep && (
        <div className="mt-6 flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Ventas" value={formatMoney(rep.sales_total_minor)} hint={`${rep.sales_docs} documentos`} tone="success" />
            <Kpi label="Compras" value={formatMoney(rep.purchases_total_minor)} hint={`${rep.purchases_docs} documentos`} />
            <Kpi label="Clientes nuevos" value={String(rep.customers_created)} hint={`${rep.sales_imported} ventas anotadas${rep.sales_existing ? `, ${rep.sales_existing} ya estaban` : ""}`} />
            <Kpi label="Proveedores nuevos" value={String(rep.suppliers_created)} hint={rep.periods.length ? `${rep.periods.length} ${rep.periods.length === 1 ? "mes" : "meses"}: ${month(rep.periods[0]!)}${rep.periods.length > 1 ? ` a ${month(rep.periods[rep.periods.length - 1]!)}` : ""}` : undefined} />
          </div>
          {rep.notes.map((n) => <Notice key={n} tone="info">{n}</Notice>)}
          <Card title="Archivo por archivo" padded={false}>
            <ul className="divide-y divide-line text-sm">
              {rep.files.map((f, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  {f.status === "ok" ? <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden /> : <XCircle size={16} className="shrink-0 text-danger" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                  {f.status === "ok"
                    ? <span className="text-muted">{f.direction === "venta" ? "Ventas" : "Compras"} de {f.period ? month(f.period) : ""} · {f.documents} documentos · <span className="num text-ink">{formatMoney(f.total_minor)}</span>{f.message ? ` · ${f.message}` : ""}</span>
                    : <span className="text-danger">{f.message}</span>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="3. Lo que ya puedes ver">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate("/")}>El resumen del negocio</Button>
              <Button variant="secondary" onClick={() => navigate("/analisis?tab=clientes")}>Tus mejores clientes</Button>
              <Button variant="secondary" onClick={() => navigate(`/contabilidad?tab=f29${rep.periods.length ? `&periodo=${rep.periods[rep.periods.length - 1]}` : ""}`)}>El F29 del último mes</Button>
              <Button variant="secondary" onClick={() => navigate("/compras?tab=proveedores")}>Tus proveedores</Button>
            </div>
            <p className="mt-3 text-[13px] text-muted">Las ventas traídas son historial: muestran cuánto y a quién vendiste, sin tocar tu stock ni tu caja de hoy. Puedes repetir la carga cuando quieras: lo que ya estaba no se duplica.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
