// Configuración → Integraciones → Accesos: el gestor de contraseñas de NÚCLEO. Guarda el usuario y la clave
// de cuentas de SOLO LECTURA (colaborador de Mercado Libre, operador de consulta del banco…). La clave se
// escribe aquí, queda cifrada y no se vuelve a mostrar; Claude no puede escribirla ni verla
// (docs/AGENTE_CLAUDE.md §7).
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { errorMessage, useBackend, type AccessInput, type AccessRow } from "../../data";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, Field, IconButton, Notice, Select, Spinner, TextArea } from "../../ui/kit";
import { DataTable, type Column } from "../../ui/table";
import { Dialog, useToast } from "../../ui/overlay";

const EMPTY: AccessInput = { name: "", login_url: "", username: "", password: "", kind: "lectura", notes: "", no_payments: false };
const PRESETS: { label: string; name: string; url: string }[] = [
  { label: "Mercado Libre (colaborador)", name: "Mercado Libre", url: "https://www.mercadolibre.cl/" },
  { label: "BCI (operador de consulta)", name: "BCI", url: "https://www.bci.cl/empresas" },
  { label: "Bluexpress", name: "Bluexpress", url: "https://www.blue.cl/" },
];

export function AccessCard() {
  const backend = useBackend();
  const toast = useToast();
  const { can } = useSession();
  const editable = can("config.editar");
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ uid: string | null; form: AccessInput } | null>(null);
  const [removing, setRemoving] = useState<AccessRow | null>(null);

  const load = useCallback(async () => {
    try { setRows(await backend.accesses()); } catch (e) { setErr(errorMessage(e)); }
  }, [backend]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!rows) return <Spinner />;

  const open = (a?: AccessRow) => setEditing(a
    ? { uid: a.uid, form: { name: a.name, login_url: a.login_url, username: a.username, password: "", kind: a.kind, notes: a.notes ?? "", no_payments: true } }
    : { uid: null, form: EMPTY });
  const set = (patch: Partial<AccessInput>) => setEditing((e) => e && { ...e, form: { ...e.form, ...patch } });
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const a = await backend.saveAccess(editing.uid, editing.form);
      setEditing(null);
      await load();
      toast("success", `Acceso a ${a.name} guardado. La clave quedó cifrada y no se vuelve a mostrar.`);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      setRows(await backend.deleteAccess(removing.uid));
      toast("success", `Se borró el acceso a ${removing.name} y su clave.`);
      setRemoving(null);
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  };

  const columns: Column<AccessRow>[] = [
    { key: "name", header: "Sitio", width: "minmax(8rem,1fr)", render: (a) => <span className="flex min-w-0 flex-col"><strong className="truncate">{a.name}</strong><span className="truncate text-xs text-muted">{a.login_url}</span></span> },
    { key: "user", header: "Usuario", width: "minmax(8rem,1fr)", render: (a) => <span className="truncate">{a.username}</span> },
    { key: "kind", header: "Tipo", width: "9rem", render: (a) => <Badge tone="success" icon={ShieldCheck}>{a.kind === "lectura" ? "Solo lectura" : "Operador sin pagos"}</Badge> },
    { key: "pass", header: "Clave", width: "6.5rem", render: (a) => a.has_password ? "Guardada" : "—" },
    ...(editable ? [{ key: "actions", header: "", width: "5rem", align: "right" as const, render: (a: AccessRow) => (
      <span className="flex justify-end gap-1">
        <IconButton icon={Pencil} label={`Cambiar el acceso a ${a.name}`} onClick={() => open(a)} />
        <IconButton icon={Trash2} label={`Borrar el acceso a ${a.name}`} onClick={() => setRemoving(a)} />
      </span>
    ) }] : []),
  ];
  const f = editing?.form;

  return (
    <Card
      title="Accesos"
      subtitle="Usuario y clave de cuentas de solo lectura (colaborador de Mercado Libre, operador de consulta del banco) para que NÚCLEO pueda iniciar sesión cuando no esté abierta."
      actions={editable ? <Button variant="secondary" icon={Plus} onClick={() => open()}>Agregar acceso</Button> : <Badge icon={KeyRound}>{rows.length}</Badge>}
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info" title="Cómo se usan">
          La clave queda cifrada en tu computador y no se vuelve a mostrar: ni en esta pantalla ni a Claude. El ingreso automático con tu autorización
          («Autorizo / No autorizo») llega con la extensión de NÚCLEO para el navegador; hasta entonces el acceso queda guardado y tú inicias sesión como siempre.
          Guarda solo cuentas que <strong>no puedan pagar ni transferir</strong>.
        </Notice>
        <DataTable label="Accesos guardados" columns={columns} rows={rows} rowKey={(a) => a.uid} empty="Aún no hay accesos guardados." />
      </div>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.uid ? "Cambiar acceso" : "Agregar acceso"}
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !f?.name.trim() || !f?.username.trim() || !f?.no_payments}>{busy ? "Guardando…" : "Guardar acceso"}</Button>
        </>}
      >
        {f && (
          <div className="flex flex-col gap-3">
            {!editing?.uid && (
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => <Button key={p.name} size="sm" variant="secondary" onClick={() => set({ name: p.name, login_url: p.url })}>{p.label}</Button>)}
              </div>
            )}
            <Field label="Sitio" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Mercado Libre" />
            <Field label="Dirección de ingreso" value={f.login_url} onChange={(e) => set({ login_url: e.target.value })} placeholder="https://…" hint="La página donde se inicia sesión. NÚCLEO solo usará la clave en esa dirección." />
            <Field label="Usuario o correo" value={f.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
            <Field label="Clave" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password"
              placeholder={editing?.uid ? "Guardada (escribe para cambiarla)" : ""} hint="Escríbela tú aquí; no la envíes por chat. Queda cifrada y no se vuelve a mostrar." />
            <Select label="Tipo de cuenta" value={f.kind} onChange={(e) => set({ kind: e.target.value as AccessInput["kind"] })}
              options={[{ value: "lectura", label: "Solo lectura (ver datos)" }, { value: "operador", label: "Operador sin facultad de pagar" }]} />
            <TextArea label="Notas" optional rows={2} value={f.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
            {/* La declaración es de la persona: Claude no puede marcarla. */}
            <div data-agent-human>
              <Checkbox label="Confirmo que esta cuenta no puede pagar, transferir ni firmar." checked={f.no_payments} onChange={(v) => set({ no_payments: v })}
                hint="No guardes la clave de un apoderado del banco, de Google ni la Clave Tributaria." />
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title="Borrar acceso"
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button>
          <Button variant="danger" onClick={remove} disabled={busy}>Borrar acceso y clave</Button>
        </>}
      >
        {removing && <p className="text-sm">Se borra el acceso a <strong>{removing.name}</strong> ({removing.username}) y su clave guardada. La cuenta en el sitio no cambia.</p>}
      </Dialog>
    </Card>
  );
}
