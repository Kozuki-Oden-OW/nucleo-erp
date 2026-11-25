// Colores principales de un logo, para proponerlos como colores de la cotización. Todo se calcula
// en el computador, mirando los píxeles de la imagen que ya está guardada en NÚCLEO.

export interface LogoPalette {
  /** El color más oscuro de los dos: sirve de fondo con letras blancas. */
  primary: string;
  /** El segundo color del logo, si tiene uno claramente distinto. */
  secondary: string | null;
}

const BUCKETS = 24;
const hexOf = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** Luminosidad percibida, de 0 (negro) a 1 (blanco). */
export function luminance(r: number, g: number, b: number): number { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

/**
 * Busca los dos tonos con más superficie entre los píxeles con color (ni transparentes, ni grises,
 * ni casi blancos o negros). `data` es RGBA, como lo entrega un canvas. Sin píxeles con color
 * (logo en blanco y negro) devuelve `null`.
 */
export function paletteFromPixels(data: ArrayLike<number>): LogoPalette | null {
  const n = new Array<number>(BUCKETS).fill(0), sr = new Array<number>(BUCKETS).fill(0), sg = new Array<number>(BUCKETS).fill(0), sb = new Array<number>(BUCKETS).fill(0);
  let colored = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (max < 56 || d / max < 0.35) continue; // muy oscuro o sin saturación
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    if (h < 0) h += 6;
    const k = Math.round((h / 6) * BUCKETS) % BUCKETS;
    n[k]!++; sr[k]! += r; sg[k]! += g; sb[k]! += b; colored++;
  }
  if (!colored) return null;
  const dist = (a: number, b: number) => Math.min(Math.abs(a - b), BUCKETS - Math.abs(a - b));
  const top = (skip: number | null) => {
    let best = -1;
    for (let k = 0; k < BUCKETS; k++) if ((skip === null || dist(k, skip) >= 3) && (best < 0 || n[k]! > n[best]!)) best = k;
    return best;
  };
  // Cada tono junta a sus vecinos inmediatos (el suavizado de bordes reparte el color en dos cubos).
  const mean = (k: number): [number, number, number, number] => {
    let c = 0, r = 0, g = 0, b = 0;
    for (const j of [k - 1, k, k + 1]) { const q = (j + BUCKETS) % BUCKETS; c += n[q]!; r += sr[q]!; g += sg[q]!; b += sb[q]!; }
    return [r / c, g / c, b / c, c];
  };
  const a = top(null);
  const ca = mean(a);
  const b = top(a);
  const cb = b >= 0 && n[b]! > 0 ? mean(b) : null;
  const second = cb && cb[3] >= colored * 0.04 ? cb : null;
  if (!second) return { primary: hexOf(ca[0], ca[1], ca[2]), secondary: null };
  const [dark, light] = luminance(ca[0], ca[1], ca[2]) <= luminance(second[0], second[1], second[2]) ? [ca, second] : [second, ca];
  return { primary: hexOf(dark[0], dark[1], dark[2]), secondary: hexOf(light[0], light[1], light[2]) };
}

/** Lee el logo (imagen `data:`) y devuelve sus colores. En el navegador o en el escritorio. */
export async function logoPalette(logo: string): Promise<LogoPalette | null> {
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error("No se pudo leer el logo."));
    i.src = logo;
  });
  const k = Math.min(1, 240 / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar el logo.");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return paletteFromPixels(ctx.getImageData(0, 0, c.width, c.height).data);
}
