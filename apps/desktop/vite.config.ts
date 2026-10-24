import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

// Configuración para Tauri: puerto fijo y sin recursos externos.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  // Dos entradas: el escritorio (index.html) y la app del celular (movil.html), con el mismo código.
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: { input: { main: "index.html", movil: "movil.html" } },
  },
});
