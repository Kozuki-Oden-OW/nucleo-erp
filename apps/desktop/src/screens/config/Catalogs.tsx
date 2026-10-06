// Numeración interna de documentos, monedas y tipos de cambio, y visor de auditoría.
import { useCallback, useEffect, useState } from "react";
import { Hash, Pencil, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useBackend, errorMessage, type AuditRow, type CurrencyRow, type RateRow, type SequenceRow, type SessionInfo } from "../../data";
import { formatDate, todayIso } from "../../lib/format";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Field, Notice, Select, Spinner } from "../../ui/kit";
import { Dialog, useToast } from "../../ui/overlay";

/* ───────────── Numeración ───────────── */

export function NumberingSection() {
  const backend = useBackend();
  const { can } = useSession();
  const [rows, setRows] = useState<SequenceRow[] | null>(null);
  const [editing, setEditing] = useState<SequenceRow | null>(null);
  const load = useCallback(() => { backend.sequences().then(setRows).catch(() => setRows([])); }, [backend]);
  useEffect(load, [load]);
  const sample = (s: Pick<SequenceRow, "prefix" | "width" | "next_number">) => `${s.prefix}-${String(s.next_number).padStart(s.width, "0")}`;
  return (
    <Card title="Numeración de documentos" subtitle="Correlativos internos de NÚCLEO. No son folios tributarios." padded={false}>
      {!rows ? <div className="p-5"><Spinner /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-5 py-2.5">Documento</th><th>Prefijo</th><th>Próximo número</th><th className="text-right">Usados</th><th className="w-24" /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.doc_type} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5">{s.name}</td>
                  <td className="font-mono text-[13px]">{s.prefix}</td>
                  <td className="font-mono text-[13px] font-medium">{sample(s)}</td>
                  <td className="num text-right text-muted">{s.last_used}</td>
                  <td className="pr-3 text-right">{can("config.editar") && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(s)}>Cambiar</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SequenceDialog seq={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} sample={sample} />}
    </Card>
  );
}

function SequenceDialog({ seq, onClose, onSaved, sample }: { seq: SequenceRow; onClose: () => void; onSaved: () => void; sample: (s: Pick<SequenceRow, "prefix" | "width" | "next_number">) => string }) {
  const backend = useBackend();
  const toast = useToast();
  const [prefix, setPrefix] = useState(seq.prefix);
  const [next, setNext] = useState(String(seq.next_number));
  const [width, setWidth] = useState(String(seq.width));
  const [err, setErr] = useState<string | null>(null);
  const n = Number(next) || 0, w = Number(width) || 6;
  async function save() {
    setErr(null);
    try { await backend.updateSequence(seq.doc_type, prefix, n, w); toast("success", "Numeración actualizada."); onSaved(); }
    catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Dialog open onClose={onClose} title={`Numeración: ${seq.name}`} size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Hash} onClick={save}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Prefijo" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={6} data-autofocus />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Próximo número" inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ""))} hint={`Debe ser mayor que ${seq.last_used}`} />
          <Field label="Dígitos" inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value.replace(/\D/g, ""))} hint="Entre 3 y 12" />
        </div>
        <p className="text-sm text-muted">Así se verá el próximo: <span className="font-mono font-semibold text-ink">{sample({ prefix: prefix || "?", width: w, next_number: n })}</span></p>
        <p className="text-xs text-muted">Nunca se puede volver a un número ya usado: así no hay documentos internos repetidos.</p>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

/* ───────────── Monedas ───────────── */

function formatRate(e6: number): string {
  return new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(e6 / 1_000_000);
}

