import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorMessage, type AppInfo, type BackupDone, type Customer, type SessionInfo } from "../lib/api";
import { PROFILE_LABEL, formatBytes, formatRut } from "../lib/format";
import { Button, Card, Field, Notice, Stat } from "../ui/primitives";
import simbolo from "../assets/simbolo.png";

type Section = "inicio" | "clientes" | "respaldos" | "seguridad";

const NAV: { id: Section | null; label: string; phase?: string }[] = [
  { id: "inicio", label: "Inicio" },
  { id: "clientes", label: "Clientes" },
  { id: null, label: "Vender", phase: "Fase 5" },
  { id: null, label: "Comprar", phase: "Fase 6" },
  { id: null, label: "Inventario", phase: "Fase 7" },
  { id: null, label: "Dinero", phase: "Fase 8" },
  { id: null, label: "COMEX", phase: "Fase 9" },
  { id: null, label: "Análisis", phase: "Fase 12" },
  { id: "respaldos", label: "Respaldos" },
  { id: "seguridad", label: "Seguridad y auditoría" },
];

export function Workspace({ info, session, onSwitch, onReload }: {
  info: AppInfo;
  session: SessionInfo;
  onSwitch: (uid: string) => void;
  onReload: () => void;
}) {
  const [section, setSection] = useState<Section>("inicio");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSection("clientes");
        setTimeout(() => search.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <div className="border-b border-line p-4">
          <div className="flex items-center gap-2">
            <img src={simbolo} alt="" width={28} height={28} />
            <span className="text-xs font-semibold tracking-widest text-accent">NÚCLEO ERP</span>
          </div>
          <select
            aria-label="Negocio activo"
            className="mt-2 w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm"
            value={session.company.uid}
            onChange={(e) => onSwitch(e.target.value)}
          >
            {info.companies.map((c) => <option key={c.uid} value={c.uid}>{c.name}</option>)}
          </select>
          <div className="mt-1 text-xs text-muted">Perfil {PROFILE_LABEL[session.company.profile]}</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Secciones">
          {NAV.map((n) => (
            <button
              key={n.label}
              disabled={!n.id}
              onClick={() => n.id && setSection(n.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                n.id === section ? "bg-accent/10 font-medium text-accent" : n.id ? "text-ink hover:bg-surface-2" : "cursor-default text-muted/70"
              }`}
            >
              <span>{n.label}</span>
              {n.phase && <span className="text-[10px] uppercase tracking-wide">{n.phase}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-line p-4 text-xs text-muted">Versión {info.version} · Gratis y local</div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-line bg-bg/90 px-8 py-3 backdrop-blur">
          <button
            onClick={() => { setSection("clientes"); setTimeout(() => search.current?.focus(), 0); }}
            className="w-full max-w-xl rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-muted"
          >
            Buscar cualquier cosa… <span className="float-right text-xs">Ctrl+K</span>
          </button>
        </div>
        <div className="mx-auto max-w-5xl p-8">
          {section === "inicio" && <Home session={session} />}
          {section === "clientes" && <Customers searchRef={search} onChanged={onReload} />}
          {section === "respaldos" && <Backups info={info} onRestored={onReload} />}
          {section === "seguridad" && <Security session={session} />}
        </div>
      </main>
    </div>
  );
}

function Home({ session }: { session: SessionInfo }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{session.company.name}</h1>
        <p className="mt-1 text-muted">Fase 1 — fundación técnica. Los módulos de negocio se habilitan fase a fase.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Clientes" value={session.customers} />
        <Stat label="Cifrado" value={session.cipher_version ? `SQLCipher ${session.cipher_version.split(" ")[0]}` : "No"} tone={session.cipher_version ? "ok" : "bad"} />
        <Stat label="Auditoría" value={session.audit.ok ? `Íntegra (${session.audit.entries})` : "Alterada"} tone={session.audit.ok ? "ok" : "bad"} />
      </div>
      <Card title="Tus datos están en este computador">
        <p className="text-sm leading-relaxed text-muted">
          NÚCLEO no envía información a ningún servidor, no pide credenciales tributarias y funciona sin Internet.
          Crea respaldos periódicos en un pendrive o disco externo desde la sección Respaldos.
        </p>
      </Card>
    </div>
  );
}

function Customers({ searchRef, onChanged }: { searchRef: React.RefObject<HTMLInputElement | null>; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Customer[]>([]);
  const [form, setForm] = useState({ name: "", rut: "", email: "", phone: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { api.searchCustomers(query).then(setRows).catch((e) => setMsg({ tone: "error", text: errorMessage(e) })); }, 120);
    return () => clearTimeout(t);
  }, [query]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const c = await api.addCustomer({ name: form.name, rut: form.rut || undefined, email: form.email || undefined, phone: form.phone || undefined });
      setMsg({ tone: "ok", text: `Cliente ${c.name} agregado.` });
      setForm({ name: "", rut: "", email: "", phone: "" });
      setRows(await api.searchCustomers(query));
      onChanged();
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Clientes</h1>
      <Card title="Nuevo cliente">
        <form onSubmit={add} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre o razón social" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Field label="RUT (opcional)" value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="12.345.678-5" />
          <Field label="Correo (opcional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field label="Teléfono (opcional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={!form.name.trim()}>Agregar cliente</Button>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          </div>
        </form>
      </Card>
      <Card title="Buscar">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre, RUT o correo — sin importar tildes"
          className="mb-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="py-2">Nombre</th><th>RUT</th><th>Correo</th><th>Teléfono</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.uid} className="border-t border-line">
                <td className="py-2 font-medium">{c.name}</td>
                <td className="tabular-nums">{formatRut(c.rut)}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.phone ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Sin resultados.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Backups({ info, onRestored }: { info: AppInfo; onRestored: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BackupDone | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [restorePw, setRestorePw] = useState("");

  async function create() {
    setBusy(true); setMsg(null); setDone(null);
    try { setDone(await api.createBackup(pw)); setPw(""); setPw2(""); }
    catch (e) { setMsg({ tone: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function pick() {
    const f = await open({ multiple: false, directory: false, filters: [{ name: "Respaldo NÚCLEO", extensions: ["erpbackup"] }] });
    if (typeof f === "string") setRestorePath(f);
  }

  async function restore() {
    if (!restorePath) return;
    setBusy(true); setMsg(null);
    try {
      const c = await api.restoreBackup(restorePath, restorePw);
      setMsg({ tone: "ok", text: `Respaldo restaurado como "${c.name}". Puedes abrirlo desde el selector de negocio.` });
      setRestorePw(""); setRestorePath(null);
      onRestored();
    } catch (e) { setMsg({ tone: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Respaldos</h1>
      <Card title="Crear respaldo">
        <p className="mb-4 text-sm text-muted">
          El respaldo queda cifrado con la contraseña que elijas y se verifica automáticamente al terminar. Carpeta: <span className="font-mono text-xs">{info.backups_dir}</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña del respaldo" type="password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo 8 caracteres. Sin ella no se puede restaurar." />
          <Field label="Repetir contraseña" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={create} disabled={busy || pw.length < 8 || pw !== pw2}>{busy ? "Trabajando…" : "Crear respaldo"}</Button>
          {mismatch && <span className="text-sm text-danger">Las contraseñas no coinciden.</span>}
        </div>
        {done && (
          <div className="mt-4">
            <Notice tone="ok">
              Respaldo verificado ✓ — {done.file_name} ({formatBytes(done.size_bytes)}), {done.manifest.counts["customers"] ?? 0} clientes.
            </Notice>
          </div>
        )}
      </Card>
      <Card title="Restaurar respaldo">
        <p className="mb-4 text-sm text-muted">Se restaura como un negocio nuevo: nunca reemplaza al actual.</p>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={pick}>Elegir archivo .erpbackup</Button>
            <span className="truncate text-sm text-muted">{restorePath ?? "Ningún archivo elegido"}</span>
          </div>
          <Field label="Contraseña del respaldo" type="password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} />
          <div><Button onClick={restore} disabled={busy || !restorePath || restorePw.length < 8}>Restaurar</Button></div>
        </div>
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

function Security({ session }: { session: SessionInfo }) {
  const [report, setReport] = useState(session.audit);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Seguridad y auditoría</h1>
      <Card title="Cadena de auditoría" actions={
        <Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); try { setReport(await api.verifyAudit()); } finally { setBusy(false); } }}>Verificar ahora</Button>
      }>
        {report.ok
          ? <Notice tone="ok">Íntegra: {report.entries} registros encadenados, ninguno alterado.</Notice>
          : <Notice tone="error">La cadena se rompe en el registro {report.broken_at}: la base fue modificada fuera de NÚCLEO.</Notice>}
      </Card>
      <Card title="Cifrado">
        <p className="text-sm text-muted">
          Base cifrada con SQLCipher {session.cipher_version}. La clave se guarda en el almacén seguro de Windows; la clave
          de recuperación que guardaste al crear el negocio permite recuperarla si reinstalas el sistema.
        </p>
      </Card>
    </div>
  );
}
