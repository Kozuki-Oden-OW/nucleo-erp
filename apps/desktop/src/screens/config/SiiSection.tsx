// Configuración → Facturación SII: datos del emisor ante el SII, certificado digital (.pfx), folios
// (CAF), prueba de conexión y documentos: timbrar y firmar (Nuevo documento), enviar al SII (con
// confirmación, es irreversible), consultar estado y guardar el XML. La emisión desde cada venta llega
// en la fase F6 (docs/SII_FACTURACION_PROPIA.md).
import { useCallback, useEffect, useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { BadgeCheck, BookOpen, FileCode2, FileKey2, FilePlus2, FileText, PlugZap, RefreshCw, Save, Send, Upload } from "lucide-react";
import { errorMessage, useBackend, type SiiAmbiente, type SiiDocument, type SiiFolios, type SiiLibro, type SiiSetup, type SiiStatus } from "../../data";
import { formatCLP, formatDate } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Field, IconButton, Notice, Segmented, Select, Spinner } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { Dialog, useToast } from "../../ui/overlay";
import { SiiIssueDialog } from "./SiiIssueDialog";

const ESTADO: Record<SiiDocument["estado"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  firmado: { label: "Firmado", tone: "neutral" },
  enviado: { label: "Enviado", tone: "info" },
  aceptado: { label: "Aceptado", tone: "success" },
  reparos: { label: "Con reparos", tone: "warning" },
  rechazado: { label: "Rechazado", tone: "danger" },
};

async function pick(name: string, extensions: string[]): Promise<string | null> {
  try {
    const f = await openFile({ multiple: false, directory: false, filters: [{ name, extensions }] });
    return typeof f === "string" ? f : null;
  } catch {
    // Demostración en el navegador: no hay selector de archivos.
    return `demo.${extensions[0]}`;
  }
}

