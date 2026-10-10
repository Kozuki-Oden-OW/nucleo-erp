// Contabilidad → Impuestos (Fase 10, hito A): borrador del F29, registro de compras y ventas y
// configuración tributaria. NÚCLEO no declara: prepara el formulario código por código, explica
// cada monto y guarda lo que la persona declaró en sii.cl.
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useBackend, errorMessage, type F29View } from "../../data";
import { navigate, type Route } from "../../lib/router";
import { addDays, todayIso } from "../../lib/format";
import { IconButton, Notice, PageHeader, Spinner, Tabs } from "../../ui/kit";
import { F29Tab } from "./F29Tab";
import { RegistroTab } from "./Registro";
import { PerfilTab } from "./Perfil";

type Tab = "f29" | "registro" | "configuracion";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
export function shiftPeriod(p: string, months: number): string {
  const idx = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1 + months;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
/** Por defecto se prepara el mes anterior (el F29 se declara el mes siguiente). */
const defaultPeriod = () => addDays(todayIso().slice(0, 8) + "01", -1).slice(0, 7);

export function Impuestos({ route }: { route: Route }) {
  const backend = useBackend();
  const tab = (route.query.get("tab") as Tab) || "f29";
  const period = /^\d{4}-\d{2}$/.test(route.query.get("periodo") ?? "") ? route.query.get("periodo")! : defaultPeriod();
  const go = (t: Tab, p = period) => navigate(`/contabilidad?tab=${t}&periodo=${p}`, { replace: true });
  const [view, setView] = useState<F29View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    backend.f29(period).then(setView).catch((e) => setErr(errorMessage(e)));
  }, [backend, period]);
  useEffect(() => { setView(null); load(); }, [load]);

  return (
    <div className="anim-in">
      <PageHeader title="Impuestos"
        subtitle="Prepara tu declaración mensual (F29) con tus ventas, compras e importaciones. NÚCLEO no declara: te deja cada código listo para copiar en sii.cl y te explica de dónde sale." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => go(tab, shiftPeriod(period, -1))} />
        <label className="sr-only" htmlFor="periodo">Período</label>
        <input id="periodo" type="month" value={period} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && go(tab, e.target.value)}
          className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none" />
        <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => go(tab, shiftPeriod(period, 1))} disabled={period >= todayIso().slice(0, 7)} />
        <span className="ml-1 text-sm text-muted">F29 de <strong className="font-medium capitalize text-ink">{periodLabel(period)}</strong></span>
      </div>
      <Tabs value={tab} onChange={(t) => go(t)} tabs={[
        { value: "f29", label: "Formulario 29" },
        { value: "registro", label: "Compras y ventas del mes", count: view?.docs.length },
        { value: "configuracion", label: "Configuración tributaria" },
      ]} />
      <div className="mt-5">
        {err && <Notice tone="danger">{err}</Notice>}
        {tab === "configuracion" ? <PerfilTab onSaved={load} />
          : !view ? (!err && <Spinner />)
          : tab === "registro" ? <RegistroTab view={view} onView={setView} />
          : <F29Tab view={view} onView={setView} onGoRegistro={() => go("registro")} onGoConfig={() => go("configuracion")} />}
      </div>
    </div>
  );
}
