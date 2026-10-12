// Selector de empresa: muestra todas las empresas de este computador con su color, permite
// cambiar, abrir otra en una ventana nueva o agregar una empresa.
import { useEffect, useRef, useState } from "react";
import { AppWindow, Check, ChevronDown, Plus } from "lucide-react";
import { useBackend, errorMessage, type AppInfo, type BusinessProfile, type CreatedCompany } from "../data";
import { accentSwatch } from "../lib/accent";
import { PROFILE_LABEL } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { Button, Field, IconButton, Notice, Segmented, cx } from "../ui/kit";
import { Dialog, useToast } from "../ui/overlay";

export function CompanySwitcher({ info, current, onSwitch, onCreated }: {
  info: AppInfo; current: string; onSwitch: (uid: string) => void; onCreated?: (c: CreatedCompany) => void;
}) {
  const backend = useBackend();
  const toast = useToast();
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  const cur = info.companies.find((c) => c.uid === current);

  async function newWindow(uid: string) {
    setOpen(false);
    try { await backend.openNewWindow(uid); toast("info", "Abriendo otra ventana…"); } catch (e) { toast("danger", errorMessage(e)); }
  }

  return (
    <div ref={box} className="relative mt-3">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Empresa activa" onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-left text-sm font-medium text-ink hover:border-line-strong">
        <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-surface" style={{ background: accentSwatch(prefs.companyAccents[current]) }} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{cur?.name ?? "Empresa"}</span>
        <ChevronDown size={15} className={cx("shrink-0 text-muted transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Tus empresas</p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {info.companies.map((c) => (
              <li key={c.uid} className="group flex items-center gap-1 pr-1.5">
                <button type="button" role="menuitem" onClick={() => { setOpen(false); if (c.uid !== current) onSwitch(c.uid); }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: accentSwatch(prefs.companyAccents[c.uid]) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{c.name}</span>
                    <span className="block text-xs text-muted">Perfil {PROFILE_LABEL[c.profile]}</span>
                  </span>
                  {c.uid === current && <Check size={15} className="shrink-0 text-accent" aria-label="Abierta" />}
                </button>
                <IconButton icon={AppWindow} size={15} label={`Abrir ${c.name} en otra ventana`} className="h-8 w-8 shrink-0" onClick={() => newWindow(c.uid)} />
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-1.5">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setAdding(true); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-accent hover:bg-surface-2">
              <Plus size={15} aria-hidden /> Agregar empresa
            </button>
          </div>
        </div>
      )}
      {adding && <NewCompanyDialog onClose={() => setAdding(false)} onCreated={(c) => { setAdding(false); onCreated?.(c); }} />}
    </div>
  );
}

function NewCompanyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CreatedCompany) => void }) {
  const backend = useBackend();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<BusinessProfile>("negocio");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try { onCreated(await backend.createCompany(name.trim(), profile)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title="Agregar empresa"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button icon={Plus} onClick={go} disabled={busy || !name.trim()}>{busy ? "Creando…" : "Crear empresa"}</Button></>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Cada empresa guarda sus datos por separado y cifrados en este computador. Después podrás tener una abierta en cada ventana.</p>
        <Field label="Nombre de la empresa" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Insumos del Sur SpA" data-autofocus
          onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Perfil</span>
          <Segmented label="Perfil" value={profile} onChange={setProfile}
            options={[{ value: "emprendedor", label: "Emprendedor" }, { value: "negocio", label: "Negocio" }, { value: "empresa", label: "Empresa" }]} />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Dialog>
  );
}
