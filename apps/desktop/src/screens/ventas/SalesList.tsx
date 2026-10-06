import { useEffect, useState } from "react";
import { FilePlus2, FileText, Plus, Search, ShoppingBag } from "lucide-react";
import { useBackend, errorMessage, type QuoteSummary, type SaleFilter, type SaleSummary } from "../../data";
import { formatDate, formatMoney } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { QuoteStatusBadge, SaleStatus } from "../../ui/doc";
import { Button, EmptyState, Field, Notice, PageHeader, Tabs } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";

type Tab = "ventas" | "cotizaciones" | "pendientes_doc" | "por_cobrar" | "borradores";

const VIEW: Record<Exclude<Tab, "cotizaciones">, SaleFilter["view"]> = {
  ventas: "todas", pendientes_doc: "pendientes_doc", por_cobrar: "por_cobrar", borradores: "borradores",
};

export function SalesList({ route }: { route: Route }) {
  const backend = useBackend();
  const tab = (route.query.get("tab") as Tab) || "ventas";
  const [query, setQuery] = useState("");
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [counts, setCounts] = useState<{ pend: number; cobrar: number }>({ pend: 0, cobrar: 0 });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (tab === "cotizaciones") backend.listQuotes(query).then((r) => alive && setQuotes(r)).catch((e) => setErr(errorMessage(e)));
      else backend.listSales({ query, view: VIEW[tab] }).then((r) => alive && setSales(r)).catch((e) => setErr(errorMessage(e)));
    }, 100);
    return () => { alive = false; clearTimeout(t); };
  }, [backend, tab, query]);

  useEffect(() => {
    Promise.all([backend.listSales({ view: "pendientes_doc" }), backend.listSales({ view: "por_cobrar" })])
      .then(([p, c]) => setCounts({ pend: p.length, cobrar: c.length }))
      .catch(() => {});
  }, [backend, route.raw]);

  const setTab = (t: Tab) => navigate(t === "ventas" ? "/ventas" : `/ventas?tab=${t}`, { replace: true });

  const saleCols: Column<SaleSummary>[] = [
    { key: "n", header: "Número", width: "9.5rem", render: (s) => <span className="font-mono text-[13px] font-medium">{s.number}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (s) => <span className="num text-muted">{formatDate(s.issue_date)}</span> },
    { key: "c", header: "Cliente", render: (s) => s.customer_name },
    { key: "e", header: "Estado", width: "minmax(11rem,16rem)", render: (s) => <SaleStatus s={s} compact /> },
    { key: "t", header: "Total", width: "8.5rem", align: "right", render: (s) => <span className="num font-medium">{formatMoney(s.total_minor)}</span> },
    { key: "s", header: "Saldo", width: "8rem", align: "right", render: (s) => {
      const due = s.commercial_state === "efectuada" || s.commercial_state === "cerrada" ? s.total_minor - s.paid_minor : 0;
      return <span className={due > 0 ? "num text-warning" : "num text-faint"}>{due > 0 ? formatMoney(due) : "—"}</span>;
    } },
  ];
  const quoteCols: Column<QuoteSummary>[] = [
    { key: "n", header: "Número", width: "9.5rem", render: (q) => <span className="font-mono text-[13px] font-medium">{q.number}</span> },
    { key: "f", header: "Fecha", width: "7rem", render: (q) => <span className="num text-muted">{formatDate(q.issue_date)}</span> },
    { key: "c", header: "Cliente", render: (q) => q.customer_name },
    { key: "v", header: "Válida hasta", width: "8rem", render: (q) => <span className="num text-muted">{formatDate(q.valid_until)}</span> },
    { key: "e", header: "Estado", width: "11rem", render: (q) => <QuoteStatusBadge status={q.status} /> },
    { key: "t", header: "Total", width: "8.5rem", align: "right", render: (q) => <span className="num font-medium">{formatMoney(q.total_minor)}</span> },
  ];

  return (
    <div className="anim-in">
      <PageHeader
        title="Vender"
        subtitle="Cotizaciones, ventas y facturas internas. Ninguno de estos documentos es tributario."
        actions={
          <>
            <Button icon={Plus} onClick={() => navigate("/ventas/nueva")} kbd="Alt N">Nueva venta</Button>
            <Button variant="secondary" icon={FilePlus2} onClick={() => navigate("/cotizaciones/nueva")}>Nueva cotización</Button>
            <Button variant="ghost" icon={FileText} onClick={() => navigate("/ventas/nueva?tipo=FV")}>Factura interna</Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "ventas", label: "Ventas" },
          { value: "cotizaciones", label: "Cotizaciones" },
          { value: "por_cobrar", label: "Por cobrar", count: counts.cobrar },
          { value: "pendientes_doc", label: "Pendientes de documentación", count: counts.pend },
          { value: "borradores", label: "Borradores" },
        ]}
      />
      <div className="my-4 flex items-center gap-3">
        <Field
          aria-label="Buscar"
          leading={<Search size={15} />}
          placeholder={tab === "cotizaciones" ? "Buscar por número o cliente" : "Buscar por número o cliente (ej. VEN-000012, Pérez)"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md"
        />
      </div>
      {tab === "pendientes_doc" && (
        <div className="mb-4">
          <Notice tone="warning" icon={FileText} title="Ventas que todavía no anotas como documentadas">
            NÚCLEO no emite documentos tributarios. Cuando emitas la factura o boleta en el sistema oficial, abre la venta y usa
            “Marcar como documentada” para anotar su número (opcional).
          </Notice>
        </div>
      )}
      {err && <Notice tone="danger">{err}</Notice>}
      {tab === "cotizaciones" ? (
        <DataTable
          label="Cotizaciones"
          columns={quoteCols}
          rows={quotes ?? []}
          rowKey={(q) => q.uid}
          onOpen={(q) => navigate(`/cotizaciones/${q.uid}`)}
          empty={<EmptyState icon={FileText} title="Sin cotizaciones" action={<Button icon={Plus} onClick={() => navigate("/cotizaciones/nueva")}>Crear la primera</Button>} />}
        />
      ) : (
        <DataTable
          label="Ventas"
          columns={saleCols}
          rows={sales ?? []}
          rowKey={(s) => s.uid}
          onOpen={(s) => navigate(`/ventas/${s.uid}`)}
          empty={<EmptyState icon={ShoppingBag} title={tab === "pendientes_doc" ? "Nada pendiente de documentación" : "Sin ventas en esta vista"} />}
        />
      )}
    </div>
  );
}
