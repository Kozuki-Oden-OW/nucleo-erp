import { useState } from "react";
import { api, errorMessage, type BusinessProfile, type CreatedCompany } from "../lib/api";
import { Button, Field, Notice } from "../ui/primitives";

const PROFILES: { id: BusinessProfile; title: string; text: string }[] = [
  { id: "emprendedor", title: "Emprendedor", text: "Estoy comenzando. Productos, precios, cotizaciones, ventas, gastos y caja. Sin datos tributarios obligatorios." },
  { id: "negocio", title: "Negocio", text: "Ya vendo con regularidad. Compras, stock, cuentas por cobrar y por pagar, bancos y reportes." },
  { id: "empresa", title: "Empresa", text: "Empresa constituida. Varios usuarios, bodegas, contabilidad interna, comercio exterior y más." },
];

export function Onboarding({ onCreated }: { onCreated: (c: CreatedCompany) => void }) {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<BusinessProfile>("emprendedor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createCompany(name, profile));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col justify-center gap-8 px-6 py-12">
      <div>
        <p className="text-sm font-semibold tracking-widest text-accent">NÚCLEO ERP</p>
        <h1 className="mt-2 text-3xl font-semibold">Crea tu negocio</h1>
        <p className="mt-2 text-muted">
          Todo queda en este computador, cifrado. Puedes cambiar el perfil cuando quieras sin perder nada.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Field label="Nombre del negocio" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Ferretería Los Andes" autoFocus required maxLength={200} />
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Perfil de operación</legend>
          {PROFILES.map((p) => (
            <label key={p.id} className={`cursor-pointer rounded-xl border p-4 transition ${profile === p.id ? "border-accent bg-accent/5" : "border-line bg-surface hover:border-muted"}`}>
              <input type="radio" name="profile" value={p.id} checked={profile === p.id} onChange={() => setProfile(p.id)} className="sr-only" />
              <div className="font-semibold">{p.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted">{p.text}</div>
            </label>
          ))}
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? "Creando…" : "Crear negocio"}</Button>
        </div>
      </form>
    </main>
  );
}
