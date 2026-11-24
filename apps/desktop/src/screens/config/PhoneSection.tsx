// Configuración → Celular: emparejar la app del celular con este computador y ver los dispositivos.
// La sincronización va directo entre ambos equipos por la red local (WiFi o cable), cifrada y sin
// internet (docs/SINCRONIZACION.md, fase S1). El código de emparejamiento es un secreto: Claude no
// lo ve (data-agent-secret) y quitar un dispositivo lo confirma la persona.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Laptop, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi } from "lucide-react";
import { errorMessage, useBackend, type SyncPairingCode, type SyncPeer, type SyncView } from "../../data";
import { formatDate } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, IconButton, Notice, Spinner } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { Dialog, useToast } from "../../ui/overlay";

function when(iso: string | null): string {
  if (!iso) return "Aún no sincroniza";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(iso);
  const time = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `Hoy, ${time}` : `${formatDate(iso.slice(0, 10))}, ${time}`;
}

/** El QR va siempre en negro sobre blanco, también en el tema oscuro: así lo leen las cámaras. */
function QrImage({ text }: { text: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { n: count, d: path };
  }, [text]);
  return (
    <svg viewBox={`-3 -3 ${n + 6} ${n + 6}`} role="img" aria-label="Código QR para emparejar el celular" shapeRendering="crispEdges"
      className="h-56 w-56 max-w-full rounded-xl border border-line" style={{ background: "#ffffff" }}>
      <path d={d} fill="#000000" />
    </svg>
  );
}

