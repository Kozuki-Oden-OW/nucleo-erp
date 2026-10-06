// Inicio de sesión: aparece cuando algún usuario del negocio tiene contraseña (o tras el bloqueo
// por inactividad). Sin contraseñas, el negocio abre directo con el dueño.
import { useState } from "react";
import { Lock, LogIn } from "lucide-react";
import { useBackend, errorMessage, type AppInfo, type SessionInfo } from "../data";
import { Button, Field, Notice, Select } from "../ui/kit";
import simbolo from "../assets/simbolo.png";

export function Login({ info, session, onLogged, onSwitch, locked }: {
  info: AppInfo;
  session: SessionInfo;
  onLogged: (s: SessionInfo) => void;
  onSwitch: (uid: string) => void;
  locked?: boolean;
}) {
  const backend = useBackend();
  const [username, setUsername] = useState(session.login_users[0]?.[0] ?? "");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { onLogged(await backend.login(username, password)); }
    catch (e2) { setErr(errorMessage(e2)); setPassword(""); }
    finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
      <form onSubmit={submit} className="anim-in w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-pop">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={simbolo} alt="" width={56} height={56} />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">{session.company.name}</h1>
          <p className="mt-1 text-sm text-muted">{locked ? "La pantalla se bloqueó por inactividad." : "Inicia sesión para continuar."}</p>
        </div>
        <div className="flex flex-col gap-4">
          {info.companies.length > 1 && (
            <Select label="Negocio" value={session.company.uid} onChange={(e) => onSwitch(e.target.value)} options={info.companies.map((c) => ({ value: c.uid, label: c.name }))} />
          )}
          <Select label="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} options={session.login_users.map(([u, n]) => ({ value: u, label: n }))} />
          <Field label="Contraseña" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} leading={<Lock size={15} />} />
          {err && <Notice tone="danger">{err}</Notice>}
          <Button type="submit" size="lg" icon={LogIn} disabled={busy || !password}>{busy ? "Verificando…" : "Entrar"}</Button>
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          ¿Olvidaste tu contraseña? Pide al dueño o administrador que te asigne una nueva desde Configuración → Usuarios.
        </p>
      </form>
    </main>
  );
}
