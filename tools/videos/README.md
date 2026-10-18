# Tutoriales en video

Graba los tutoriales de YouTube de NÚCLEO ERP desde la demostración en el navegador.

- `engine.cjs`: Chromium visible en Xvfb + ffmpeg (x11grab), cursor y clics visibles. Cada `say(texto, acción)` es una línea del guion: la acción ocurre mientras se lee y dura lo que tarda leerla.
- `recNN.cjs`: un guion por video (00 tráiler … 16 usuarios y respaldos).
- `post.py`: agrega portada y cierre (`cards.cjs`) y genera el video limpio, la versión GUIA con el texto en pantalla, el guion con tiempos y los subtítulos `.srt`.
- `sheet.py`: hoja de fotogramas para revisar cada video.

```bash
cd apps/desktop && npx vite --port 8767 &      # demostración
node tools/videos/rec02.cjs                    # graba
python3 tools/videos/post.py 02 02 "Tu primera|venta" "Subtítulo" "03 · Siguiente" "02 - Tu primera venta"
```

Requiere Xvfb, ffmpeg con libass y Playwright (Chromium). El video 01 usa además el sitio construido con `tools/build_web.py` servido en el puerto 8770.
