declare module "*.png" {
  const src: string;
  export default src;
}

/** Versión de package.json, inyectada por Vite. */
declare const __APP_VERSION__: string;
