import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Bell, HandCoins, Info, Receipt, RefreshCw, ShoppingBag, Wallet } from "lucide-react";
import { useBackend, type Dashboard } from "../../data";
import { formatDayShort, formatMoney } from "../../lib/format";
import { useSession } from "../../lib/session";
import { cx } from "../../ui/kit";
import { Loading, useNav } from "../MobileApp";
import { sinceText, useOutbox } from "../outbox";
import { Panel, Row, Section } from "../ui";
import simbolo from "../../assets/simbolo.png";

export function Home({ business, demo }: { business: string; demo: boolean }) {
  const backend = useBackend();
  const { can } = useSession();
  const nav = useNav();
  const box = useOutbox();
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => { backend.dashboard().then(setD).catch(() => {}); }, [backend]);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <>
      <div className="pt-safe m-hero">
        <div className="px-4 pb-6 pt-4">
          <div className="flex items-center gap-2.5">
            <img src={simbolo} alt="" className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-white/70">{hello}</div>
              <div className="truncate text-[17px] font-semibold">{business}</div>
            </div>
            <button onClick={() => nav.open({ name: "sincronizar" })}
              className="m-press flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: "rgb(255 255 255 / 0.12)" }}>
              <RefreshCw size={14} />
              {box.items.length ? `${box.items.length} por enviar` : demo && !box.lastSync ? "Demostración" : `Sincronizado ${sinceText(box.lastSync)}`}
            </button>
          </div>
          <div className="mt-5">
            <div className="text-[13px] text-white/70">Vendiste hoy</div>
            <div className="num text-[34px] font-bold leading-tight">{d ? formatMoney(d.today_sales_minor) : "—"}</div>
            {d && <div className="text-[13px] text-white/70">{d.today_sales_count} {d.today_sales_count === 1 ? "venta" : "ventas"} · este mes {formatMoney(d.month_sales_minor)}</div>}
          </div>
        </div>
      </div>

      {!d ? <Loading /> : (
        <>
          <div className="-mt-3 grid grid-cols-2 gap-2.5 px-4">
            <Tile icon={Wallet} label="Disponible" value={d.cash_minor} />
            {can("dinero.ver") && <Tile icon={ArrowDownLeft} label="Te deben" value={d.receivable_minor} warn={d.receivable_overdue_minor > 0 ? `${formatMoney(d.receivable_overdue_minor)} atrasado` : undefined} />}
            {can("dinero.ver") && <Tile icon={ArrowUpRight} label="Debes" value={d.payable_minor} />}
            {d.tax_estimate_minor !== null && <Tile icon={Receipt} label="IVA estimado" value={d.tax_estimate_minor} />}
          </div>

          <Section title="Hacer ahora">
            <div className="grid grid-cols-3 gap-2.5">
              <Action icon={ShoppingBag} label="Venta rápida" onClick={() => nav.setTab("vender")} />
              <Action icon={Receipt} label="Gasto" onClick={() => nav.open({ name: "gasto" })} />
              <Action icon={HandCoins} label="Cobro" onClick={() => nav.open({ name: "cobro" })} />
            </div>
          </Section>

          {d.alerts.length > 0 && (
            <Section title="Requiere tu atención">
              <Panel>
                {d.alerts.slice(0, 4).map((a) => (
                  <Row key={a.kind} icon={a.severity === "alta" ? AlertTriangle : a.severity === "media" ? Bell : Info}
                    tone={a.severity === "alta" ? "danger" : a.severity === "media" ? "warning" : "accent"} title={a.title} sub={a.detail} />
                ))}
              </Panel>
            </Section>
          )}

          {d.upcoming_payments.length > 0 && (
            <Section title="Próximos cobros y pagos">
              <Panel>
                {d.upcoming_payments.slice(0, 5).map((u, i) => (
                  <Row key={i} title={u.label} sub={formatDayShort(u.date)}
                    right={<span className={cx("num text-[15px] font-semibold", u.kind === "cobro" ? "text-success" : "text-ink")}>{u.kind === "cobro" ? "+" : "−"}{formatMoney(u.amount_minor)}</span>} />
                ))}
              </Panel>
            </Section>
          )}

          {d.low_stock.length > 0 && (
            <Section title="Poco stock" action={<button onClick={() => nav.setTab("stock")} className="text-[14px] font-medium text-accent">Ver stock</button>}>
              <Panel>
                {d.low_stock.slice(0, 4).map((p) => (
                  <Row key={p.uid} title={p.name} sub={`Mínimo ${p.min_milli / 1000}`} right={<span className="num text-[15px] font-semibold text-warning">{p.on_hand_milli / 1000}</span>} />
                ))}
              </Panel>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function Tile({ icon: Icon, label, value, warn }: { icon: typeof Wallet; label: string; value: number; warn?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-center gap-1.5 text-[13px] text-muted"><Icon size={15} />{label}</div>
      <div className="num mt-1 text-[19px] font-bold text-ink">{formatMoney(value)}</div>
      {warn && <div className="mt-0.5 truncate text-[12px] font-medium text-warning">{warn}</div>}
    </div>
  );
}

function Action({ icon: Icon, label, onClick }: { icon: typeof Wallet; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="m-press flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-2 py-4 shadow-card">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent"><Icon size={22} /></span>
      <span className="text-[14px] font-medium text-ink">{label}</span>
    </button>
  );
}
