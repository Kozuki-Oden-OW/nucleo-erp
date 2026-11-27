// Configuración → Integraciones → WooCommerce: conecta la tienda (con el código del plugin «NÚCLEO ERP» o
// con las llaves de la API REST), trae los pedidos pagados como clientes, ventas y envíos, y envía a la
// tienda el stock y los precios de NÚCLEO por SKU, siempre con vista previa (docs/INTEGRACIONES.md, I8).
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, PackageCheck, RefreshCw, Store, Tag, Unplug } from "lucide-react";
import { errorMessage, useBackend, type WooOrderRow, type WooPushChange, type WooPushReport, type WooStatus, type WooSyncReport } from "../../data";
import { formatCLP, formatDate } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, Field, Notice, Spinner } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { Dialog, useToast } from "../../ui/overlay";
import { WooEquivalences } from "./WooEquivalences";

const STATUS: Record<WooOrderRow["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  importada: { label: "Importada", tone: "success" },
  por_revisar: { label: "Por revisar", tone: "warning" },
  cancelada: { label: "Cancelada en la tienda", tone: "danger" },
};

export function WooCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [st, setSt] = useState<WooStatus | null>(null);
  const [orders, setOrders] = useState<WooOrderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [manual, setManual] = useState(false);
  const [from, setFrom] = useState("");
  const [report, setReport] = useState<WooSyncReport | null>(null);
  const [push, setPush] = useState<{ stock: boolean; prices: boolean; report: WooPushReport } | null>(null);
  const [equiv, setEquiv] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await backend.wooStatus();
      setSt(s);
      setUrl(s.url ?? "");
      if (s.connected) setOrders(await backend.wooOrders(300));
    } catch (e) { setErr(errorMessage(e)); }
  }, [backend]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!st) return <Spinner />;

  const run = async (k: string, f: () => Promise<void>) => {
    setBusy(k);
    try { await f(); } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(null); }
  };
  const connect = () => run("connect", async () => {
    const s = await backend.wooConnect(manual ? { url, consumer_key: key, consumer_secret: secret, code: "" } : { url: "", consumer_key: "", consumer_secret: "", code });
    setSt(s);
    setCode(""); setKey(""); setSecret("");
    toast("success", `Tienda conectada${s.store_name ? ` (${s.store_name})` : ""}.`);
    setOrders(await backend.wooOrders(300));
  });
  const setWriteBack = (v: boolean) => run("write", async () => {
    setSt(await backend.wooConnect({ url: "", consumer_key: "", consumer_secret: "", code: "", write_back: v }));
  });
  const sync = () => run("sync", async () => {
    const r = await backend.wooSync(from || null);
    setReport(r);
    setOrders(await backend.wooOrders(300));
    setSt(await backend.wooStatus());
    toast(r.to_review ? "warning" : "success", `Ventas nuevas ${r.imported} · completadas ${r.completed} · por revisar ${r.to_review} · envíos anotados ${r.shipments} · esperando pago ${r.waiting_payment}`);
  });
  const disconnect = () => run("disconnect", async () => { setSt(await backend.wooDisconnect()); setOrders([]); setReport(null); });
  const preview = (stock: boolean, prices: boolean) => run(prices ? "prices" : "stock", async () => {
    setPush({ stock, prices, report: await backend.wooPush(stock, prices, false) });
  });
  const applyPush = () => push && run("apply", async () => {
    const r = await backend.wooPush(push.stock, push.prices, true);
    setPush(null);
    toast(r.applied ? "success" : "info", r.applied ? `Se enviaron ${r.changes.length} cambios a la tienda.` : "No había cambios que enviar.");
  });

  const columns: Column<WooOrderRow>[] = [
    { key: "date", header: "Fecha", width: "6.5rem", render: (o) => formatDate(o.date_created) },
    { key: "order", header: "Pedido", width: "5.5rem", render: (o) => <span className="font-mono text-xs">#{o.number}</span> },
    { key: "buyer", header: "Comprador", width: "minmax(8rem,1fr)", render: (o) => (
      <span className="flex min-w-0 items-center gap-2" title={[o.email, o.payment_method].filter(Boolean).join(" · ")}><span className="truncate">{o.buyer ?? "—"}</span>{o.needs_invoice && <Badge tone="info">Por facturar</Badge>}</span>
    ) },
    { key: "ship", header: "Envío", width: "minmax(7rem,0.8fr)", render: (o) => (
      <span className="truncate text-xs" title={o.shipping_method ?? undefined}>{o.shipment_number ? <strong className="text-ink">{o.shipment_number}</strong> : <span className="text-muted">{o.shipping_method ?? "—"}</span>}</span>
    ) },
    { key: "total", header: "Total", align: "right", width: "6.5rem", render: (o) => formatCLP(o.total_minor) },
    { key: "status", header: "Estado", width: "12rem", render: (o) => (
      <span className="flex min-w-0 items-center gap-2">
        <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
        {o.sale_number && <span className="truncate text-xs text-muted">{o.sale_number}</span>}
      </span>
    ) },
  ];
  const pending = orders.filter((o) => o.status !== "importada" && o.issue);
  const changeCols: Column<WooPushChange>[] = [
    { key: "sku", header: "Código", width: "6.5rem", render: (c) => <span className="font-mono text-xs">{c.sku}</span> },
    { key: "name", header: "Producto", width: "minmax(7rem,1fr)", render: (c) => <span className="truncate">{c.name}</span> },
    ...(push?.stock ? [{ key: "stock", header: "Stock", align: "right" as const, width: "8.5rem", render: (c: WooPushChange) => c.stock_to === null ? <span className="text-muted">—</span> : <Change from={c.stock_from === null ? "sin control" : String(c.stock_from)} to={String(c.stock_to)} /> }] : []),
    ...(push?.prices ? [{ key: "price", header: "Precio", align: "right" as const, width: "11.5rem", render: (c: WooPushChange) => c.price_to === null ? <span className="text-muted">—</span> : <Change from={c.price_from === null ? "sin precio" : formatCLP(c.price_from)} to={formatCLP(c.price_to)} /> }] : []),
  ];

  return (
    <Card
      title="WooCommerce"
      subtitle="Tu tienda en línea: los pedidos pagados entran como cliente, venta (descuenta stock) y envío por despachar; NÚCLEO envía a la tienda el stock y los precios."
      actions={st.connected ? <Badge tone="success" icon={CheckCircle2}>Conectado · {st.store_name ?? st.url}</Badge> : <Badge icon={Store}>Sin conectar</Badge>}
    >
      <div className="flex flex-col gap-5">
        {!st.connected && (
          <>
            {!manual ? (
              <>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                  <li>Instala en tu WordPress el plugin <strong className="text-ink">NÚCLEO ERP para WooCommerce</strong> (Plugins → Añadir nuevo → Subir plugin).</li>
                  <li>En WooCommerce → <strong className="text-ink">NÚCLEO ERP</strong> presiona «Crear conexión» y copia el código.</li>
                  <li>Pega el código aquí y presiona Conectar.</li>
                </ol>
                <Field label="Código de conexión" type="password" value={code} onChange={(e) => setCode(e.target.value)} disabled={!editable} placeholder="nucleo-woo:…"
                  hint="El código trae las llaves de tu tienda: pégalo solo aquí. NÚCLEO lo guarda cifrado y no lo vuelve a mostrar." />
              </>
            ) : (
              <>
                <p className="text-sm text-muted">
                  En tu WordPress: WooCommerce → Ajustes → Avanzado → API REST → «Añadir clave», con permisos de <strong className="text-ink">lectura y escritura</strong>. Copia aquí las dos claves.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field className="sm:col-span-2" label="Dirección de la tienda" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!editable} placeholder="https://mitienda.cl" />
                  <Field label="Clave del cliente" value={key} onChange={(e) => setKey(e.target.value)} disabled={!editable} placeholder="ck_…" autoComplete="off" />
                  <Field label="Clave secreta" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={!editable} placeholder="cs_…" />
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={connect} disabled={!editable || !!busy || (manual ? !url.trim() || !key.trim() || !secret.trim() : !code.trim())}>{busy === "connect" ? "Probando la conexión…" : "Conectar"}</Button>
              <Button variant="ghost" onClick={() => setManual(!manual)} disabled={!!busy}>{manual ? "Tengo el código del plugin" : "Conectar sin el plugin (con las llaves)"}</Button>
            </div>
          </>
        )}

        {st.connected && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} hint="Vacío: últimos 30 días." />
              <Button icon={RefreshCw} onClick={sync} disabled={!!busy}>{busy === "sync" ? "Sincronizando…" : "Sincronizar pedidos"}</Button>
              {editable && <Button variant="ghost" icon={Unplug} onClick={disconnect} disabled={!!busy}>Desconectar</Button>}
              <span className="text-xs text-muted">{st.last_sync_at ? `Última sincronización: ${new Date(st.last_sync_at).toLocaleString("es-CL")}` : "Aún no sincronizas."}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              {editable && <Checkbox label="Anotar en el pedido de la tienda el número de la venta de NÚCLEO" checked={st.write_back} onChange={setWriteBack} />}
              <span className="text-xs text-muted">{st.url} · llave {st.key_hint}{st.plugin_version ? ` · plugin NÚCLEO ERP ${st.plugin_version}` : " · sin el plugin NÚCLEO ERP"}</span>
            </div>
            {!st.plugin_version && (
              <Notice tone="info" title="Con el plugin NÚCLEO ERP en la tienda">
                Cada pedido muestra la venta de NÚCLEO y, si quieres, el checkout pide boleta o factura con RUT, razón social y giro, que llegan listos para facturar.
              </Notice>
            )}
            {pending.length > 0 && (
              <Notice tone="warning" title={`Para revisar (${pending.length})`}>
                <ul className="flex flex-col gap-2">
                  {pending.slice(0, 20).map((o) => (
                    <li key={o.order_id} className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">#{o.number}</span><span>{o.issue}</span></li>
                  ))}
                </ul>
              </Notice>
            )}
            {report && report.messages.some((m) => !pending.some((o) => m.includes(`#${o.number}:`))) && (
              <Notice tone="info" title="Mensajes de la sincronización">
                <ul className="list-disc pl-5">{report.messages.slice(0, 12).map((m) => <li key={m}>{m}</li>)}</ul>
              </Notice>
            )}
            <DataTable
              label="Pedidos de la tienda"
              columns={columns}
              rows={orders}
              rowKey={(o) => o.order_id}
              maxHeight="26rem"
              onOpen={(o) => o.sale_uid && navigate(`/ventas/${o.sale_uid}`)}
              empty="Aún no hay pedidos. Presiona «Sincronizar pedidos»."
            />
            <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="text-sm font-medium text-ink">Equivalencias de productos</div>
              <p className="text-sm text-muted">
                Si la tienda no usa códigos (SKU), o vende combos y packs, enlaza cada producto de la tienda con el de NÚCLEO. Sin ese enlace el pedido queda como borrador por revisar y no descuenta stock.
              </p>
              <div><Button variant="secondary" icon={PackageCheck} onClick={() => setEquiv(true)} disabled={!!busy}>Revisar equivalencias</Button></div>
            </div>
            {editable && (
              <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium text-ink">De NÚCLEO a la tienda</div>
                <p className="text-sm text-muted">
                  Calza los productos por código (SKU). Primero ves qué cambiaría; nada se envía hasta que lo confirmes. El stock que se informa es el disponible: lo que hay en bodega menos lo reservado por despachar.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon={PackageCheck} onClick={() => preview(true, false)} disabled={!!busy}>{busy === "stock" ? "Comparando…" : "Revisar stock"}</Button>
                  <Button variant="secondary" icon={Tag} onClick={() => preview(false, true)} disabled={!!busy}>{busy === "prices" ? "Comparando…" : "Revisar precios"}</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <WooEquivalences open={equiv} onClose={() => setEquiv(false)} editable={editable} />
      <Dialog
        open={!!push}
        onClose={() => setPush(null)}
        size="lg"
        title={push?.prices ? "Precios: NÚCLEO → tienda" : "Stock: NÚCLEO → tienda"}
        footer={push && (
          <>
            <Button variant="ghost" onClick={() => setPush(null)}>Cancelar</Button>
            {/* Cambia lo que ve el público en la tienda: lo confirma la persona. */}
            <span data-agent-human>
              <Button onClick={applyPush} disabled={!!busy || push.report.changes.length === 0}>
                {busy === "apply" ? "Enviando…" : `Enviar ${push.report.changes.length} ${push.report.changes.length === 1 ? "cambio" : "cambios"} a la tienda`}
              </Button>
            </span>
          </>
        )}
      >
        {push && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {push.report.matched} productos calzan por código · {push.report.not_in_store} de NÚCLEO no están en la tienda · {push.report.not_in_nucleo} de la tienda no tienen un código que NÚCLEO conozca.
              {push.prices && push.report.prices_with_tax !== null && (push.report.prices_with_tax ? " La tienda escribe sus precios con IVA incluido: se envía el precio de lista más IVA." : " La tienda escribe sus precios sin IVA: se envía el precio de lista neto.")}
            </p>
            {push.prices && push.report.changes.length > 0 && (
              <Notice tone="warning">Estos precios quedan publicados en tu tienda apenas los envíes. Revisa la lista antes de confirmar.</Notice>
            )}
            <DataTable
              label="Cambios"
              columns={changeCols}
              rows={push.report.changes}
              rowKey={(c) => c.sku}
              maxHeight="22rem"
              empty={push.prices ? "Los precios de la tienda ya son iguales a los de NÚCLEO." : "El stock de la tienda ya es igual al de NÚCLEO."}
            />
          </div>
        )}
      </Dialog>
    </Card>
  );
}

function Change({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="text-muted line-through">{from}</span>
      <ArrowRight size={12} className="text-muted" aria-hidden />
      <strong>{to}</strong>
    </span>
  );
}
