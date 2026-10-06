// Usuarios locales y roles (Blueprint §10.4). Sin contraseñas, el negocio abre directo con el dueño;
// al asignar la primera, NÚCLEO pide iniciar sesión.
import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Lock, LockOpen, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { useBackend, errorMessage, type PermissionRow, type RoleRow, type UserRow } from "../../data";
import { useSession } from "../../lib/session";
import { Badge, Button, Card, Checkbox, Field, Notice, Spinner, Tabs, cx } from "../../ui/kit";
import { Dialog, Drawer, useToast } from "../../ui/overlay";

const ROLE_HINT: Record<string, string> = {
  dueno: "Todo el negocio", admin: "Todo, incluida la configuración", contador: "Contabilidad, dinero, reportes y auditoría",
  ventas: "Clientes, cotizaciones, ventas y cobros", bodega: "Stock, recepciones y ajustes", caja: "Ventas al contado y caja",
  compras: "Proveedores, órdenes de compra y recepciones", rrhh: "Remuneraciones (V2)",
};

const GROUPS: [string, string][] = [
  ["config", "Configuración"], ["usuarios", "Usuarios"], ["auditoria", "Auditoría"], ["respaldos", "Respaldos"],
  ["clientes", "Clientes"], ["proveedores", "Proveedores"], ["productos", "Productos"], ["costos", "Costos"],
  ["ventas", "Ventas"], ["cobros", "Cobros"], ["compras", "Compras"], ["inventario", "Inventario"], ["dinero", "Dinero"],
  ["caja", "Caja"], ["contabilidad", "Contabilidad"], ["comex", "COMEX"], ["documentos", "Documentos"], ["reportes", "Reportes"],
  ["remuneraciones", "Remuneraciones"],
];

export function UsersSection() {
  const { can } = useSession();
  const [tab, setTab] = useState<"usuarios" | "roles">("usuarios");
  if (!can("usuarios.gestionar")) return <OwnPasswordOnly />;
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "usuarios", label: "Usuarios" }, { value: "roles", label: "Roles y permisos" }]} />
      {tab === "usuarios" ? <UsersList /> : <RolesMatrix />}
    </div>
  );
}

/** Quien no administra usuarios igual puede cambiar su propia contraseña. */
function OwnPasswordOnly() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  if (!session.user) return null;
  return (
    <Card title="Mi usuario" subtitle={`${session.user.display_name} · ${session.user.username}`}>
      <Button variant="secondary" icon={KeyRound} onClick={() => setOpen(true)}>Cambiar mi contraseña</Button>
      <PasswordDialog open={open} onClose={() => setOpen(false)} userUid={session.user.uid} userName={session.user.display_name} own />
    </Card>
  );
}

function UsersList() {
  const backend = useBackend();
  const { session } = useSession();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [editing, setEditing] = useState<UserRow | "nuevo" | null>(null);
  const [pw, setPw] = useState<UserRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.listUsers().then(setUsers).catch((e) => setErr(errorMessage(e)));
    backend.roles().then((r) => setRoles(r.roles)).catch(() => {});
  }, [backend]);
  useEffect(load, [load]);
  const anyPassword = users?.some((u) => u.is_active && u.has_password) ?? false;

  return (
    <div className="flex flex-col gap-4">
      <Notice tone={anyPassword ? "success" : "info"} icon={anyPassword ? Lock : LockOpen} title={anyPassword ? "Inicio de sesión activado" : "Modo de un solo usuario"}>
        {anyPassword
          ? "Al abrir NÚCLEO se pide usuario y contraseña. Cada acción queda en la auditoría con el nombre de quien la hizo."
          : "NÚCLEO abre directo con el dueño. Si otras personas usarán este computador, crea sus usuarios y asigna contraseñas: el dueño debe tener una primero."}
      </Notice>
      {err && <Notice tone="danger">{err}</Notice>}
      <Card title="Usuarios" actions={<Button size="sm" icon={UserPlus} onClick={() => setEditing("nuevo")}>Nuevo usuario</Button>} padded={false}>
        {!users ? <div className="p-5"><Spinner /></div> : (
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.uid} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-ink">
                    {u.display_name}
                    {u.uid === session.user?.uid && <Badge tone="accent">Tú</Badge>}
                    {!u.is_active && <Badge>Inactivo</Badge>}
                  </div>
                  <div className="text-xs text-muted">{u.username} · {u.roles.map((r) => roles.find((x) => x.code === r)?.name ?? r).join(", ")}</div>
                </div>
                <Badge tone={u.has_password ? "success" : "neutral"} icon={u.has_password ? Lock : LockOpen}>{u.has_password ? "Con contraseña" : "Sin contraseña"}</Badge>
                <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setPw(u)}>Contraseña</Button>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(u)}>Editar</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <UserDrawer user={editing} roles={roles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      {pw && <PasswordDialog open onClose={() => { setPw(null); load(); }} userUid={pw.uid} userName={pw.display_name} hasPassword={pw.has_password} own={pw.uid === session.user?.uid} />}
    </div>
  );
}