export function CurrenciesSection() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const [rows, setRows] = useState<CurrencyRow[] | null>(null);
  const [cur, setCur] = useState("USD");
  const [history, setHistory] = useState<RateRow[]>([]);
  const [date, setDate] = useState(todayIso());
  const [rate, setRate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.currencies().then(setRows).catch(() => setRows([]));
    backend.rates(cur).then(setHistory).catch(() => setHistory([]));
  }, [backend, cur]);
  useEffect(load, [load]);
  async function save() {
    setErr(null);
    const v = Number(rate.replace(/\./g, "").replace(",", "."));
    if (!(v > 0)) { setErr("Escribe el tipo de cambio, por ejemplo 950,25."); return; }
    try { await backend.setRate(cur, date, Math.round(v * 1_000_000)); toast("success", "Tipo de cambio guardado."); setRate(""); load(); }
    catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <div className="flex flex-col gap-6">
      <Card title="Monedas" subtitle="El peso chileno es la moneda base. NÚCLEO no consulta Internet: los tipos de cambio los anotas tú." padded={false}>
        {!rows ? <div className="p-5"><Spinner /></div> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-muted"><th className="px-5 py-2.5">Moneda</th><th>Símbolo</th><th className="text-right">Último tipo de cambio</th><th className="px-5 text-right">Fecha</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5"><span className="font-mono text-[13px] font-semibold">{c.code}</span> · {c.name}</td>
                  <td>{c.symbol}</td>
                  <td className="num text-right">{c.code === "CLP" ? <Badge>Base</Badge> : c.last_rate_e6 ? `$ ${formatRate(c.last_rate_e6)}` : <span className="text-faint">Sin registrar</span>}</td>
                  <td className="num px-5 text-right text-muted">{formatDate(c.last_rate_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Tipos de cambio" subtitle="Pesos chilenos por 1 unidad de la moneda. Se usa el más reciente en o antes de la fecha de cada documento.">
        {can("config.editar") && (
          <div className="mb-5 grid gap-4 sm:grid-cols-[14rem_10rem_minmax(0,12rem)_auto] sm:items-end">
            <Select label="Moneda" value={cur} onChange={(e) => setCur(e.target.value)} options={(rows ?? []).filter((c) => c.code !== "CLP").map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
            <Field label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Field label="Pesos por 1 unidad" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="950,25" inputClassName="text-right num" />
            <Button icon={RefreshCw} onClick={save}>Guardar</Button>
          </div>
        )}
        {err && <div className="mb-4"><Notice tone="danger">{err}</Notice></div>}
        {history.length === 0 ? <p className="text-sm text-muted">Sin tipos de cambio registrados para {cur}.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {history.map((r) => (
              <li key={r.rate_date} className="flex items-center gap-4 px-4 py-2">
                <span className="num w-24 text-muted">{formatDate(r.rate_date)}</span>
                <span className="num flex-1 font-medium">$ {formatRate(r.rate_e6)}</span>
                {r.note && <span className="text-xs text-muted">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ───────────── Seguridad y auditoría ───────────── */

const ACTION_LABEL: Record<string, string> = {
  "empresa.crear": "Creó el negocio", "empresa.restaurar": "Restauró un respaldo", "negocio.editar": "Cambió los datos del negocio",
  "seguridad.editar": "Cambió la seguridad", "sesion.iniciar": "Inició sesión", "sesion.fallida": "Intento de inicio fallido",
  "sesion.cerrar": "Cerró sesión", "usuario.crear": "Creó un usuario", "usuario.editar": "Editó un usuario",
  "usuario.contrasena": "Asignó una contraseña", "usuario.quitar_contrasena": "Quitó una contraseña", "rol.permisos": "Cambió permisos de un rol",
  "numeracion.editar": "Cambió una numeración", "moneda.tasa": "Registró un tipo de cambio", "documento.adjuntar": "Adjuntó un documento",
  "documento.exportar": "Guardó una copia de un documento", "documento.quitar": "Quitó un documento", "cliente.crear": "Creó un cliente",
  "respaldo.crear": "Creó un respaldo", "producto.crear": "Creó un producto", "cotizacion.crear": "Creó una cotización",
  "cotizacion.editar": "Editó una cotización", "cotizacion.estado": "Cambió el estado de una cotización", "cotizacion.convertir": "Convirtió una cotización en venta",
  "venta.crear": "Creó una venta", "venta.editar": "Editó una venta", "venta.efectuar": "Efectuó una venta", "pago.registrar": "Registró un pago",
  "venta.documentar": "Marcó una venta como documentada", "venta.no_aplica": "Marcó documentación “no aplica”", "venta.anular": "Anuló una venta",
  "oc.recibir": "Recibió una orden de compra",
};

export function SecuritySection({ session }: { session: SessionInfo }) {
  const backend = useBackend();
  const toast = useToast();
  const { can, setSession } = useSession();
  const [report, setReport] = useState(session.audit);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [lock, setLock] = useState<string>("");

  useEffect(() => { backend.security().then((s) => setLock(String(s.lock_minutes))).catch(() => {}); }, [backend]);
  useEffect(() => {
    if (!can("auditoria.ver")) return;
    const t = setTimeout(() => { backend.auditLog(query).then(setRows).catch(() => setRows([])); }, 150);
    return () => clearTimeout(t);
  }, [backend, query, can]);

  return (
    <div className="flex flex-col gap-6">
      <Card title="Cadena de auditoría" actions={<Button variant="secondary" icon={ShieldCheck} disabled={busy} onClick={async () => { setBusy(true); try { setReport(await backend.verifyAudit()); } finally { setBusy(false); } }}>Verificar ahora</Button>}>
        {report.ok
          ? <Notice tone="success">Íntegra: {report.entries} registros encadenados, ninguno alterado.</Notice>
          : <Notice tone="danger">La cadena se rompe en el registro {report.broken_at}: la base fue modificada fuera de NÚCLEO.</Notice>}
      </Card>

      {can("usuarios.gestionar") && (
        <Card title="Bloqueo por inactividad" subtitle="Solo se aplica cuando el negocio usa contraseñas.">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Minutos sin actividad" inputMode="numeric" value={lock} onChange={(e) => setLock(e.target.value.replace(/\D/g, ""))} className="w-44" />
            <Button variant="secondary" onClick={async () => { try { await backend.updateSecurity({ lock_minutes: Number(lock) || 0 }); setSession(await backend.sessionInfo()); toast("success", "Guardado."); } catch (e) { toast("danger", errorMessage(e)); } }}>Guardar</Button>
          </div>
          <p className="mt-1.5 text-xs text-muted">0 = no bloquear.</p>
        </Card>
      )}

      {can("auditoria.ver") && (
        <Card title="Registro de actividad" subtitle="Quién hizo qué y cuándo. No se puede editar ni borrar." padded={false}>
          <div className="border-b border-line p-4"><Field aria-label="Filtrar auditoría" leading={<Search size={15} />} placeholder="Usuario, acción o número (ej. maria, venta, VEN-000012)" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-md" /></div>
          {!rows ? <div className="p-5"><Spinner /></div> : rows.length === 0 ? <p className="p-5 text-sm text-muted">Sin registros.</p> : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => setDetail(r)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="num whitespace-nowrap px-5 py-2 text-muted">{new Date(r.ts_utc).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className="px-3 py-2 font-medium">{r.user_name}</td>
                      <td className="px-3 py-2">{ACTION_LABEL[r.action] ?? r.action}</td>
                      <td className="px-5 py-2 font-mono text-[12px] text-muted">{r.entity_id ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Cifrado">
        <p className="text-sm text-muted">
          Base cifrada con SQLCipher {session.cipher_version}; documentos adjuntos cifrados con AES-256-GCM. La clave se guarda en el almacén seguro de
          Windows; la clave de recuperación que guardaste al crear el negocio permite recuperarla si reinstalas el sistema.
        </p>
      </Card>

      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail ? ACTION_LABEL[detail.action] ?? detail.action : ""}>
        {detail && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="text-muted">{new Date(detail.ts_utc).toLocaleString("es-CL")} · {detail.user_name} · <span className="font-mono">{detail.action}</span></div>
            {detail.reason && <div><strong>Motivo:</strong> {detail.reason}</div>}
            {detail.before_json && <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px]">Antes: {pretty(detail.before_json)}</pre>}
            {detail.after_json && <pre className="max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px]">Después: {pretty(detail.after_json)}</pre>}
          </div>
        )}
      </Dialog>
    </div>
  );
}

function pretty(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}
