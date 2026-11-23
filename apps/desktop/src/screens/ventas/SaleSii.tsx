// Botón «Emitir en el SII» de una venta efectuada: arma el borrador de la factura con los datos de la
// venta, lo deja revisar, lo timbra y ofrece enviarlo al SII (el envío se confirma aparte: no se puede
// deshacer). Solo aparece si la facturación electrónica propia está lista en Configuración.
import { useEffect, useState } from "react";
import { Send, Stamp } from "lucide-react";
import { errorMessage, useBackend, type SaleDetail, type SiiDocument, type SiiIssueInput, type SiiStatus } from "../../data";
import { formatCLP } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Button, Notice } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";
import { SiiIssueDialog } from "../config/SiiIssueDialog";

export function SaleSiiButton({ sale, onChanged }: { sale: SaleDetail; onChanged: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [st, setSt] = useState<SiiStatus | null>(null);
  const [draft, setDraft] = useState<SiiIssueInput | null>(null);
  const [issued, setIssued] = useState<SiiDocument | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { backend.siiStatus().then(setSt).catch(() => setSt(null)); }, [backend]);

  const efectuada = sale.commercial_state === "efectuada" || sale.commercial_state === "cerrada";
  if (!st || st.faltantes.length > 0 || !efectuada || sale.historical || !can("ventas.documentar")) return null;
  const prueba = st.ambiente === "certificacion";

  const abrir = async () => {
    setBusy(true);
    try { setDraft(await backend.siiSaleDraft(sale.uid)); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const enviar = async () => {
    if (!issued) return;
    setBusy(true);
    try {
      const out = await backend.siiSend([issued.id]);
      const d = out.find((x) => x.id === issued.id);
      toast("success", `Enviada al SII${d?.track_id ? ` (track id ${d.track_id})` : ""}. Revisa su estado en Configuración → Facturación SII.`);
      setIssued(null); onChanged();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="secondary" icon={Stamp} onClick={() => void abrir()} disabled={busy}>Emitir en el SII{prueba ? " (prueba)" : ""}</Button>
      <SiiIssueDialog open={!!draft} initial={draft} onClose={() => setDraft(null)} folios={st.folios} ambiente={st.ambiente}
        onIssued={(d) => { setDraft(null); setIssued(d); onChanged(); }} />
      <Dialog open={!!issued} onClose={() => setIssued(null)} title="Documento timbrado"
        footer={<><Button variant="ghost" onClick={() => setIssued(null)}>Después</Button><Button icon={Send} onClick={() => void enviar()} disabled={busy}>{busy ? "Enviando…" : "Enviar al SII"}</Button></>}>
        {issued && (
          <div className="flex flex-col gap-3 text-sm">
            <p><strong>{issued.tipo_nombre} N° {issued.folio}</strong> a {issued.receptor} por {formatCLP(issued.total_minor)} quedó timbrada y firmada en tu computador.</p>
            <Notice tone="warning">Al enviarla al SII ya no se puede borrar: un error se corrige con una nota de crédito.{prueba ? " Estás en certificación: no tiene efecto tributario y la venta no cambia." : ""}</Notice>
            <p className="text-xs text-muted">Si prefieres revisarla o imprimirla antes, la encuentras en Configuración → Facturación SII → Documentos.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