function UserDrawer({ user, roles, onClose, onSaved }: { user: UserRow | "nuevo" | null; roles: RoleRow[]; onClose: () => void; onSaved: () => void }) {
  const backend = useBackend();
  const toast = useToast();
  const { setSession } = useSession();
  const isNew = user === "nuevo";
  const [form, setForm] = useState({ username: "", display_name: "", roles: [] as string[], password: "", is_active: true });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    if (user === "nuevo") setForm({ username: "", display_name: "", roles: ["ventas"], password: "", is_active: true });
    else if (user) setForm({ username: user.username, display_name: user.display_name, roles: user.roles, password: "", is_active: user.is_active });
  }, [user]);
  if (!user) return null;
  const toggle = (code: string) => setForm((f) => ({ ...f, roles: f.roles.includes(code) ? f.roles.filter((r) => r !== code) : [...f.roles, code] }));
  async function save() {
    setErr(null);
    try {
      if (isNew) await backend.createUser({ username: form.username, display_name: form.display_name, roles: form.roles, password: form.password || undefined });
      else await backend.updateUser((user as UserRow).uid, { display_name: form.display_name, is_active: form.is_active, roles: form.roles });
      toast("success", isNew ? "Usuario creado." : "Cambios guardados.");
      setSession(await backend.sessionInfo());
      onSaved();
    } catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Drawer open onClose={onClose} title={isNew ? "Nuevo usuario" : `Editar ${(user as UserRow).display_name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nombre" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Ej. María López" data-autofocus />
        <Field label="Usuario para iniciar sesión" value={form.username} disabled={!isNew} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ej. maria.lopez" hint="Sin tildes ni espacios. No se puede cambiar después." />
        {isNew && <Field label="Contraseña" optional type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="Mínimo 8 caracteres. Puedes asignarla después." />}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Roles</legend>
          {roles.map((r) => (
            <label key={r.code} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2", form.roles.includes(r.code) ? "border-accent bg-accent-soft" : "border-line")}>
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={form.roles.includes(r.code)} onChange={() => toggle(r.code)} />
              <span><span className="text-sm font-medium text-ink">{r.name}</span><span className="block text-xs text-muted">{ROLE_HINT[r.code] ?? `${r.permissions.length} permisos`}</span></span>
            </label>
          ))}
        </fieldset>
        {!isNew && <Checkbox label="Usuario activo" hint="Un usuario inactivo no puede iniciar sesión. Su historial se conserva." checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}

function PasswordDialog({ open, onClose, userUid, userName, hasPassword, own }: { open: boolean; onClose: () => void; userUid: string; userName: string; hasPassword?: boolean; own?: boolean }) {
  const backend = useBackend();
  const toast = useToast();
  const { setSession } = useSession();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go(value: string | null) {
    setErr(null);
    try {
      await backend.setPassword(userUid, value);
      toast("success", value ? "Contraseña guardada." : "Contraseña quitada.");
      setSession(await backend.sessionInfo());
      onClose();
    } catch (e) { setErr(errorMessage(e)); }
  }
  return (
    <Dialog open={open} onClose={onClose} title={own ? "Cambiar mi contraseña" : `Contraseña de ${userName}`} size="sm" footer={
      <>
        {hasPassword && !own && <Button variant="ghost" onClick={() => go(null)}>Quitar contraseña</Button>}
        <Button icon={KeyRound} disabled={pw.length < 8 || pw !== pw2} onClick={() => go(pw)}>Guardar</Button>
      </>
    }>
      <div className="flex flex-col gap-4">
        <Field label="Nueva contraseña" type="password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo 8 caracteres." data-autofocus />
        <Field label="Repetir contraseña" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw2 && pw !== pw2 ? "Las contraseñas no coinciden." : null} />
        <p className="text-xs text-muted">Se guarda protegida con Argon2id: ni NÚCLEO puede leerla. Tras 5 intentos fallidos, el usuario queda bloqueado 5 minutos.</p>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function RolesMatrix() {
  const backend = useBackend();
  const toast = useToast();
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [perms, setPerms] = useState<PermissionRow[]>([]);
  const [selected, setSelected] = useState("ventas");
  const [draft, setDraft] = useState<string[]>([]);
  useEffect(() => { backend.roles().then((r) => { setRoles(r.roles); setPerms(r.permissions); }).catch(() => setRoles([])); }, [backend]);
  const role = roles?.find((r) => r.code === selected);
  useEffect(() => { if (role) setDraft(role.permissions); }, [role]);
  const grouped = useMemo(() => GROUPS.map(([g, label]) => [label, perms.filter((p) => p.code.split(".")[0] === g)] as const).filter(([, ps]) => ps.length), [perms]);
  if (!roles) return <Spinner />;
  const locked = selected === "dueno" || selected === "admin";
  const dirty = role && JSON.stringify([...draft].sort()) !== JSON.stringify([...role.permissions].sort());
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Roles">
        {roles.map((r) => (
          <button key={r.code} onClick={() => setSelected(r.code)} className={cx("flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm", selected === r.code ? "bg-accent-soft font-medium text-accent" : "hover:bg-surface-2")}>
            {r.name}<span className="num text-xs text-muted">{r.permissions.length}</span>
          </button>
        ))}
      </nav>
      <Card title={role?.name} subtitle={locked ? "Este rol siempre tiene todos los permisos." : "Marca lo que este rol puede hacer. Afecta a todos los usuarios con este rol."}
        actions={!locked && <Button size="sm" icon={ShieldCheck} disabled={!dirty} onClick={async () => { try { const r = await backend.updateRolePermissions(selected, draft); setRoles((rs) => rs!.map((x) => (x.code === r.code ? r : x))); toast("success", "Permisos guardados."); } catch (e) { toast("danger", errorMessage(e)); } }}>Guardar</Button>}>
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {grouped.map(([label, ps]) => (
            <div key={label}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
              <div className="flex flex-col gap-1.5">
                {ps.map((p) => (
                  <label key={p.code} className={cx("flex items-center gap-2 text-sm", locked && "opacity-70")}>
                    <input type="checkbox" disabled={locked} className="h-4 w-4 accent-[var(--accent)]" checked={locked || draft.includes(p.code)} onChange={(e) => setDraft((d) => (e.target.checked ? [...d, p.code] : d.filter((x) => x !== p.code)))} />
                    {p.description}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
