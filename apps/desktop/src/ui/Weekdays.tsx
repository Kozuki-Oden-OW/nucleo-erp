// Selector de días de la semana y hora para lo que NÚCLEO hace solo (ronda de cobranza, informe).
import { cx } from "./kit";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function WeekdayPicker({ label, value, onChange, disabled }: { label: string; value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((name, i) => {
          const on = value.includes(i + 1);
          return (
            <button key={name} type="button" role="checkbox" aria-checked={on} aria-label={name} disabled={disabled} onClick={() => toggle(i + 1)}
              className={cx("h-9 w-12 rounded-lg border text-sm transition-colors", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line-strong bg-surface text-muted hover:bg-surface-2", disabled && "opacity-60")}>
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

/** «lunes y jueves», «de lunes a viernes»… */
export function weekdaysText(days: number[]): string {
  const names = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const d = [...days].sort();
  if (!d.length) return "ningún día";
  if (d.length === 7) return "todos los días";
  if (d.join() === "1,2,3,4,5") return "de lunes a viernes";
  const list = d.map((x) => names[x - 1] ?? "");
  return list.length === 1 ? `los ${list[0]}` : `los ${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}
