import { useState } from "react";
import { FlaskConical, Lock, WifiOff, HeartHandshake } from "lucide-react";
import { useBackend, errorMessage, type BusinessProfile, type CreatedCompany } from "../data";
import { Button, Field, Notice, cx } from "../ui/kit";
import simbolo from "../assets/simbolo.png";

const PROFILES: { id: BusinessProfile; title: string; text: string }[] = [
  { id: "emprendedor", title: "Emprendedor", text: "Estoy comenzando. Productos, precios, cotizaciones, ventas, gastos y caja. Sin datos tributarios obligatorios." },
  { id: "negocio", title: "Negocio", text: "Ya vendo con regularidad. Compras, stock, cuentas por cobrar y por pagar, bancos y reportes." },
  { id: "empresa", title: "Empresa", text: "Empresa constituida. Varios usuarios, bodegas, contabilidad interna, comercio exterior y más." },
];

export function Onboarding({ onCreated, onDemo }: { onCreated: (c: CreatedCompany) => void; onDemo?: () => void }) {
  const backend = useBackend();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<BusinessProfile>("emprendedor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await backend.createCompany(name, profile));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <img src={simbolo} alt="" width={72} height={72} className="mb-3" />
        <p className="text-sm font-bold tracking-widest text-accent">NÚCLEO ERP</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Crea tu negocio</h1>
        <p className="mt-2 text-muted">Solo necesitas un nombre. Puedes cambiar el perfil cuando quieras sin perder nada.</p>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
          <li className="flex items-center gap-1.5"><Lock size={15} className="text-accent" aria-hidden /> Cifrado en tu computador</li>
          <li className="flex items-center gap-1.5"><WifiOff size={15} className="text-accent" aria-hidden /> Funciona sin Internet</li>
          <li className="flex items-center gap-1.5"><HeartHandshake size={15} className="text-accent" aria-hidden /> Gratis, sin cuentas ni mensualidades</li>
        </ul>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Field label="Nombre del negocio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Ferretería Los Andes" autoFocus required maxLength={200} />
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-[13px] font-medium">Perfil de operación</legend>
          {PROFILES.map((p) => (
            <label key={p.id} className={cx("cursor-pointer rounded-xl border p-4 transition-colors", profile === p.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong")}>
              <input type="radio" name="profile" value={p.id} checked={profile === p.id} onChange={() => setProfile(p.id)} className="sr-only" />
              <div className="font-semibold">{p.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted">{p.text}</div>
            </label>
          ))}
        </fieldset>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={busy || !name.trim()}>{busy ? "Creando…" : "Crear negocio"}</Button>
          {onDemo && <Button variant="ghost" icon={FlaskConical} onClick={onDemo}>Explorar con datos de ejemplo</Button>}
        </div>
      </form>
    </main>
  );
}