export function SiiSection() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [st, setSt] = useState<SiiStatus | null>(null);
  const [docs, setDocs] = useState<SiiDocument[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<SiiSetup | null>(null);
  const [actecos, setActecos] = useState("");
  const [certPath, setCertPath] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [toSend, setToSend] = useState<SiiDocument[] | null>(null);
  const [libros, setLibros] = useState<SiiLibro[]>([]);
  const [libroForm, setLibroForm] = useState<{ periodo: string; tipo: "MENSUAL" | "ESPECIAL"; folio: string } | null>(null);
  const [libroSend, setLibroSend] = useState<SiiLibro | null>(null);

  const apply = useCallback((s: SiiStatus) => {
    setSt(s);
    setForm({ ambiente: s.ambiente, emisor: { ...s.emisor }, resolucion_fecha: s.resolucion_fecha, resolucion_numero: s.resolucion_numero });
    setActecos(s.emisor.actecos.join(", "));
  }, []);
  const load = useCallback(async () => {
    try {
      apply(await backend.siiStatus());
      setDocs(await backend.siiDocuments(200));
      setLibros(await backend.siiLibros());
    } catch (e) { setErr(errorMessage(e)); }
  }, [apply, backend]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!st || !form) return <Spinner />;

  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try { await f(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  };
  const emisor = (patch: Partial<SiiSetup["emisor"]>) => setForm({ ...form, emisor: { ...form.emisor, ...patch } });
  const save = () => run("save", async () => {
    const codes = actecos.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map(Number);
    if (codes.some((c) => !Number.isInteger(c))) throw new Error("Los códigos de actividad son números de 6 dígitos separados por coma.");
    apply(await backend.siiSaveSetup({ ...form, emisor: { ...form.emisor, actecos: codes }, resolucion_fecha: form.resolucion_fecha || null }));
    toast("success", "Datos de facturación guardados.");
  });
  const chooseCert = async () => { const p = await pick("Certificado digital", ["pfx", "p12"]); if (p) setCertPath(p); };
  const loadCert = () => run("cert", async () => {
    if (!certPath) return;
    apply(await backend.siiLoadCertificate(certPath, password));
    setPassword(""); setCertPath(null);
    toast("success", "Certificado cargado.");
  });
  const loadCaf = () => run("caf", async () => {
    const p = await pick("Folios del SII (CAF)", ["xml"]);
    if (!p) return;
    apply(await backend.siiLoadCaf(p));
    toast("success", "Folios cargados.");
  });
  const test = () => run("test", async () => { toast("success", await backend.siiTestConnection()); });
  const send = () => run("send", async () => {
    if (!toSend?.length) return;
    const ids = toSend.map((d) => d.id);
    const out = await backend.siiSend(ids);
    setDocs(out); setToSend(null);
    const track = out.find((d) => d.id === ids[0])?.track_id;
    toast("success", `Enviado al SII${track ? ` (track id ${track})` : ""}. Consulta el estado en unos minutos.`);
  });
  const check = (d: SiiDocument) => run(`chk${d.id}`, async () => {
    const out = await backend.siiCheck(d.id);
    setDocs(out);
    const n = out.find((x) => x.id === d.id);
    if (n) toast(n.estado === "rechazado" ? "danger" : n.estado === "reparos" ? "warning" : "info", `${n.tipo_nombre} N° ${n.folio}: ${ESTADO[n.estado].label}${n.glosa ? ` — ${n.glosa}` : ""}`);
  });
  const exportXml = (d: SiiDocument) => run(`xml${d.id}`, async () => { if (await backend.siiExportXml(d)) toast("success", "XML guardado."); });
  const crearLibro = () => run("libro", async () => {
    if (!libroForm) return;
    const l = await backend.siiLibroCreate({ operacion: "venta", periodo: libroForm.periodo, tipo_libro: libroForm.tipo, folio_notificacion: libroForm.folio ? Number(libroForm.folio.replace(/\D/g, "")) : null, fct_prop: null, documentos: [], compras: [] });
    setLibros(await backend.siiLibros()); setLibroForm(null);
    toast("success", `Libro de ventas ${l.periodo} firmado con ${l.documentos} documentos. Revísalo y envíalo.`);
  });
  const enviarLibro = () => run("lsend", async () => {
    if (!libroSend) return;
    const l = await backend.siiLibroSend(libroSend.id);
    setLibros(await backend.siiLibros()); setLibroSend(null);
    toast("success", `Libro enviado al SII (track id ${l.track_id}).`);
  });
  const estadoLibro = (l: SiiLibro) => run(`lchk${l.id}`, async () => {
    const n = await backend.siiLibroCheck(l.id);
    setLibros(await backend.siiLibros());
    toast(n.estado === "rechazado" ? "danger" : "info", `Libro de ${n.operacion}s ${n.periodo}: ${ESTADO[n.estado].label}${n.glosa ? ` — ${n.glosa}` : ""}`);
  });
  const libroCols: Column<SiiLibro>[] = [
    { key: "op", header: "Libro", width: "minmax(9rem,1fr)", render: (l) => <span className="truncate">{l.operacion === "venta" ? "Ventas" : "Compras"} {l.periodo}{l.tipo_libro !== "MENSUAL" ? ` · ${l.tipo_libro.toLowerCase()}` : ""}</span> },
    { key: "n", header: "Docs.", align: "right", width: "4.5rem", render: (l) => l.documentos },
    { key: "fn", header: "Notificación", width: "7rem", render: (l) => l.folio_notificacion ?? "—" },
    { key: "e", header: "Estado", width: "8rem", render: (l) => <span title={l.glosa ?? undefined}><Badge tone={ESTADO[l.estado].tone}>{ESTADO[l.estado].label}</Badge></span> },
    { key: "t", header: "Track id", width: "7rem", render: (l) => <span className="text-xs text-muted tabular-nums">{l.track_id ?? "—"}</span> },
    { key: "a", header: "", width: "9.5rem", align: "right", render: (l) => (
      <div className="flex justify-end gap-1">
        {l.estado === "firmado" && <Button size="sm" variant="secondary" icon={Send} onClick={() => setLibroSend(l)} disabled={!!busy}>Enviar</Button>}
        {l.track_id && l.estado !== "aceptado" && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => estadoLibro(l)} disabled={!!busy}>{busy === `lchk${l.id}` ? "…" : "Estado"}</Button>}
        <IconButton icon={FileCode2} label="Guardar XML del libro" onClick={() => run(`lxml${l.id}`, async () => { if (await backend.siiLibroExportXml(l)) toast("success", "XML guardado."); })} />
      </div>
    ) },
  ];
  const firmados = docs.filter((d) => d.estado === "firmado" && d.ambiente === st.ambiente);

  const ready = st.faltantes.length === 0;
  const ambLabel = st.ambiente === "certificacion" ? "certificación (maullin)" : "producción (palena)";
  const folioCols: Column<SiiFolios>[] = [
    { key: "tipo", header: "Documento", width: "minmax(10rem,1fr)", render: (f) => <span className="truncate">{f.tipo_nombre} <span className="text-xs text-muted">({f.tipo})</span></span> },
    { key: "amb", header: "Ambiente", width: "7.5rem", render: (f) => f.ambiente === "certificacion" ? "Certificación" : "Producción" },
    { key: "rango", header: "Folios", width: "8rem", render: (f) => `${f.desde}–${f.hasta}` },
    { key: "sig", header: "Siguiente", align: "right", width: "5.5rem", render: (f) => f.restantes ? f.siguiente : "—" },
    { key: "rest", header: "Quedan", align: "right", width: "5rem", render: (f) => <Badge tone={f.restantes === 0 ? "danger" : f.restantes < 10 ? "warning" : "success"}>{f.restantes}</Badge> },
  ];
  const docCols: Column<SiiDocument>[] = [
    { key: "fecha", header: "Fecha", width: "6.5rem", render: (d) => formatDate(d.fecha) },
    { key: "doc", header: "Documento", width: "minmax(9rem,1fr)", render: (d) => <span className="truncate">{d.tipo_nombre} N° {d.folio}</span> },
    { key: "rec", header: "Receptor", width: "minmax(8rem,1fr)", render: (d) => <span className="truncate" title={d.receptor_rut}>{d.receptor}</span> },
    { key: "total", header: "Total", align: "right", width: "6.5rem", render: (d) => formatCLP(d.total_minor) },
    { key: "estado", header: "Estado", width: "8rem", render: (d) => <span title={d.glosa ?? undefined}><Badge tone={ESTADO[d.estado].tone}>{ESTADO[d.estado].label}</Badge></span> },
    { key: "track", header: "Track id", width: "7rem", render: (d) => <span className="text-xs text-muted tabular-nums">{d.track_id ?? "—"}</span> },
    { key: "acc", header: "", width: "9.5rem", align: "right", render: (d) => (
      <div className="flex justify-end gap-1">
        {d.estado === "firmado" && <Button size="sm" variant="secondary" icon={Send} onClick={() => setToSend([d])} disabled={!!busy}>Enviar</Button>}
        {d.track_id && d.estado !== "aceptado" && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => check(d)} disabled={!!busy}>{busy === `chk${d.id}` ? "…" : "Estado"}</Button>}
        <IconButton icon={FileCode2} label="Guardar XML firmado" onClick={() => exportXml(d)} />
      </div>
    ) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Notice tone={ready ? "success" : "info"} title={ready ? `Listo para emitir en ${ambLabel}` : "Facturación electrónica propia (en preparación)"}>
        {ready ? (
          "NÚCLEO ya puede timbrar y firmar documentos con tus folios. Usa «Probar conexión» para comprobar tu certificado con el SII."
        ) : (
          <div className="flex flex-col gap-1">
            <span>NÚCLEO emitirá facturas, guías y notas de crédito directo en el SII, sin intermediarios. Para empezar falta:</span>
            <ul className="list-disc pl-5">{st.faltantes.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
      </Notice>

      <Card title="Datos ante el SII" subtitle="Como aparecen en tu carpeta tributaria. El RUT, la razón social y la dirección vienen de «Mi negocio».">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<SiiAmbiente> label="Ambiente" value={form.ambiente} onChange={(v) => setForm({ ...form, ambiente: v })}
              options={[{ value: "certificacion", label: "Certificación" }, { value: "produccion", label: "Producción" }]} />
            <span className="text-xs text-muted">Certificación es para el set de pruebas del SII; producción solo después de la resolución.</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="RUT" value={st.rut ?? ""} disabled hint="Se cambia en Mi negocio." />
            <Field label="Razón social" value={st.razon_social ?? ""} disabled />
            <Field className="sm:col-span-2" label="Giro" value={form.emisor.giro} maxLength={80} onChange={(e) => emisor({ giro: e.target.value })} disabled={!editable} />
            <Field label="Actividades económicas" value={actecos} onChange={(e) => setActecos(e.target.value)} disabled={!editable}
              placeholder="620200, 465000" hint="Códigos de 6 dígitos, hasta 4, separados por coma." />
            <Field label="Dirección casa matriz" value={form.emisor.direccion} maxLength={70} onChange={(e) => emisor({ direccion: e.target.value })} disabled={!editable}
              placeholder="Vacío: la de Mi negocio" optional />
            <Field label="Comuna" value={form.emisor.comuna} maxLength={20} onChange={(e) => emisor({ comuna: e.target.value })} disabled={!editable} />
            <Field label="Ciudad" value={form.emisor.ciudad} maxLength={20} onChange={(e) => emisor({ ciudad: e.target.value })} disabled={!editable} optional />
            <Field label="Fecha de resolución" type="date" value={form.resolucion_fecha ?? ""} onChange={(e) => setForm({ ...form, resolucion_fecha: e.target.value || null })} disabled={!editable}
              hint="En certificación, la fecha de la postulación." />
            <Field label="Número de resolución" inputMode="numeric" value={form.resolucion_numero ?? ""} onChange={(e) => setForm({ ...form, resolucion_numero: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })}
              disabled={!editable} hint="En certificación es 0." />
            <Field label="RUT del dueño del certificado" value={form.emisor.rut_envia} onChange={(e) => emisor({ rut_envia: e.target.value })} disabled={!editable}
              optional hint="Solo si el certificado no lo trae." />
          </div>
          <div><Button icon={Save} onClick={save} disabled={!editable || !!busy}>{busy === "save" ? "Guardando…" : "Guardar datos"}</Button></div>
        </div>
      </Card>

      <Card title="Certificado digital" subtitle="El .pfx o .p12 del representante legal. NÚCLEO lo guarda con su clave en la base cifrada de esta empresa y solo lo usa para firmar."
        actions={st.certificado ? <Badge tone="success" icon={BadgeCheck}>Cargado</Badge> : <Badge icon={FileKey2}>Sin certificado</Badge>}>
        <div className="flex flex-col gap-3">
          {st.certificado && (
            <p className="text-sm">
              <strong>{st.certificado.nombre ?? "Sin nombre"}</strong>
              {st.certificado.rut && <> · RUT {st.certificado.rut}</>}
              {st.certificado.vence && <span className="text-muted"> · vence {st.certificado.vence}</span>}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="secondary" icon={Upload} onClick={() => void chooseCert()} disabled={!editable || !!busy}>{certPath ? "Cambiar archivo" : st.certificado ? "Reemplazar certificado" : "Elegir archivo"}</Button>
            {certPath && (
              <>
                <span className="max-w-[18rem] truncate text-xs text-muted" title={certPath}>{certPath}</span>
                <Field label="Clave del certificado" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button onClick={loadCert} disabled={!password || !!busy}>{busy === "cert" ? "Cargando…" : "Cargar"}</Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title="Folios (CAF)" subtitle="Descárgalos en sii.cl (Factura electrónica → Timbraje electrónico; para las pruebas, en el ambiente de certificación) y cárgalos aquí. Cada archivo trae un rango de folios."
        actions={<Button size="sm" variant="secondary" icon={Upload} onClick={loadCaf} disabled={!editable || !!busy}>Cargar CAF</Button>}>
        {st.folios.length ? <DataTable label="Folios cargados" rows={st.folios} columns={folioCols} rowKey={(f) => String(f.id)} /> : <p className="text-sm text-muted">Aún no cargas folios.</p>}
      </Card>

      <Card title="Conexión con el SII" subtitle="Pide una semilla y un token al SII firmados con tu certificado. No emite ni envía documentos.">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={PlugZap} onClick={test} disabled={!st.certificado || !!busy}>{busy === "test" ? "Conectando…" : "Probar conexión"}</Button>
          <span className="text-xs text-muted">Ambiente: {ambLabel}</span>
        </div>
      </Card>

      {(ready || docs.length > 0) && (
        <Card title="Documentos" subtitle="Timbrados y firmados por NÚCLEO, con su estado en el SII. Firmar no envía: el envío al SII es aparte y no se puede deshacer."
          actions={<div className="flex items-center gap-2">
            <Badge icon={FileText}>{docs.length}</Badge>
            {firmados.length > 1 && <Button size="sm" variant="secondary" icon={Send} onClick={() => setToSend(firmados)} disabled={!!busy}>Enviar firmados ({firmados.length})</Button>}
            {ready && can("ventas.documentar") && <Button size="sm" icon={FilePlus2} onClick={() => setIssuing(true)}>Nuevo documento</Button>}
          </div>}>
          {docs.length ? <DataTable label="Documentos emitidos" rows={docs} columns={docCols} rowKey={(d) => String(d.id)} maxHeight="28rem" /> : <p className="text-sm text-muted">Aún no hay documentos.</p>}
        </Card>
      )}

      {(ready || libros.length > 0) && (
        <Card title="Libros de compras y ventas" subtitle="Información electrónica de compras y ventas (IECV). El libro de ventas se arma con los documentos ya enviados al SII; el de compras lo prepara Claude con las facturas de tus proveedores."
          actions={ready && can("ventas.documentar") ? <Button size="sm" variant="secondary" icon={BookOpen} onClick={() => setLibroForm({ periodo: new Date().toISOString().slice(0, 7), tipo: st.ambiente === "certificacion" ? "ESPECIAL" : "MENSUAL", folio: "" })}>Libro de ventas</Button> : undefined}>
          {libros.length ? <DataTable label="Libros" rows={libros} columns={libroCols} rowKey={(l) => String(l.id)} maxHeight="20rem" /> : <p className="text-sm text-muted">Aún no hay libros.</p>}
        </Card>
      )}

      <Dialog open={!!libroForm} onClose={() => setLibroForm(null)} title="Libro de ventas"
        footer={<><Button variant="ghost" onClick={() => setLibroForm(null)}>Cancelar</Button><Button icon={BookOpen} onClick={crearLibro} disabled={!!busy}>{busy === "libro" ? "Firmando…" : "Armar y firmar"}</Button></>}>
        {libroForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Período" type="month" value={libroForm.periodo} onChange={(e) => setLibroForm({ ...libroForm, periodo: e.target.value })} />
            <Select label="Tipo" value={libroForm.tipo} onChange={(e) => setLibroForm({ ...libroForm, tipo: e.target.value as "MENSUAL" | "ESPECIAL" })}
              options={[{ value: "ESPECIAL", label: "Especial (set de pruebas)" }, { value: "MENSUAL", label: "Mensual" }]} />
            {libroForm.tipo === "ESPECIAL" && <Field className="sm:col-span-2" label="Folio de notificación" inputMode="numeric" value={libroForm.folio} onChange={(e) => setLibroForm({ ...libroForm, folio: e.target.value })} hint="En el set de pruebas: el número de atención del «SET LIBRO DE VENTAS»." />}
            <p className="text-xs text-muted sm:col-span-2">Incluye los documentos del período ya enviados al SII en {ambLabel}. Se firma sin enviar.</p>
          </div>
        )}
      </Dialog>

      <Dialog open={!!libroSend} onClose={() => setLibroSend(null)} title="¿Enviar el libro al SII?"
        footer={<><Button variant="ghost" onClick={() => setLibroSend(null)}>Cancelar</Button><Button icon={Send} onClick={enviarLibro} disabled={!!busy}>{busy === "lsend" ? "Enviando…" : "Enviar al SII"}</Button></>}>
        {libroSend && <p className="text-sm">Libro de {libroSend.operacion}s {libroSend.periodo} ({libroSend.documentos} documentos{libroSend.folio_notificacion ? `, notificación ${libroSend.folio_notificacion}` : ""}) a <strong>{ambLabel}</strong>. Un libro enviado no se borra: se corrige con uno rectificatorio.</p>}
      </Dialog>

      <SiiIssueDialog open={issuing} onClose={() => setIssuing(false)} folios={st.folios} ambiente={st.ambiente}
        onIssued={(d) => { setIssuing(false); toast("success", `${d.tipo_nombre} N° ${d.folio} firmada por ${formatCLP(d.total_minor)}. Revísala y envíala al SII.`); void load(); }} />

      <Dialog open={!!toSend} onClose={() => setToSend(null)} title="¿Enviar al SII?"
        footer={<><Button variant="ghost" onClick={() => setToSend(null)}>Cancelar</Button><Button icon={Send} onClick={send} disabled={!!busy}>{busy === "send" ? "Enviando…" : "Enviar al SII"}</Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <p>Se enviará{toSend && toSend.length > 1 ? "n" : ""} a <strong>{ambLabel}</strong> en un solo sobre firmado con tu certificado:</p>
          <ul className="flex flex-col gap-1">
            {toSend?.map((d) => <li key={d.id} className="flex justify-between gap-3"><span>{d.tipo_nombre} N° {d.folio} · {d.receptor} ({d.receptor_rut})</span><span className="tabular-nums">{formatCLP(d.total_minor)}</span></li>)}
          </ul>
          <Notice tone="warning">Un documento enviado al SII no se puede borrar: si tiene un error se corrige con una nota de crédito.{st.ambiente === "certificacion" ? " En certificación no tiene efecto tributario." : ""}</Notice>
        </div>
      </Dialog>
    </div>
  );
}
