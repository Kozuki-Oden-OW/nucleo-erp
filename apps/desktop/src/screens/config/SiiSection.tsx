// Configuración → Facturación SII: datos del emisor ante el SII, certificado digital (.pfx), folios
// (CAF) y prueba de conexión. La emisión desde las ventas llega en la fase F6
// (docs/SII_FACTURACION_PROPIA.md); por ahora se prepara todo lo necesario para la certificación.
import { useCallback, useEffect, useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { BadgeCheck, FileKey2, FileText, PlugZap, Save, Upload } from "lucide-react";
import { errorMessage, useBackend, type SiiAmbiente, type SiiDocument, type SiiFolios, type SiiSetup, type SiiStatus } from "../../data";
import { formatCLP, formatDate } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Field, Notice, Segmented, Spinner } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { useToast } from "../../ui/overlay";

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

  const apply = useCallback((s: SiiStatus) => {
    setSt(s);
    setForm({ ambiente: s.ambiente, emisor: { ...s.emisor }, resolucion_fecha: s.resolucion_fecha, resolucion_numero: s.resolucion_numero });
    setActecos(s.emisor.actecos.join(", "));
  }, []);
  const load = useCallback(async () => {
    try {
      apply(await backend.siiStatus());
      setDocs(await backend.siiDocuments(200));
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

      {docs.length > 0 && (
        <Card title="Documentos emitidos" subtitle="Timbrados y firmados por NÚCLEO, con su estado en el SII." actions={<Badge icon={FileText}>{docs.length}</Badge>}>
          <DataTable label="Documentos emitidos" rows={docs} columns={docCols} rowKey={(d) => String(d.id)} />
        </Card>
      )}
    </div>
  );
}
