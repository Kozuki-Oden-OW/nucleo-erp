// Tabla de datos con teclado (↑ ↓ Enter) y virtualización para listas grandes (100.000 filas).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./kit";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string; // ej. "8rem" o "1fr"
  className?: string;
}

const ROW_PX = 40;
const VIRTUAL_FROM = 150;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onOpen,
  empty,
  maxHeight = "calc(100vh - 260px)",
  label,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  empty?: ReactNode;
  maxHeight?: string;
  label: string;
}) {
  const [active, setActive] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  const grid = useMemo(() => columns.map((c) => c.width ?? "minmax(10rem,1fr)").join(" "), [columns]);
  const virtual = rows.length > VIRTUAL_FROM;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { if (active >= rows.length) setActive(rows.length - 1); }, [rows.length, active]);

  const first = virtual ? Math.max(0, Math.floor(scrollTop / ROW_PX) - 10) : 0;
  const last = virtual ? Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_PX) + 10) : rows.length;

  function onKey(e: React.KeyboardEvent) {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = e.key === "ArrowDown" ? Math.min(rows.length - 1, active + 1) : Math.max(0, active - 1);
      setActive(n);
      const el = box.current;
      if (el) {
        const top = n * ROW_PX, bottom = top + ROW_PX + 40;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
      }
    } else if (e.key === "Enter" && active >= 0 && onOpen) {
      e.preventDefault();
      onOpen(rows[active]!);
    }
  }

  const alignCls = (a?: string) => (a === "right" ? "justify-end text-right" : a === "center" ? "justify-center text-center" : "");

  return (
    <div
      ref={box}
      tabIndex={0}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length}
      onKeyDown={onKey}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="relative overflow-auto rounded-xl border border-line bg-surface shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      style={{ maxHeight }}
    >
      <div className="min-w-max">
      <div
        role="row"
        className="sticky top-0 z-[1] grid border-b border-line bg-surface-2/95 px-4 text-xs font-semibold uppercase tracking-wide text-muted backdrop-blur"
        style={{ gridTemplateColumns: grid }}
      >
        {columns.map((c) => (
          <div key={c.key} role="columnheader" className={cx("flex items-center py-2.5 pr-3", alignCls(c.align))}>{c.header}</div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted">{empty ?? "Sin resultados."}</div>
      ) : (
        <div style={virtual ? { height: rows.length * ROW_PX, position: "relative" } : undefined}>
          {rows.slice(first, last).map((r, i) => {
            const idx = first + i;
            return (
              <div
                key={rowKey(r)}
                role="row"
                aria-rowindex={idx + 2}
                aria-selected={idx === active}
                onClick={() => { setActive(idx); onOpen?.(r); }}
                className={cx(
                  "grid items-center border-b border-line px-4 text-sm last:border-b-0",
                  onOpen && "cursor-pointer",
                  idx === active ? "bg-accent-soft/70" : "hover:bg-surface-2/70",
                )}
                style={{
                  gridTemplateColumns: grid,
                  height: ROW_PX,
                  ...(virtual ? { position: "absolute", top: idx * ROW_PX, left: 0, right: 0 } : {}),
                }}
              >
                {columns.map((c) => (
                  <div key={c.key} role="gridcell" className={cx("flex min-w-0 items-center pr-3", alignCls(c.align), c.className)}>
                    <span className="truncate">{c.render(r)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
