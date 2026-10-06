// Repositorio de documentos adjuntos (Blueprint §15: repositorio fundacional). Los archivos se
// guardan cifrados con la clave del negocio en su carpeta; NÚCLEO nunca los sube a ningún lado.
import { useCallback, useEffect, useState } from "react";
import { Download, FileImage, FileSpreadsheet, FileText, File as FileIcon, Paperclip, Search, Trash2, Upload } from "lucide-react";
import { useBackend, errorMessage, type AttachmentRow, type EntityRef, type FileSource } from "../../data";
import { pickFileForAttachment } from "../../data/tauri";
import { formatBytes } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, EmptyState, Field, Notice, PageHeader, Spinner, TextArea } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

const ENTITY_LABEL: Record<string, string> = {
  cliente: "Cliente", proveedor: "Proveedor", producto: "Producto", cotizacion: "Cotización", venta: "Venta",
  orden_compra: "Orden de compra", compra: "Compra", gasto: "Gasto", importacion: "Importación",
};

export function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.includes("sheet") || mime.includes("excel") || mime === "text/csv") return FileSpreadsheet;
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("word")) return FileText;
  return FileIcon;
}

/** Elige un archivo: diálogo de Windows en el escritorio; selector del navegador en la demostración. */
export function usePickFile(): () => Promise<FileSource | null> {
  const backend = useBackend();
  return useCallback(async () => {
    if (backend.kind === "tauri") return pickFileForAttachment();
    return new Promise<FileSource | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0] } : null);
      input.click();
    });
  }, [backend]);
}

function sourceName(s: FileSource): string {
  return "path" in s ? (s.path.split(/[\\/]/).pop() ?? s.path) : s.file.name;
}

