// Cursor propio de Claude dentro de NÚCLEO: se mueve hasta cada control antes de usarlo, para que la
// persona vea qué hace. No toca el mouse del computador.

const LAYER_ID = "nucleo-agent-layer";
let pos = { x: 600, y: 300 };
let hideTimer = 0;

function layer(): HTMLElement {
  let el = document.getElementById(LAYER_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = LAYER_ID;
  el.setAttribute("data-agent-ignore", "");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
  el.innerHTML = `
    <div data-cursor style="position:absolute;left:0;top:0;transform:translate(${pos.x}px,${pos.y}px);transition:transform 420ms cubic-bezier(.3,.7,.2,1),opacity 200ms;opacity:0;will-change:transform">
      <svg width="26" height="26" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 2px 3px rgb(0 0 0 / .35))">
        <path d="M4 2.5 19.5 12l-6.6 1.5L9.6 20 4 2.5Z" fill="#d97757" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
      <span style="position:absolute;left:20px;top:20px;white-space:nowrap;border-radius:999px;background:#d97757;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:4px 8px;box-shadow:0 2px 6px rgb(0 0 0 / .25)">Claude</span>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function cursorEl(): HTMLElement {
  return layer().querySelector<HTMLElement>("[data-cursor]")!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lleva el cursor de Claude al punto y marca el clic con un pulso. */
export async function pointAt(x: number, y: number): Promise<void> {
  const c = cursorEl();
  c.style.opacity = "1";
  const dist = Math.hypot(x - pos.x, y - pos.y);
  pos = { x, y };
  c.style.transform = `translate(${x - 4}px,${y - 3}px)`;
  await sleep(dist < 8 ? 40 : 440);
  const ring = document.createElement("div");
  ring.style.cssText = `position:absolute;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid #d97757;opacity:.9;transform:scale(.4);transition:transform 380ms ease-out,opacity 380ms ease-out`;
  layer().appendChild(ring);
  requestAnimationFrame(() => { ring.style.transform = "scale(1.4)"; ring.style.opacity = "0"; });
  setTimeout(() => ring.remove(), 420);
}

/** Muestra el aviso «Claude está usando NÚCLEO» mientras hay actividad; se oculta tras unos segundos sin acciones. */
export function activity(text: string, onStop: () => void): void {
  const l = layer();
  let bar = l.querySelector<HTMLElement>("[data-bar]");
  if (!bar) {
    bar = document.createElement("div");
    bar.setAttribute("data-bar", "");
    bar.style.cssText = "position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;border-radius:999px;background:#1f1e1d;color:#fff;font:500 13px/1.2 system-ui,sans-serif;padding:7px 8px 7px 14px;box-shadow:0 6px 20px rgb(0 0 0 / .3);pointer-events:auto;max-width:calc(100vw - 32px)";
    bar.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#d97757;box-shadow:0 0 0 4px rgb(217 119 87 / .3)"></span>
      <span data-text style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <button type="button" data-stop style="border:0;border-radius:999px;background:#ffffff1f;color:#fff;font:inherit;font-size:12px;padding:5px 10px;cursor:pointer">Detener</button>`;
    l.appendChild(bar);
  }
  bar.querySelector<HTMLElement>("[data-text]")!.textContent = text;
  const stop = bar.querySelector<HTMLButtonElement>("[data-stop]")!;
  stop.onclick = () => { onStop(); hideNow(); };
  bar.style.display = "flex";
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideNow, 6000);
}

export function hideNow(): void {
  const l = document.getElementById(LAYER_ID);
  if (!l) return;
  const bar = l.querySelector<HTMLElement>("[data-bar]");
  if (bar) bar.style.display = "none";
  const c = l.querySelector<HTMLElement>("[data-cursor]");
  if (c) c.style.opacity = "0";
}