export function PhoneSection() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [view, setView] = useState<SyncView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<{ code: SyncPairingCode; until: number; known: string[] } | null>(null);
  const [expired, setExpired] = useState(false);
  const [left, setLeft] = useState(0);
  const [removing, setRemoving] = useState<SyncPeer | null>(null);
  const pairingRef = useRef(pairing);
  pairingRef.current = pairing;

  const load = useCallback(async () => {
    try { setView(await backend.syncStatus()); } catch (e) { setErr(errorMessage(e)); }
  }, [backend]);
  useEffect(() => { void load(); }, [load]);

  // Mientras el código está en pantalla: cuenta regresiva y aviso cuando el celular entra.
  useEffect(() => {
    if (!pairing || expired) return;
    const tick = async () => {
      const p = pairingRef.current;
      if (!p) return;
      setLeft(Math.max(0, Math.ceil((p.until - Date.now()) / 1000)));
      try {
        const v = await backend.syncStatus();
        setView(v);
        const fresh = v.peers.find((x) => !x.revoked && x.has_key && !p.known.includes(x.device_uid));
        if (fresh) {
          setPairing(null);
          toast("success", `«${fresh.name}» quedó emparejado. Desde el celular, toca «Sincronizar ahora».`);
        } else if (!v.pairing_open || Date.now() > p.until) {
          setExpired(true);
        }
      } catch { /* se reintenta en el próximo ciclo */ }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => window.clearInterval(id);
  }, [pairing, expired, backend, toast]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!view) return <Spinner />;

  const active = view.peers.filter((p) => !p.revoked);
  const isMain = view.role === "escritorio";

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setView(await backend.syncEnable(on));
      toast("success", on ? "Sincronización activada: los celulares emparejados ya pueden conectarse." : "Sincronización apagada: el computador dejó de escuchar en la red.");
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const startPairing = async () => {
    setBusy(true);
    try {
      const code = await backend.syncPairStart();
      setExpired(false);
      setLeft(code.minutes * 60);
      setPairing({ code, until: Date.now() + code.minutes * 60_000, known: active.map((p) => p.device_uid) });
      await load();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const closePairing = async () => {
    setPairing(null);
    try { setView(await backend.syncPairCancel()); } catch { /* el código vence solo */ }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      setView(await backend.syncRevoke(removing.device_uid));
      toast("success", `«${removing.name}» ya no puede sincronizar con este negocio.`);
      setRemoving(null);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };

  const columns: Column<SyncPeer>[] = [
    { key: "name", header: "Dispositivo", width: "minmax(10rem,1.4fr)", render: (p) => (
      <span className="flex min-w-0 items-center gap-2">
        {p.role === "celular" ? <Smartphone size={16} className="shrink-0 text-muted" /> : <Laptop size={16} className="shrink-0 text-muted" />}
        <strong className="truncate">{p.name}</strong>
      </span>
    ) },
    { key: "paired", header: "Emparejado", width: "8rem", render: (p) => formatDate(p.paired_at.slice(0, 10)) },
    { key: "last", header: "Última sincronización", width: "minmax(9rem,1fr)", render: (p) => when(p.last_sync_at) },
    { key: "state", header: "Estado", width: "8rem", render: (p) => p.has_key ? <Badge tone="success" icon={ShieldCheck}>Con llave</Badge> : <Badge>Sin llave</Badge> },
    ...(editable ? [{ key: "actions", header: "", width: "3rem", align: "right" as const, render: (p: SyncPeer) => (
      <span data-agent-human><IconButton icon={Trash2} label={`Quitar ${p.name}`} onClick={() => setRemoving(p)} /></span>
    ) }] : []),
  ];
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="NÚCLEO en el celular"
        subtitle="La app del celular funciona sin internet y se sincroniza directo con este computador, por la WiFi de la misma red o por el cable."
        actions={editable && isMain ? <Button icon={Smartphone} onClick={startPairing} disabled={busy}>Emparejar un celular</Button> : undefined}
      >
        <div className="flex flex-col gap-4">
          {!isMain && <Notice tone="info">Este equipo no es el computador principal del negocio: los celulares se emparejan desde el principal.</Notice>}
          <Checkbox
            label="Permitir que los celulares emparejados sincronicen con este computador"
            checked={view.enabled}
            onChange={(v) => { if (editable && !busy) void toggle(v); }}
            hint="Mientras NÚCLEO esté abierto, el computador escucha solo en tu red local. Nada pasa por internet ni por servidores de NÚCLEO."
          />
          {view.enabled && (view.listening
            ? <Notice tone="success" title="Listo para sincronizar">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><Wifi size={15} /> Dirección de este computador en la red: <strong className="font-mono">{view.address}</strong></span>
                <span className="mt-1 block">La primera vez, Windows pregunta si permite a NÚCLEO en redes privadas: acepta para que el celular pueda conectarse.</span>
              </Notice>
            : <Notice tone="warning" title="El computador no está escuchando">No se pudo abrir la conexión en la red local. Revisa que el cortafuegos permita a NÚCLEO en redes privadas y vuelve a activar la opción.</Notice>)}
          {view.conflicts > 0 && <Notice tone="warning">{view.conflicts === 1 ? "Hay 1 ficha que se unió al sincronizar y conviene revisar." : `Hay ${view.conflicts} fichas que se unieron al sincronizar y conviene revisar.`}</Notice>}
          <DataTable label="Dispositivos emparejados" columns={columns} rows={active} rowKey={(p) => p.device_uid} empty="Aún no hay celulares emparejados." />
          <p className="text-sm text-muted">La app para Android está en construcción. Cuando esté publicada, se compra una vez y queda en el celular, igual que NÚCLEO en el computador.</p>
        </div>
      </Card>

      <Dialog
        open={!!pairing}
        onClose={() => void closePairing()}
        title="Emparejar un celular"
        footer={<>
          {expired && <Button variant="secondary" icon={RefreshCw} onClick={startPairing} disabled={busy}>Generar otro código</Button>}
          <Button variant="ghost" onClick={() => void closePairing()}>Cerrar</Button>
        </>}
      >
        {pairing && (expired
          ? <Notice tone="warning" title="El código ya no sirve">Venció o se intentó con códigos equivocados. Genera otro para emparejar el celular.</Notice>
          : (
            <div className="flex flex-col gap-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>Conecta el celular a la <strong>misma WiFi</strong> que este computador (o únelos con el cable y activa el anclaje de USB).</li>
                <li>En la app abre <strong>Sincronizar → Emparejar con mi computador</strong>.</li>
                <li>Escanea el código o escribe las letras.</li>
              </ol>
              <div data-agent-secret className="flex flex-col items-center gap-3">
                <QrImage text={pairing.code.qr} />
                <div aria-label="Código de emparejamiento" className="grid select-all grid-cols-4 gap-x-3 gap-y-1.5 rounded-xl border border-line bg-surface-2 px-4 py-3 font-mono text-base tracking-wider">
                  {pairing.code.code.split("-").map((g, i) => <span key={i}>{g}</span>)}
                </div>
              </div>
              <p className="text-center text-sm text-muted">Sirve una sola vez y vence en <strong className="num text-ink">{mm}:{ss}</strong>. No lo compartas: quien lo use queda emparejado con tu negocio.</p>
            </div>
          ))}
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title="Quitar dispositivo"
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button>
          <span data-agent-human><Button variant="danger" onClick={remove} disabled={busy}>Quitar dispositivo</Button></span>
        </>}
      >
        {removing && <p className="text-sm"><strong>{removing.name}</strong> dejará de sincronizar con este negocio y su llave se borra. Lo que tenga sin enviar se pierde. Para volver a usarlo habrá que emparejarlo de nuevo.</p>}
      </Dialog>
    </div>
  );
}