/** Diálogo para adjuntar: elige archivo y describe para qué es (opcional). */
export function AttachDialog({ open, onClose, link, onDone }: { open: boolean; onClose: () => void; link: EntityRef | null; onDone: (a: AttachmentRow) => void }) {
  const backend = useBackend();
  const toast = useToast();
  const pick = usePickFile();
  const [source, setSource] = useState<FileSource | null>(null);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setSource(null); setDesc(""); setErr(null); } }, [open]);
  async function go() {
    if (!source) return;
    setBusy(true); setErr(null);
    try {
      const a = await backend.addAttachment(source, desc || null, link);
      toast("success", `${a.file_name} quedó guardado y cifrado.`);
      onDone(a); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Adjuntar documento" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Paperclip} onClick={go} disabled={!source || busy}>{busy ? "Guardando…" : "Adjuntar"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon={Upload} onClick={async () => { const s = await pick(); if (s) setSource(s); }}>Elegir archivo…</Button>
          <span className="min-w-0 truncate text-sm text-muted">{source ? sourceName(source) : "Ningún archivo elegido"}</span>
        </div>
        <TextArea label="Descripción" optional value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. factura del proveedor, contrato de arriendo, foto de la guía de despacho" />
        <p className="text-xs text-muted">Máximo 50 MB. El archivo se guarda cifrado en la carpeta de tu negocio y se incluye en los respaldos.</p>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

/** Panel de documentos de un registro (cliente, venta, compra…). */
export function AttachmentsPanel({ link }: { link: EntityRef }) {
  const backend = useBackend();
  const { can } = useSession();
  const [rows, setRows] = useState<AttachmentRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { backend.listAttachments("", link).then(setRows).catch(() => setRows([])); }, [backend, link.entity, link.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  if (!backend.features.has("documentos") || !can("documentos.ver")) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Documentos</h3>
        {can("documentos.subir") && <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => setAdding(true)}>Adjuntar</Button>}
      </div>
      {rows === null ? <Spinner /> : rows.length === 0 ? <p className="text-sm text-muted">Sin documentos adjuntos.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((a) => {
            const I = fileIcon(a.mime_type);
            return (
              <li key={a.uid}>
                <button onClick={() => navigate(`/documentos?ver=${a.uid}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                  <I size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
                  <span className="text-xs text-muted">{formatBytes(a.size_bytes)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <AttachDialog open={adding} onClose={() => setAdding(false)} link={link} onDone={load} />
    </div>
  );
}

export function Documents({ route }: { route: Route }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AttachmentRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const viewing = route.query.get("ver");

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { backend.listAttachments(query, null).then((r) => alive && setRows(r)).catch((e) => setErr(errorMessage(e))); }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [backend, query, version]);

  const cols: Column<AttachmentRow>[] = [
    { key: "n", header: "Archivo", render: (a) => { const I = fileIcon(a.mime_type); return <span className="inline-flex min-w-0 items-center gap-2"><I size={16} className="shrink-0 text-muted" aria-hidden /><span className="truncate font-medium text-ink">{a.file_name}</span></span>; } },
    { key: "d", header: "Descripción", render: (a) => <span className="text-muted">{a.description ?? "—"}</span> },
    { key: "v", header: "Vinculado a", width: "10rem", render: (a) => <span className="text-muted">{a.links.length ? a.links.map((l) => ENTITY_LABEL[l.split(":")[0]!] ?? l).join(", ") : "—"}</span> },
    { key: "s", header: "Tamaño", width: "7rem", align: "right", render: (a) => <span className="num text-muted">{formatBytes(a.size_bytes)}</span> },
    { key: "f", header: "Agregado", width: "9rem", render: (a) => <span className="num text-muted">{new Date(a.created_at).toLocaleDateString("es-CL")}</span> },
  ];
  const doc = viewing ? rows?.find((r) => r.uid === viewing) : undefined;

  return (
    <div className="anim-in">
      <PageHeader
        title="Documentos"
        subtitle="Facturas de proveedores, contratos, fotos de guías… guardados cifrados en tu computador."
        actions={can("documentos.subir") && <Button icon={Paperclip} onClick={() => setAdding(true)}>Adjuntar documento</Button>}
      />
      <div className="mb-4"><Field aria-label="Buscar documentos" leading={<Search size={15} />} placeholder="Nombre de archivo o descripción" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" /></div>
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable
        label="Documentos"
        columns={cols}
        rows={rows ?? []}
        rowKey={(a) => a.uid}
        onOpen={(a) => navigate(`/documentos?ver=${a.uid}`, { replace: true })}
        empty={<EmptyState icon={Paperclip} title={query ? "Sin coincidencias" : "Aún no tienes documentos"}>Adjunta facturas de proveedores, contratos o fotos. También puedes adjuntarlos desde la ficha de un cliente.</EmptyState>}
      />
      <AttachDialog open={adding} onClose={() => setAdding(false)} link={null} onDone={() => setVersion((v) => v + 1)} />
      {doc && <DocDrawer doc={doc} onClose={() => navigate("/documentos", { replace: true })} onRemoved={() => { setVersion((v) => v + 1); navigate("/documentos", { replace: true }); toast("info", "Documento quitado. Queda registrado en la auditoría."); }} />}
    </div>
  );
}

function DocDrawer({ doc, onClose, onRemoved }: { doc: AttachmentRow; onClose: () => void; onRemoved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setPreview(undefined); backend.attachmentPreview(doc.uid).then(setPreview).catch(() => setPreview(null)); }, [backend, doc.uid]);
  const I = fileIcon(doc.mime_type);
  return (
    <Drawer
      open
      onClose={onClose}
      title={doc.file_name}
      subtitle={`${formatBytes(doc.size_bytes)} · agregado ${new Date(doc.created_at).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" })}${doc.created_by ? ` por ${doc.created_by}` : ""}`}
      footer={
        <>
          {can("documentos.quitar") && <Button variant="ghost" icon={Trash2} onClick={() => setRemoving(true)}>Quitar</Button>}
          <Button icon={Download} onClick={async () => { try { if (await backend.exportAttachment(doc)) toast("success", "Copia guardada."); } catch (e) { toast("danger", errorMessage(e)); } }}>Guardar una copia</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {doc.description && <p className="text-sm text-ink">{doc.description}</p>}
        <div className="flex min-h-48 items-center justify-center rounded-lg border border-line bg-surface-2 p-3">
          {preview === undefined ? <Spinner /> : preview ? <img src={preview} alt={doc.file_name} className="max-h-[60vh] max-w-full rounded" /> : (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
              <I size={36} aria-hidden />
              Vista previa disponible solo para imágenes. Usa “Guardar una copia” para abrirlo con tu programa habitual.
            </div>
          )}
        </div>
        {doc.sha256 && <p className="break-all font-mono text-[11px] text-faint">SHA-256 {doc.sha256}</p>}
      </div>
      <Dialog open={removing} onClose={() => setRemoving(false)} title="Quitar documento" size="sm" footer={<><Button variant="ghost" onClick={() => setRemoving(false)}>Cancelar</Button><Button variant="danger" disabled={!reason.trim()} onClick={async () => { try { await backend.archiveAttachment(doc.uid, reason); setRemoving(false); onRemoved(); } catch (e) { toast("danger", errorMessage(e)); } }}>Quitar</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">El documento deja de aparecer en las listas, pero no se borra: sigue en tus respaldos y en la auditoría.</p>
          <TextArea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
        </div>
      </Dialog>
    </Drawer>
  );
}
