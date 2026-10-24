// Sincronización con el computador: por cable USB o por la WiFi de la misma red, sin internet
// ni servidor de NÚCLEO (docs/SINCRONIZACION.md). En la demostración se simula el intercambio.
import { useState } from "react";
import { Cable, CheckCircle2, HandCoins, Laptop, QrCode, Receipt, RefreshCw, ShieldCheck, ShoppingBag, UserPlus, Wifi } from "lucide-react";
import { errorMessage } from "../../data";
import { formatMoney } from "../../lib/format";
import { useToast } from "../../ui/overlay";
import { useNav } from "../MobileApp";
import { outbox, sinceText, useOutbox, type OutboxKind } from "../outbox";
import { BigButton, Panel, Row, Section, Sheet, TopBar } from "../ui";

const ICON: Record<OutboxKind, typeof Receipt> = { venta: ShoppingBag, gasto: Receipt, cobro: HandCoins, cliente: UserPlus };

export function Sync({ demo }: { demo: boolean }) {
  const nav = useNav();
  const toast = useToast();
  const box = useOutbox();
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(false);

  async function syncNow() {
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const n = box.items.length;
      await outbox.markSynced();
      toast("success", n ? `${n} ${n === 1 ? "cambio enviado" : "cambios enviados"} al computador.` : "Todo al día con el computador.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <TopBar title="Sincronizar" onBack={nav.back} />
      <div className="px-4 pt-4">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent"><Laptop size={24} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold text-ink">{demo ? "Computador de demostración" : "Computador emparejado"}</div>
            <div className="text-[13px] text-muted">Última sincronización: {sinceText(box.lastSync)}</div>
          </div>
          {box.items.length === 0 && box.lastSync && <CheckCircle2 size={22} className="text-success" />}
        </div>
      </div>

      <Section title={box.items.length ? `Por enviar al computador · ${box.items.length}` : "Por enviar al computador"}>
        {box.items.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-4 py-5 text-center text-[14px] text-muted">No hay cambios pendientes. Lo que registres en el celular aparecerá aquí hasta sincronizar.</p>
        ) : (
          <Panel>
            {box.items.map((it) => (
              <Row key={it.id} icon={ICON[it.kind]} title={it.label} sub={sinceText(it.at)}
                right={it.amount_minor !== null ? <span className="num text-[15px] font-semibold">{formatMoney(it.amount_minor)}</span> : undefined} />
            ))}
          </Panel>
        )}
      </Section>

      <div className="px-4 pt-5"><BigButton icon={RefreshCw} onClick={syncNow} disabled={busy}>{busy ? "Sincronizando…" : "Sincronizar ahora"}</BigButton></div>

      <Section title="Cómo se conecta">
        <Panel>
          <Row icon={Wifi} title="Por WiFi" sub="Con el celular y el computador en la misma red." />
          <Row icon={Cable} title="Por cable USB" sub="Conecta el celular al computador y listo." />
          <Row icon={ShieldCheck} tone="success" title="Sin internet ni servidores" sub="Tus datos van directo del celular a tu computador, cifrados." />
        </Panel>
      </Section>

      <div className="px-4 pt-4"><BigButton variant="secondary" icon={QrCode} onClick={() => setPairing(true)}>Emparejar con otro computador</BigButton></div>

      <Sheet open={pairing} onClose={() => setPairing(false)} title="Emparejar con tu computador">
        <ol className="space-y-3 text-[15px] text-ink">
          <li className="flex gap-3"><Step n={1} /><span>En el computador abre NÚCLEO y entra a <b>Configuración → Celular → Emparejar un celular</b>.</span></li>
          <li className="flex gap-3"><Step n={2} /><span>Aparecerá un código QR. Apunta la cámara del celular al código.</span></li>
          <li className="flex gap-3"><Step n={3} /><span>Listo: quedan emparejados, sin correo ni contraseña. Desde ahí sincronizan por WiFi o por cable.</span></li>
        </ol>
        <div className="mt-5"><BigButton icon={QrCode} onClick={() => { setPairing(false); toast("info", demo ? "En la demostración ya estás emparejado con un computador de ejemplo." : "Abre la cámara apuntando al QR del computador."); }}>Escanear código QR</BigButton></div>
      </Sheet>
    </>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[14px] font-bold text-accent-contrast">{n}</span>;
}
