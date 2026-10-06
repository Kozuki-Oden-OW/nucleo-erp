// Comprar: órdenes de compra, documentos de compra del proveedor, lo que debes y proveedores.
import { useEffect, useState } from "react";
import { FilePlus2, Plus, Search, ShoppingCart, Truck, UserPlus } from "lucide-react";
import { useBackend, errorMessage, type PurchaseOrderSummary, type PurchaseSummary, type Supplier } from "../../data";
import { formatDate, formatMoney, formatRut } from "../../lib/format";
import { useTerm } from "../../lib/glosario";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Button, EmptyState, Field, Notice, PageHeader, Tabs } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { PoStatusBadge, PurchaseStatusBadge, SupplierDrawer, SupplierFormDrawer } from "./common";

type Tab = "ordenes" | "documentos" | "por_pagar" | "proveedores";

export function Purchases({ route }: { route: Route }) {
  const backend = useBackend();
  const { can } = useSession();
  const t = useTerm();
  const tab = (route.query.get("tab") as Tab) || "ordenes";
  const viewing = route.query.get("ver");
  const creatingSupplier = route.query.get("nuevo_proveedor") === "1";
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<PurchaseOrderSummary[] | null>(null);
  const [docs, setDocs] = useState<PurchaseSummary[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [payableCount, setPayableCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    const tm = setTimeout(() => {
      const fail = (e: unknown) => alive && setErr(errorMessage(e));
      if (tab === "ordenes") backend.listPurchaseOrders(query).then((r) => alive && setOrders(r)).catch(fail);
      else if (tab === "proveedores") backend.searchSuppliers(query).then((r) => alive && setSuppliers(r)).catch(fail);
      else backend.listPurchases({ query, view: tab === "por_pagar" ? "por_pagar" : "todas" }).then((r) => alive && setDocs(r)).catch(fail);
    }, 90);
    return () => { alive = false; clearTimeout(tm); };
  }, [backend, tab, query, version]);
  useEffect(() => { backend.listPurchases({ view: "por_pagar" }).then((r) => setPayableCount(r.length)).catch(() => {}); }, [backend, version]);

  const setTab = (x: Tab) => { setQuery(""); navigate(x === "ordenes" ? "/compras" : `/compras?tab=${x}`, { replace: true }); };

  const poCols: Column<PurchaseOrderSummary>[] = [
    { key: "n", header: "Número", width: "9rem", render: (o) => <span className="font-mono text-[13px] font-medium">{o.number}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (o) => <span className="num text-muted">{formatDate(o.issue_date)}</span> },
    { key: "p", header: "Proveedor", render: (o) => <span className="text-ink">{o.supplier_name}</span> },
    { key: "l", header: "Llega", width: "7rem", render: (o) => <span className="num text-muted">{formatDate(o.expected_date)}</span> },
    { key: "e", header: "Estado", width: "12rem", render: (o) => <PoStatusBadge status={o.status} /> },
    { key: "t", header: "Total", width: "8.5rem", align: "right", render: (o) => <span className="num font-medium">{formatMoney(o.total_minor)}</span> },
  ];
  const docCols: Column<PurchaseSummary>[] = [
    { key: "n", header: "Registro", width: "8.5rem", render: (c) => <span className="font-mono text-[13px] font-medium">{c.number}</span> },
    { key: "d", header: "Documento", width: "10rem", render: (c) => <span className="text-muted">{[c.doc_kind, c.doc_number].filter(Boolean).join(" ") || "—"}</span> },
    { key: "p", header: "Proveedor", render: (c) => <span className="text-ink">{c.supplier_name}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (c) => <span className="num text-muted">{formatDate(c.issue_date)}</span> },
    { key: "v", header: "Vence", width: "7rem", render: (c) => <span className="num text-muted">{c.payment_state === "pagada" ? "—" : formatDate(c.due_date)}</span> },
    { key: "e", header: "Estado", width: "10rem", render: (c) => <PurchaseStatusBadge c={c} /> },
    { key: "s", header: tab === "por_pagar" ? "Saldo" : "Total", width: "8.5rem", align: "right", render: (c) => <span className="num font-medium">{formatMoney(tab === "por_pagar" ? c.total_minor - c.paid_minor : c.total_minor)}</span> },
  ];
  const supCols: Column<Supplier>[] = [
    { key: "n", header: "Proveedor", render: (s) => <span className="font-medium text-ink">{s.name}</span> },
    { key: "r", header: "RUT", width: "9.5rem", render: (s) => <span className="num">{formatRut(s.rut)}</span> },
    { key: "t", header: "Plazo", width: "7rem", render: (s) => <span className="text-muted">{s.payment_terms_days ? `${s.payment_terms_days} días` : "Contado"}</span> },
    { key: "c", header: "Contacto", render: (s) => <span className="text-muted">{[s.email, s.phone].filter(Boolean).join(" · ") || "—"}</span> },
  ];
  const payableTotal = tab === "por_pagar" && docs ? docs.reduce((a, c) => a + c.total_minor - c.paid_minor, 0) : 0;

  return (
    <div className="anim-in">
      <PageHeader
        title="Comprar"
        subtitle="Órdenes a tus proveedores, recepción de mercadería y sus facturas. Al recibir, el stock y el costo promedio se actualizan solos."
        actions={
          <>
            {tab === "proveedores" && can("proveedores.editar") && <Button variant="secondary" icon={UserPlus} onClick={() => navigate("/compras?tab=proveedores&nuevo_proveedor=1")}>Nuevo proveedor</Button>}
            {can("compras.crear") && <Button variant="secondary" icon={FilePlus2} onClick={() => navigate("/compras/doc/nueva")}>Registrar documento</Button>}
            {can("compras.crear") && <Button icon={ShoppingCart} onClick={() => navigate("/compras/oc/nueva")}>Nueva orden de compra</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "ordenes", label: "Órdenes de compra" },
          { value: "documentos", label: "Documentos de compra" },
          { value: "por_pagar", label: t("por_pagar"), count: payableCount ?? undefined },
          { value: "proveedores", label: "Proveedores" },
        ]}
      />
      <div className="my-4 flex flex-wrap items-center gap-4">
        <Field aria-label="Buscar" leading={<Search size={15} />} placeholder={tab === "proveedores" ? "Nombre o RUT del proveedor" : "Número, proveedor o documento"} value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-md" />
        {tab === "por_pagar" && docs && docs.length > 0 && <span className="text-sm text-muted">Total por pagar: <strong className="num text-ink">{formatMoney(payableTotal)}</strong></span>}
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      {tab === "ordenes" && (
        <DataTable label="Órdenes de compra" columns={poCols} rows={orders ?? []} rowKey={(o) => o.uid} onOpen={(o) => navigate(`/compras/oc/${o.uid}`)}
          empty={<EmptyState icon={ShoppingCart} title="Sin órdenes de compra" action={can("compras.crear") && <Button icon={Plus} onClick={() => navigate("/compras/oc/nueva")}>Crear la primera</Button>}>Pide mercadería a tus proveedores y recíbela parcial o totalmente.</EmptyState>} />
      )}
      {(tab === "documentos" || tab === "por_pagar") && (
        <DataTable label="Documentos de compra" columns={docCols} rows={docs ?? []} rowKey={(c) => c.uid} onOpen={(c) => navigate(`/compras/doc/${c.uid}`)}
          empty={<EmptyState icon={FilePlus2} title={tab === "por_pagar" ? "No le debes nada a tus proveedores" : "Sin documentos de compra"}>Registra aquí las facturas y boletas que te entregan tus proveedores.</EmptyState>} />
      )}
      {tab === "proveedores" && (
        <DataTable label="Proveedores" columns={supCols} rows={suppliers ?? []} rowKey={(s) => s.uid} onOpen={(s) => navigate(`/compras?tab=proveedores&ver=${s.uid}`, { replace: true })}
          empty={<EmptyState icon={Truck} title={query ? "Sin coincidencias" : "Aún no tienes proveedores"} />} />
      )}
      <SupplierFormDrawer open={creatingSupplier} onClose={() => navigate("/compras?tab=proveedores", { replace: true })}
        onSaved={(s) => { setVersion((v) => v + 1); navigate(`/compras?tab=proveedores&ver=${s.uid}`, { replace: true }); }} />
      {viewing && tab === "proveedores" && <SupplierDrawer uid={viewing} onClose={() => navigate("/compras?tab=proveedores", { replace: true })} onChanged={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
