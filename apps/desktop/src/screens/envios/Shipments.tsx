// Envíos: agencia, número de orden de transporte o seguimiento, destinatario, dirección, fechas y
// estado con color (no despachado y no entregado en rojo, en camino en amarillo, entregado en verde).
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, PackageX, Plus, Search, Truck, XCircle, Clock3 } from "lucide-react";
import { useBackend, errorMessage, type Customer, type Shipment, type ShipmentInput, type ShipmentStatus } from "../../data";
import { REGIONS } from "../../data/lre";
import { formatDate } from "../../lib/format";
import { navigate, type Route } from "../../lib/router";
import { useSession } from "../../lib/session";
import { Badge, Button, EmptyState, Field, Kpi, Notice, PageHeader, Select, Spinner, Tabs, TextArea, cx, type Tone } from "../../ui/kit";
import { Drawer, useToast } from "../../ui/overlay";
import { DataTable, type Column } from "../../ui/table";

export const SHIP_STATUS: Record<ShipmentStatus, { tone: Tone; label: string; icon: typeof Truck }> = {
  no_despachado: { tone: "danger", label: "No despachado", icon: PackageX },
  en_camino: { tone: "warning", label: "En camino", icon: Truck },
  entregado: { tone: "success", label: "Entregado", icon: CheckCircle2 },
  no_entregado: { tone: "danger", label: "No entregado (problemas)", icon: XCircle },
};
export const CARRIERS = ["Starken", "Chilexpress", "Correos de Chile", "Blue Express", "Shipit", "99 Minutos", "Envíame", "Despacho propio", "Retiro en tienda"];

export function ShipStatusBadge({ status }: { status: ShipmentStatus }) {
  const s = SHIP_STATUS[status];
  return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>;
}

type Filter = "todos" | ShipmentStatus;

export function Shipments({ route }: { route: Route }) {
  const backend = useBackend();
  const { can } = useSession();
  const [rows, setRows] = useState<Shipment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Shipment | "nuevo" | null>(null);
  const filter = (route.query.get("estado") as Filter) || "todos";
  const load = () => backend.shipments().then(setRows).catch((e) => setErr(errorMessage(e)));
  useEffect(() => { void load(); }, [backend]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const u = route.query.get("ver");
    if (u && rows) { const s = rows.find((x) => x.uid === u); if (s) setEditing(s); }
  }, [route, rows]);
  const count = (s: ShipmentStatus) => rows?.filter((r) => r.status === s).length ?? 0;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return (rows ?? []).filter((r) => (filter === "todos" || r.status === filter)
      && (!q || [r.number, r.tracking, r.carrier, r.first_name, r.last_name, r.customer_name, r.commune, r.sale_number].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)));
  }, [rows, filter, query]);

  const cols: Column<Shipment>[] = [
    { key: "n", header: "Envío", width: "7.5rem", render: (s) => <span className="flex flex-col"><span className="font-mono text-[12.5px]">{s.number}</span>{s.sale_number && <span className="font-mono text-xs text-muted">{s.sale_number}</span>}</span> },
    { key: "d", header: "Destinatario", render: (s) => (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{[s.first_name, s.last_name].filter(Boolean).join(" ") || s.customer_name || "—"}</span>
        <span className="text-xs text-muted">{[s.address, s.commune].filter(Boolean).join(", ") || s.phone || ""}</span>
      </span>
    ) },
    { key: "a", header: "Agencia y seguimiento", render: (s) => <span className="flex flex-col"><span className="text-ink">{s.carrier ?? "—"}</span><span className="font-mono text-xs text-muted">{s.tracking ?? "Sin número"}</span></span> },
    { key: "f", header: "Enviado", width: "6.5rem", render: (s) => <span className="num text-muted">{s.shipped_on ? formatDate(s.shipped_on) : "—"}</span> },
    { key: "r", header: "Recibido", width: "6.5rem", render: (s) => <span className="num text-muted">{s.delivered_on ? formatDate(s.delivered_on) : "—"}</span> },
    { key: "e", header: "Estado", width: "14.5rem", render: (s) => <ShipStatusBadge status={s.status} /> },
  ];

  return (
    <div className="anim-in">
      <PageHeader title="Envíos" subtitle="A quién le enviaste, por qué agencia, con qué número de seguimiento y en qué va cada despacho."
        actions={can("ventas.crear") && <Button icon={Plus} onClick={() => setEditing("nuevo")}>Nuevo envío</Button>} />
      {err && <Notice tone="danger">{err}</Notice>}
      {!rows ? <Spinner /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(Object.keys(SHIP_STATUS) as ShipmentStatus[]).map((k) => (
              <Kpi key={k} label={SHIP_STATUS[k].label} value={String(count(k))} tone={count(k) ? SHIP_STATUS[k].tone : undefined} icon={SHIP_STATUS[k].icon}
                onClick={() => navigate(filter === k ? "/envios" : `/envios?estado=${k}`, { replace: true })} />
            ))}
          </div>
          <Tabs value={filter} onChange={(f) => navigate(f === "todos" ? "/envios" : `/envios?estado=${f}`, { replace: true })}
            tabs={[{ value: "todos", label: "Todos", count: rows.length }, ...(Object.keys(SHIP_STATUS) as ShipmentStatus[]).map((k) => ({ value: k, label: SHIP_STATUS[k].label, count: count(k) }))]} />
          <Field aria-label="Buscar envíos" leading={<Search size={15} />} placeholder="Número, seguimiento, agencia, nombre o comuna" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" />
          <DataTable label="Envíos" columns={cols} rows={shown} rowKey={(s) => s.uid} onOpen={(s) => setEditing(s)}
            empty={<EmptyState icon={Truck} title={rows.length ? "Sin envíos en esta vista" : "Aún no registras envíos"}>Crea uno aquí o desde una venta con «Crear envío».</EmptyState>} />
        </div>
      )}
      {editing && (
        <ShipmentDrawer shipment={editing === "nuevo" ? null : editing} onClose={() => { setEditing(null); if (route.query.get("ver")) navigate("/envios", { replace: true }); }}
          onSaved={() => { setEditing(null); void load(); }} />
      )}
    </div>
  );
}

