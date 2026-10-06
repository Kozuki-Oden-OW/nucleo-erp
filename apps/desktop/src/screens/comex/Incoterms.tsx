// Guía de Incoterms: quién entrega dónde, cuándo pasa el riesgo y qué costos agrega el importador.
import { useEffect, useState } from "react";
import { useBackend, errorMessage, type IncotermDef } from "../../data";
import { COST_LABEL, type CostKind } from "../../data/comex";
import { Badge, Card, cx, Notice, Spinner } from "../../ui/kit";

const GROUP: Record<string, string> = { E: "Salida", F: "Transporte principal no pagado", C: "Transporte principal pagado", D: "Llegada" };

export function IncotermsGuide() {
  const backend = useBackend();
  const [rows, setRows] = useState<IncotermDef[] | null>(null);
  const [sel, setSel] = useState("FOB");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { backend.incoterms().then(setRows).catch((e) => setErr(errorMessage(e))); }, [backend]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;
  const cur = rows.find((r) => r.code === sel) ?? rows[0];
  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <nav aria-label="Incoterms" className="flex flex-col gap-1">
        {(["E", "F", "C", "D"] as const).map((g) => (
          <div key={g} className="mb-2">
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g} · {GROUP[g]}</div>
            {rows.filter((r) => r.content.grupo === g).map((r) => (
              <button key={r.code} onClick={() => setSel(r.code)} aria-current={r.code === cur?.code}
                className={cx("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm", r.code === cur?.code ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2")}>
                <span className="w-10 font-mono font-semibold">{r.code}</span><span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      {cur && (
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={<span className="flex flex-wrap items-center gap-3">{cur.code} · {cur.name}<Badge>{cur.version}</Badge><Badge tone="info">{cur.content.transporte === "maritimo" ? "Solo marítimo" : "Cualquier transporte"}</Badge></span>}>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Entrega</dt><dd className="mt-1 text-ink">{cur.content.entrega}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Riesgo</dt><dd className="mt-1 text-ink">{cur.content.riesgo}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Paga el vendedor</dt><dd className="mt-1"><ul className="list-disc pl-5 text-ink">{cur.content.vendedor.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Paga el comprador</dt><dd className="mt-1"><ul className="list-disc pl-5 text-ink">{cur.content.comprador.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
            </dl>
          </Card>
          <Card title="Si importas con este Incoterm">
            <p className="text-sm text-ink">{cur.content.nota}</p>
            {cur.content.agregar.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">{cur.content.agregar.map((k) => <Badge key={k} tone="accent">Agregar: {COST_LABEL[k as CostKind] ?? k}</Badge>)}</div>
            )}
          </Card>
          <p className="text-xs text-muted">{cur.source}</p>
        </div>
      )}
    </div>
  );
}
