// Gasto en terreno: monto, categoría y foto de la boleta, en unos segundos.
import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImagePlus, X } from "lucide-react";
import { errorMessage, useBackend, type ExpenseCategory } from "../../data";
import { addDays, todayIso } from "../../lib/format";
import { useToast } from "../../ui/overlay";
import { useNav } from "../MobileApp";
import { outbox } from "../outbox";
import { BigButton, Chip, Input, MoneyInput, TopBar } from "../ui";

const METHODS = ["Efectivo", "Transferencia", "Tarjeta de débito", "Tarjeta de crédito"];

export function Expense() {
  const backend = useBackend();
  const toast = useToast();
  const nav = useNav();
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [cat, setCat] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [desc, setDesc] = useState("");
  const [withTax, setWithTax] = useState(true);
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState("Efectivo");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { backend.expenseCategories().then((c) => setCats(c.filter((x) => !x.archived))).catch(() => {}); }, [backend]);
  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const category = cats.find((c) => c.id === cat);
  async function save() {
    if (!amount || !cat) return;
    setBusy(true);
    try {
      const today = todayIso();
      const g = await backend.registerExpense({
        category_id: cat, supplier_uid: null, date: today, description: desc.trim() || category?.name || "Gasto",
        total_minor: amount, tax_included: withTax, due_date: paid ? null : addDays(today, 30),
        paid_method: paid ? method : null, paid_account_uid: null, recurring_id: null, notes: "Registrado desde el celular",
      });
      if (photo) await backend.addAttachment({ file: photo }, "Foto de la boleta", { entity: "gasto", uid: g.uid }).catch(() => toast("warning", "El gasto quedó guardado, pero la foto no se pudo adjuntar."));
      outbox.add("gasto", `${desc.trim() || category?.name || "Gasto"}${photo ? " · con foto" : ""}`, amount);
      toast("success", "Gasto guardado.");
      nav.back();
    } catch (e) { toast("danger", errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <TopBar title="Registrar gasto" onBack={nav.back} />
      <div className="space-y-5 px-4 pt-4">
        <MoneyInput label="¿Cuánto gastaste?" value={amount} onValue={setAmount} autoFocus />
        <div>
          <span className="mb-1.5 block text-[14px] font-medium text-ink">¿En qué?</span>
          <div className="flex flex-wrap gap-2">{cats.slice(0, 12).map((c) => <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</Chip>)}</div>
        </div>
        <Input label="Detalle (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej. bencina 93, almuerzo con cliente" />

        <div>
          <span className="mb-1.5 block text-[14px] font-medium text-ink">Foto de la boleta</span>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {preview ? (
            <div className="relative overflow-hidden rounded-2xl border border-line">
              <img src={preview} alt="Boleta" className="max-h-64 w-full object-cover" />
              <button onClick={() => setPhoto(null)} aria-label="Quitar foto" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white"><X size={18} /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="m-press flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-muted">
              <Camera size={26} /><span className="text-[14px] font-medium">Sacar foto o elegir de la galería</span>
            </button>
          )}
        </div>

        <label className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3.5">
          <span><span className="block text-[15px] font-medium text-ink">El monto incluye IVA</span><span className="block text-[13px] text-muted">Si tienes factura, el IVA se separa como crédito.</span></span>
          <input type="checkbox" checked={withTax} onChange={(e) => setWithTax(e.target.checked)} className="h-6 w-6 accent-[var(--accent)]" />
        </label>

        <div>
          <span className="mb-1.5 block text-[14px] font-medium text-ink">¿Ya lo pagaste?</span>
          <div className="flex gap-2"><Chip active={paid} onClick={() => setPaid(true)}>Sí, ya lo pagué</Chip><Chip active={!paid} onClick={() => setPaid(false)}>No, queda por pagar</Chip></div>
          {paid && <div className="mt-2 flex flex-wrap gap-2">{METHODS.map((m) => <Chip key={m} active={method === m} onClick={() => setMethod(m)}>{m}</Chip>)}</div>}
        </div>

        <BigButton icon={photo ? Check : ImagePlus} onClick={save} disabled={busy || !amount || !cat}>{busy ? "Guardando…" : "Guardar gasto"}</BigButton>
      </div>
    </>
  );
}