/** Datos del destinatario a partir del cliente (el nombre de contacto si existe). */
export function recipientFromCustomer(c: Customer | null): Partial<ShipmentInput> {
  if (!c) return {};
  const person = c.contact_name || (c.kind === "persona" ? c.name : "");
  const [first, ...rest] = person.split(" ");
  return { first_name: first || null, last_name: rest.join(" ") || (c.kind === "empresa" ? c.name : null), phone: c.phone, address: c.address, commune: c.commune, city: c.city, region: c.region };
}

export function ShipmentDrawer({ shipment, preset, onClose, onSaved }: {
  shipment: Shipment | null; preset?: ShipmentInput & { sale_number?: string | null }; onClose: () => void; onSaved: (s: Shipment) => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const init: ShipmentInput = shipment ? { ...shipment } : { status: "no_despachado", ...preset };
  const [f, setF] = useState<ShipmentInput>(init);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ShipmentInput>) => setF((x) => ({ ...x, ...patch }));
  const editable = can("ventas.crear");
  const saleNumber = shipment?.sale_number ?? preset?.sale_number;

  async function save() {
    setBusy(true); setErr(null);
    try {
      const s = await backend.saveShipment(shipment?.uid ?? null, f);
      toast("success", shipment ? `${s.number} actualizado.` : `${s.number} creado.`);
      onSaved(s);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} width="w-[min(620px,100vw)]" title={shipment ? `Envío ${shipment.number}` : "Nuevo envío"}
      subtitle={saleNumber ? `Venta ${saleNumber}` : "Puedes registrarlo sin venta (ej. muestras o reposiciones)."}
      footer={editable && <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Truck} onClick={save} disabled={busy}>{busy ? "Guardando…" : shipment ? "Guardar cambios" : "Crear envío"}</Button></>}>
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Estado</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Estado del envío">
            {(Object.keys(SHIP_STATUS) as ShipmentStatus[]).map((k) => {
              const s = SHIP_STATUS[k];
              const on = f.status === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} disabled={!editable} onClick={() => set({ status: k })}
                  className={cx("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    on ? (s.tone === "success" ? "border-success bg-success-soft text-success" : s.tone === "warning" ? "border-warning bg-warning-soft text-warning" : "border-danger bg-danger-soft text-danger")
                      : "border-line text-muted hover:text-ink")}>
                  <s.icon size={16} aria-hidden /> {s.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Transporte</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col">
              <Field label="Agencia" optional list="nucleo-agencias" value={f.carrier ?? ""} onChange={(e) => set({ carrier: e.target.value })} placeholder="Ej. Starken" />
              <datalist id="nucleo-agencias">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <Field label="N.º de orden de transporte o seguimiento" optional value={f.tracking ?? ""} onChange={(e) => set({ tracking: e.target.value })}
              suffix={f.tracking ? <button type="button" aria-label="Copiar número" className="text-muted hover:text-ink" onClick={async () => {
                try { await navigator.clipboard.writeText(f.tracking!); toast("success", "Número copiado: pégalo en el sitio de la agencia."); } catch { /* sin portapapeles */ }
              }}><Copy size={14} /></button> : undefined} />
            <Field label="Cuándo se envió" type="date" optional value={f.shipped_on ?? ""} onChange={(e) => set({ shipped_on: e.target.value || null })} hint="Vacío: hoy, al marcarlo en camino." />
            <Field label="Cuándo se recibió" type="date" optional value={f.delivered_on ?? ""} onChange={(e) => set({ delivered_on: e.target.value || null })} hint="Vacío: hoy, al marcarlo entregado." />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Destinatario</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" optional value={f.first_name ?? ""} onChange={(e) => set({ first_name: e.target.value })} />
            <Field label="Apellido" optional value={f.last_name ?? ""} onChange={(e) => set({ last_name: e.target.value })} />
            <Field label="Celular" optional inputMode="tel" value={f.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} placeholder="+56 9 1234 5678" />
          </div>
          <Field label="Dirección" optional value={f.address ?? ""} onChange={(e) => set({ address: e.target.value })} placeholder="Calle, número, depto." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Comuna" optional value={f.commune ?? ""} onChange={(e) => set({ commune: e.target.value })} />
            <Field label="Ciudad" optional value={f.city ?? ""} onChange={(e) => set({ city: e.target.value })} />
            <Select label="Región" optional value={f.region ?? ""} onChange={(e) => set({ region: e.target.value })}
              options={[{ value: "", label: "—" }, ...REGIONS.map(([, n]) => ({ value: n, label: n })), ...(f.region && !REGIONS.some(([, n]) => n === f.region) ? [{ value: f.region, label: f.region }] : [])]} />
          </div>
        </fieldset>
        <TextArea label="Notas" optional rows={2} value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Ej. dejar en conserjería; problema: dirección incompleta…" />
        {shipment?.sale_uid && <Button variant="ghost" icon={Clock3} className="self-start" onClick={() => navigate(`/ventas/${shipment.sale_uid}`)}>Ver la venta {shipment.sale_number}</Button>}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}
