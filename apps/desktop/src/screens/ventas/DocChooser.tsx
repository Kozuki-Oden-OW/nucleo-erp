// «Nueva venta» empieza por el documento: boleta, factura, guía de despacho o nota de crédito.
// Cada uno abre el formulario con los mismos bloques que el facturador del SII.
import { useEffect, useState } from "react";
import { ArrowLeft, FileMinus2, FileText, Receipt, Search, Truck, type LucideIcon } from "lucide-react";
import { useBackend, errorMessage, type SaleSummary } from "../../data";
import { DOCUMENTS } from "../../data/saleTerms";
import { formatDate, formatMoney } from "../../lib/format";
import { goBack, navigate } from "../../lib/router";
import { Button, Field, Notice, PageHeader } from "../../ui/kit";

const ICONS: Record<string, LucideIcon> = { boleta: Receipt, factura: FileText, guia: Truck };
const KEYS: Record<string, string> = { b: "boleta", f: "factura", g: "guia" };

function Option({ icon: Icon, title, hint, kbd, onClick }: { icon: LucideIcon; title: string; hint: string; kbd: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="group flex min-h-[9.5rem] flex-col items-start gap-2 rounded-xl border border-line bg-surface p-5 text-left transition-colors hover:border-accent hover:bg-accent-soft focus:border-accent focus:outline-none">
      <span className="flex w-full items-center justify-between">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-ink group-hover:bg-surface"><Icon size={20} aria-hidden /></span>
        <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">{kbd}</kbd>
      </span>
      <span className="text-base font-semibold text-ink">{title}</span>
      <span className="text-sm text-muted">{hint}</span>
    </button>
  );
}

export function DocChooser({ customerUid }: { customerUid?: string | null }) {
  const backend = useBackend();
  const [credit, setCredit] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SaleSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = (doc: string) => navigate(`/ventas/nueva?doc=${doc}${customerUid ? `&cliente=${customerUid}` : ""}`, { replace: true });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (KEYS[k]) { e.preventDefault(); open(KEYS[k]!); } else if (k === "n") { e.preventDefault(); setCredit(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  useEffect(() => {
    if (!credit) return;
    let alive = true;
    const t = setTimeout(() => {
      backend.listSales({ view: "todas", query }).then((r) => { if (alive) setRows(r.filter((s) => s.commercial_state === "efectuada" || s.commercial_state === "cerrada").slice(0, 12)); })
        .catch((e) => setErr(errorMessage(e)));
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [backend, credit, query]);

  return (
    <div className="anim-in">
      <PageHeader
        back={<button onClick={() => goBack("/ventas")} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Volver</button>}
        title="Nueva venta"
        subtitle="Primero elige el documento. El formulario trae los mismos datos y el mismo orden que el del SII, para que al emitirlo no falte nada."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {DOCUMENTS.map((d) => (
          <Option key={d.value} icon={ICONS[d.value]!} title={d.label} hint={d.hint} kbd={d.value[0]!.toUpperCase()} onClick={() => open(d.value)} />
        ))}
        <Option icon={FileMinus2} title="Nota de crédito" hint="Anula una factura o boleta ya emitida. Se elige el documento que corrige." kbd="N" onClick={() => setCredit(true)} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => open("ninguno")}>Venta sin documento</Button>
        <Button variant="ghost" onClick={() => navigate(`/ventas/nueva?tipo=FV${customerUid ? `&cliente=${customerUid}` : ""}`, { replace: true })}>Factura interna</Button>
        <Button variant="ghost" onClick={() => navigate(`/cotizaciones/nueva${customerUid ? `?cliente=${customerUid}` : ""}`, { replace: true })}>Cotización</Button>
      </div>
      {credit && (
        <div className="mt-6 max-w-3xl rounded-xl border border-line bg-surface p-5">
          <h2 className="text-base font-semibold text-ink">¿Qué venta anula la nota de crédito?</h2>
          <p className="mt-1 text-sm text-muted">
            Busca la venta por número, folio o cliente. NÚCLEO la anula con su motivo, devuelve el stock y deja anotado el folio de la nota de crédito.
            Las notas que solo corrigen montos o texto se emiten en el SII y se anotan en las observaciones de la venta.
          </p>
          <Field aria-label="Buscar la venta" className="mt-3 max-w-md" leading={<Search size={15} />} placeholder="Ej. FV-000025, 537 o Asurity" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
          {rows && rows.length === 0 && <p className="mt-3 text-sm text-muted">Sin ventas efectuadas que coincidan.</p>}
          {rows && rows.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {rows.map((s) => (
                <li key={s.uid}>
                  <button onClick={() => navigate(`/ventas/${s.uid}?nc=1`)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                    <span className="font-mono text-[13px]">{s.number}</span>
                    <span className="num text-muted">{formatDate(s.issue_date)}</span>
                    <span className="min-w-0 flex-1 truncate">{s.customer_name}</span>
                    <span className="num font-medium">{formatMoney(s.total_minor)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
