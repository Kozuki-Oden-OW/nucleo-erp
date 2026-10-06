import { useState } from "react";
import { Copy, KeyRound, Printer } from "lucide-react";
import { Button, Checkbox, Notice } from "../ui/kit";

/** Se muestra UNA vez al crear el negocio (riesgo T-01: sin esta clave, los datos pueden perderse). */
export function RecoveryKey({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><KeyRound size={24} aria-hidden /></div>
      <h1 className="text-2xl font-semibold tracking-tight">Guarda tu clave de recuperación</h1>
      <p className="text-muted">
        Tus datos están cifrados. Si reinstalas Windows o cambias de computador sin un respaldo, esta clave es la
        única forma de volver a abrirlos. Guárdala como guardarías las llaves de tu oficina: impresa o anotada, fuera de este computador.
      </p>
      <div aria-label="Clave de recuperación" className="flex select-all flex-wrap justify-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-5 font-mono text-lg tracking-wider shadow-card">
        {recoveryKey.split("-").map((group, i) => <span key={i}>{group}</span>)}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon={Copy} onClick={async () => { await navigator.clipboard.writeText(recoveryKey); setCopied(true); }}>{copied ? "Copiada" : "Copiar"}</Button>
        <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
      </div>
      <Notice tone="info">NÚCLEO no guarda una copia de esta clave en ningún servidor. Nadie más puede recuperarla por ti.</Notice>
      <Checkbox label="Ya guardé mi clave de recuperación en un lugar seguro." checked={saved} onChange={setSaved} />
      <div><Button size="lg" disabled={!saved} onClick={onDone}>Continuar</Button></div>
    </main>
  );
}
