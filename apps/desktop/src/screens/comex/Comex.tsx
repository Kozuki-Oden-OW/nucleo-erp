// NÚCLEO COMEX: importaciones en curso, calculadoras de importación y exportación, y guía de Incoterms.
import { useEffect, useState } from "react";
import { CalendarClock, FolderPlus, Search, Ship } from "lucide-react";
import { useBackend, errorMessage, type ImportSummary, type ImportView } from "../../data";
import { formatDate, formatMoney } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Segmented, Tabs } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { StageBadge, TRANSPORT } from "./common";
import { ExportCalculator } from "./ExportCalculator";
import { ImportCalculator } from "./ImportCalculator";
import { IncotermsGuide } from "./Incoterms";

type Tab = "importaciones" | "calculadora" | "exportacion" | "incoterms";

export function Comex({ route }: { route: Route }) {
  const { can } = useSession();
  const tab = (route.query.get("tab") as Tab) || "importaciones";
  const setTab = (x: Tab) => navigate(x === "importaciones" ? "/comex" : `/comex?tab=${x}`, { replace: true });
  return (
    <div className="anim-in">
      <PageHeader
        title="Comercio exterior"
        subtitle="Tus importaciones de punta a punta: etapas, fecha de llegada, costos reales y el costo de cada producto puesto en tu bodega."
        actions={can("comex.editar") && <Button icon={FolderPlus} onClick={() => navigate("/comex/importacion/nueva")}>Nueva importación</Button>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "importaciones", label: "Importaciones" },
        { value: "calculadora", label: "Calculadora de importación" },
        { value: "exportacion", label: "Exportación" },
        { value: "incoterms", label: "Incoterms" },
      ]} />
      <div className="mt-5">
        {tab === "importaciones" && <ImportsTab />}
        {tab === "calculadora" && <ImportCalculator />}
        {tab === "exportacion" && <ExportCalculator />}
        {tab === "incoterms" && <IncotermsGuide />}
      </div>
    </div>
  );
}

function ImportsTab() {
  const backend = useBackend();
  const { can } = useSession();
  const [view, setView] = useState<ImportView>("en_curso");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ImportSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tm = setTimeout(() => { backend.listImports(view, query).then((r) => alive && setRows(r)).catch((e) => alive && setErr(errorMessage(e))); }, 90);
    return () => { alive = false; clearTimeout(tm); };
  }, [backend, view, query]);

  const cols: Column<ImportSummary>[] = [
    { key: "n", header: "Carpeta", width: "8.5rem", render: (r) => <span className="font-mono text-[13px] font-medium">{r.number}</span> },
    { key: "p", header: "Proveedor", render: (r) => <span className="truncate text-ink">{r.supplier_name ?? <span className="text-muted">Sin proveedor</span>}</span> },
    { key: "t", header: "Vía", width: "9.5rem", render: (r) => {
      if (!r.transport_mode) return <span className="text-muted">—</span>;
      const T = TRANSPORT[r.transport_mode];
      return <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-muted"><T.icon size={14} className="shrink-0" aria-hidden />{T.label}{r.incoterm && ` · ${r.incoterm}`}</span>;
    } },
    { key: "e", header: "Etapa", width: "9.5rem", render: (r) => <StageBadge stage={r.stage} /> },
    { key: "a", header: "Llega", width: "9.5rem", render: (r) => r.eta ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="num text-muted">{formatDate(r.eta)}</span>
        {r.eta_changes > 0 && <Badge tone={r.eta_shift_days > 0 ? "warning" : "neutral"} icon={CalendarClock}>{r.eta_shift_days > 0 ? `+${r.eta_shift_days} d` : `${r.eta_changes}×`}</Badge>}
      </span>
    ) : <span className="text-muted">—</span> },
    { key: "f", header: "Mercadería", width: "8.5rem", align: "right", render: (r) => <span className="num text-muted">{r.fob_minor !== null ? formatMoney(r.fob_minor, r.currency_code) : "—"}</span> },
    { key: "c", header: "En bodega", width: "8.5rem", align: "right", render: (r) => {
      const v = r.landed_total_clp ?? r.estimated_landed_clp;
      return v === null ? <span className="text-muted">—</span> : <span className="num font-medium">{formatMoney(v)}{r.landed_total_clp === null && <span className="ml-1 text-xs font-normal text-muted">est.</span>}</span>;
    } },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Field aria-label="Buscar importaciones" leading={<Search size={15} />} placeholder="Número, proveedor o producto" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full max-w-md" />
        <Segmented label="Mostrar" value={view} onChange={setView} options={[
          { value: "en_curso", label: "En curso" }, { value: "cotizaciones", label: "Cotizaciones" }, { value: "cerradas", label: "Cerradas" }, { value: "todas", label: "Todas" },
        ]} />
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      <DataTable label="Importaciones" columns={cols} rows={rows ?? []} rowKey={(r) => r.uid} onOpen={(r) => navigate(`/comex/importacion/${r.uid}`)}
        empty={<EmptyState icon={Ship} title={query ? "Sin coincidencias" : view === "en_curso" ? "No hay importaciones en curso" : "Sin importaciones aquí"}
          action={can("comex.editar") && !query && <Button icon={FolderPlus} onClick={() => navigate("/comex/importacion/nueva")}>Crear una importación</Button>}>
          Registra cada compra al extranjero como una carpeta: sigue sus etapas y su fecha de llegada, y NÚCLEO calcula cuánto te cuesta cada producto en tu bodega.
        </EmptyState>} />
      <Notice tone="info" title="Cálculos referenciales">
        NÚCLEO no inventa aranceles ni tasas: los ingresas tú según tu agente de aduana. Los montos reales de la declaración (derechos e IVA) reemplazan al cálculo.
        Los casos de prueba de estos cálculos están pendientes de revisión por un contador.
      </Notice>
    </div>
  );
}
