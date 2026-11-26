// Configuración → Integraciones: correo de la empresa, Mercado Libre (ventas, stock, facturación y lo que
// cobra), la tienda WooCommerce y, cuando lleguen las credenciales, couriers y bancos (docs/INTEGRACIONES.md).
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Landmark, Link2, RefreshCw, ShoppingBag, Truck, Unplug } from "lucide-react";
import { MailCard } from "./MailCard";
import { WhatsAppCard } from "./WhatsAppCard";
import { WooCard } from "./WooCard";
import { AccessCard } from "./AccessCard";
import { errorMessage, useBackend, type MlOrderRow, type MlStatus, type MlSyncReport, type Product } from "../../data";
import { formatCLP, formatDate } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Field, Notice, Spinner } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { useToast } from "../../ui/overlay";
import { ProductPicker } from "../ventas/pickers";

const STATUS: Record<MlOrderRow["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  importada: { label: "Importada", tone: "success" },
  por_revisar: { label: "Por revisar", tone: "warning" },
  cancelada: { label: "Cancelada en ML", tone: "danger" },
};

/** Publicación de Mercado Libre mencionada en el aviso de un pedido por revisar (ej. «MLC123»). */
function itemsOf(issue: string | null): { id: string; title: string }[] {
  if (!issue) return [];
  return [...issue.matchAll(/«([^»]*)» \(([A-Z0-9-]+)\)/g)].map((m) => ({ title: m[1]!, id: m[2]! }));
}

export function IntegrationsSection() {
  return (
    <div className="flex flex-col gap-5">
      <MailCard />
      <WhatsAppCard />
      <MercadoLibreCard />
      <WooCard />
      <AccessCard />
      <Card title="Couriers" subtitle="Crear órdenes de transporte desde Envíos con la etiqueta y el seguimiento, y avisar al cliente por correo." actions={<Badge icon={Truck}>Próximamente</Badge>}>
        <ul className="flex flex-col gap-1.5 text-sm text-muted">
          <li><strong className="text-ink">Bluexpress:</strong> pide a tu ejecutivo la documentación de la API y la llave de tu cuenta empresa (o instala su plugin en WooCommerce).</li>
          <li><strong className="text-ink">Chilexpress, Starken y Correos de Chile:</strong> con la cuenta empresa de cada uno (llave de API o credencial de servicios web).</li>
          <li><strong className="text-ink">Envíame:</strong> una sola llave para cotizar y emitir con varios couriers.</li>
        </ul>
      </Card>
      <Card title="Bancos (solo lectura)" subtitle="Saldos y movimientos para cuadrar cobros y pagos solos. NÚCLEO nunca mueve dinero." actions={<Badge icon={Landmark}>Próximamente</Badge>}>
        <p className="text-sm text-muted">
          Gratis y sin la clave del banco: NÚCLEO leerá en tu correo los avisos de transferencia que envían los bancos (Banco de Chile, BCI, Scotiabank,
          Itaú, Mach…) para saber quién pagó, y la cartola que descargas para saldos, ingresos, egresos y glosas. Hoy: importa la cartola en Dinero → Conciliación.
        </p>
      </Card>
    </div>
  );
}

function MercadoLibreCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [st, setSt] = useState<MlStatus | null>(null);
  const [orders, setOrders] = useState<MlOrderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [redirect, setRedirect] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [from, setFrom] = useState("");
  const [report, setReport] = useState<MlSyncReport | null>(null);
  const [linking, setLinking] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await backend.mlStatus();
      setSt(s);
      setClientId(s.client_id ?? "");
      setRedirect(s.redirect_uri);
      setOrders(await backend.mlOrders(300));
    } catch (e) { setErr(errorMessage(e)); }
  }, [backend]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!st) return <Spinner />;

  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try { await f(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  };
  const saveApp = () => run("save", async () => {
    setSt(await backend.mlSaveApp(clientId, secret, redirect));
    setSecret("");
    toast("success", "Aplicación guardada. Ahora presiona «Conectar».");
  });
  const connect = () => run("connect", async () => {
    const url = await backend.mlConnect();
    setAuthUrl(url);
    toast("info", "Se abrió Mercado Libre en el navegador: autoriza a tu aplicación.");
    const s = await backend.mlWait();
    setSt(s);
    setAuthUrl(null);
    toast("success", `Mercado Libre conectado (${s.nickname ?? s.user_id}).`);
    setOrders(await backend.mlOrders(300));
  });
  const finish = () => run("finish", async () => {
    const s = await backend.mlFinish(code);
    setSt(s);
    setAuthUrl(null);
    setCode("");
    toast("success", `Mercado Libre conectado (${s.nickname ?? s.user_id}).`);
  });
  const sync = () => run("sync", async () => {
    const r = await backend.mlSync(from || null);
    setReport(r);
    setOrders(await backend.mlOrders(300));
    setSt(await backend.mlStatus());
    toast(r.to_review ? "warning" : "success", `Ventas nuevas ${r.imported} · completadas ${r.completed} · por revisar ${r.to_review} · por facturar ${r.to_invoice}`);
  });
  const disconnect = () => run("disconnect", async () => { setSt(await backend.mlDisconnect()); });
  const link = (p: Product | null) => {
    if (!p || !linking) return;
    void run("link", async () => {
      await backend.mlLinkItem(linking.id, null, p.uid, linking.title);
      toast("success", `«${linking.title}» quedó enlazada con ${p.name}. Sincroniza para confirmar la venta.`);
      setLinking(null);
    });
  };

  const totals = orders.filter((o) => o.status !== "cancelada").reduce(
    (a, o) => ({ total: a.total + o.total_minor, fee: a.fee + o.sale_fee_minor, ship: a.ship + o.shipping_cost_minor, net: a.net + o.net_minor }),
    { total: 0, fee: 0, ship: 0, net: 0 },
  );
  const columns: Column<MlOrderRow>[] = [
    { key: "date", header: "Fecha", width: "6.5rem", render: (o) => formatDate(o.date_created) },
    { key: "order", header: "Pedido", width: "7.5rem", render: (o) => <span className="font-mono text-xs">{o.pack_id ?? o.order_id}</span> },
    { key: "buyer", header: "Comprador", width: "minmax(8rem,1fr)", render: (o) => (
      <span className="flex min-w-0 items-center gap-2" title={`Comisión ${formatCLP(o.sale_fee_minor)} · envío ${formatCLP(o.shipping_cost_minor)}`}><span className="truncate">{o.buyer ?? "—"}</span>{o.needs_invoice && <Badge tone="info">Por facturar</Badge>}</span>
    ) },
    { key: "total", header: "Total", align: "right", width: "6.5rem", render: (o) => formatCLP(o.total_minor) },
    { key: "net", header: "A recibir", align: "right", width: "6.5rem", render: (o) => <strong>{formatCLP(o.net_minor)}</strong> },
    { key: "status", header: "Estado", width: "11rem", render: (o) => (
      <span className="flex min-w-0 items-center gap-2">
        <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
        {o.sale_number && <span className="truncate text-xs text-muted">{o.sale_number}</span>}
      </span>
    ) },
  ];
  const pending = orders.filter((o) => o.status !== "importada" && o.issue);

  return (
    <Card
      title="Mercado Libre"
      subtitle="Trae tus ventas pagadas como ventas de NÚCLEO (descuentan stock), marca las que piden factura y muestra la comisión y el envío que cobra Mercado Libre."
      actions={st.connected ? <Badge tone="success" icon={CheckCircle2}>Conectado · {st.nickname ?? st.user_id}</Badge> : <Badge icon={ShoppingBag}>Sin conectar</Badge>}
    >
      <div className="flex flex-col gap-5">
        {!st.connected && (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>
                Crea tu aplicación en{" "}
                <a className="text-accent underline" href="https://developers.mercadolibre.cl/devcenter" target="_blank" rel="noreferrer">developers.mercadolibre.cl <ExternalLink size={12} className="inline" aria-hidden /></a>{" "}
                (Mis aplicaciones → Crear). En «URI de redirect» escribe <code className="rounded bg-surface-2 px-1">{st.redirect_uri}</code> y activa el permiso de ventas con acceso sin conexión (offline_access).
              </li>
              <li>Copia aquí el <strong>App ID</strong> y la <strong>Clave secreta</strong> y guarda.</li>
              <li>Presiona <strong>Conectar</strong> y autoriza en Mercado Libre. NÚCLEO recibe la respuesta solo.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="App ID" value={clientId} onChange={(e) => setClientId(e.target.value)} inputMode="numeric" disabled={!editable} />
              <Field label="Clave secreta" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!editable}
                placeholder={st.has_secret ? "Guardada (escribe para cambiarla)" : ""} />
              <Field className="sm:col-span-2" label="URI de redirect" value={redirect} onChange={(e) => setRedirect(e.target.value)} disabled={!editable}
                hint="Debe ser idéntica a la que escribiste en tu aplicación de Mercado Libre." />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={saveApp} disabled={!editable || !!busy || !clientId}>Guardar aplicación</Button>
              <Button onClick={connect} disabled={!editable || !!busy || !st.configured}>{busy === "connect" ? "Esperando a Mercado Libre…" : "Conectar"}</Button>
            </div>
            {authUrl && (
              <Notice tone="info" title="Esperando a Mercado Libre">
                <div className="flex flex-col gap-2">
                  <span>Si el navegador no se abrió, copia esta dirección: <span className="break-all font-mono text-xs">{authUrl}</span></span>
                  <span>Si la página de retorno te muestra un código, pégalo aquí:</span>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field className="min-w-[16rem] flex-1" label="Código" value={code} onChange={(e) => setCode(e.target.value)} placeholder="TG-…" />
                    <Button onClick={finish} disabled={!code.trim() || busy === "finish"}>Terminar conexión</Button>
                  </div>
                </div>
              </Notice>
            )}
          </>
        )}

        {(st.connected || orders.length > 0) && (
          <>
            {st.connected ? (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} hint="Vacío: últimos 15 días." />
                <Button icon={RefreshCw} onClick={sync} disabled={!!busy}>{busy === "sync" ? "Sincronizando…" : "Sincronizar ventas"}</Button>
                {editable && <Button variant="ghost" icon={Unplug} onClick={disconnect} disabled={!!busy}>Desconectar</Button>}
                <span className="text-xs text-muted">{st.last_sync_at ? `Última sincronización: ${new Date(st.last_sync_at).toLocaleString("es-CL")}` : "Aún no sincronizas."}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">Estas ventas se registraron leyendo el portal de vendedores, sin la conexión automática.</p>
            )}
            {pending.length > 0 && (
              <Notice tone="warning" title={`Para revisar (${pending.length})`}>
                <ul className="flex flex-col gap-2">
                  {pending.slice(0, 20).map((o) => (
                    <li key={o.order_id} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{o.pack_id ?? o.order_id}</span>
                      <span>{o.issue}</span>
                      {o.status === "por_revisar" && itemsOf(o.issue).map((it) => (
                        <Button key={it.id} size="sm" variant="secondary" icon={Link2} onClick={() => setLinking(it)}>Enlazar {it.id}</Button>
                      ))}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {report && report.messages.some((m) => !pending.some((o) => m.includes(o.order_id))) && (
              <Notice tone="info" title="Mensajes de la sincronización">
                <ul className="list-disc pl-5">{report.messages.slice(0, 12).map((m) => <li key={m}>{m}</li>)}</ul>
              </Notice>
            )}
            {linking && (
              <Notice tone="info" title={`Enlazar ${linking.id} · «${linking.title}»`}>
                <div className="flex flex-col gap-2">
                  <span>Elige el producto de NÚCLEO que vendes en esa publicación. Las próximas ventas se enlazan solas.</span>
                  <ProductPicker onPick={(p) => link(p)} />
                  <div><Button size="sm" variant="ghost" onClick={() => setLinking(null)}>Cancelar</Button></div>
                </div>
              </Notice>
            )}
            {orders.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Mini label="Vendido" value={totals.total} />
                <Mini label="Comisiones" value={totals.fee} />
                <Mini label="Envíos" value={totals.ship} />
                <Mini label="A recibir de Mercado Pago" value={totals.net} strong />
              </div>
            )}
            <DataTable
              label="Pedidos de Mercado Libre"
              columns={columns}
              rows={orders}
              rowKey={(o) => o.order_id}
              maxHeight="28rem"
              onOpen={(o) => o.sale_uid && navigate(`/ventas/${o.sale_uid}`)}
              empty="Aún no hay pedidos. Presiona «Sincronizar ventas»."
            />
          </>
        )}
      </div>
    </Card>
  );
}

function Mini({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={strong ? "text-lg font-semibold" : "text-base"}>{formatCLP(value)}</div>
    </div>
  );
}
