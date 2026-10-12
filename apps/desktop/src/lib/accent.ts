// Colores de la interfaz por empresa: ayudan a reconocer en qué empresa se está trabajando,
// sobre todo con dos ventanas abiertas. El color se guarda en los datos de cada negocio.
export const ACCENTS: { id: string; label: string; light: string; dark: string }[] = [
  { id: "turquesa", label: "Turquesa (NÚCLEO)", light: "#00788f", dark: "#3cc8df" },
  { id: "azul", label: "Azul", light: "#1d5fd1", dark: "#6ea4ff" },
  { id: "verde", label: "Verde", light: "#12805c", dark: "#4fd1a1" },
  { id: "morado", label: "Morado", light: "#6d3fd1", dark: "#b39cff" },
  { id: "naranjo", label: "Naranjo", light: "#b0510c", dark: "#ffa35c" },
  { id: "frambuesa", label: "Frambuesa", light: "#c0284f", dark: "#ff7a9a" },
  { id: "grafito", label: "Grafito", light: "#3e4c5e", dark: "#a9b8cc" },
  { id: "dorado", label: "Dorado", light: "#8a6000", dark: "#f1c24f" },
];

/** Aplica el color de la empresa a toda la interfaz. */
export function applyAccent(accent: string | null | undefined) {
  const root = document.documentElement;
  if (accent && accent !== "turquesa" && ACCENTS.some((a) => a.id === accent)) root.setAttribute("data-accent", accent);
  else root.removeAttribute("data-accent");
}

/** Muestra del color para listas (el tono claro, que se lee en ambos temas). */
export const accentSwatch = (accent: string | null | undefined) => (ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0]!).light;
