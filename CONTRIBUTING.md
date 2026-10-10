# Cómo contribuir a NÚCLEO ERP

¡Gracias por querer aportar! NÚCLEO ERP es software libre (AGPL-3.0-or-later) mantenido por
**FAVOR SpA**.

## 1. Firma el acuerdo de contribución (una sola vez)

Antes de integrar tu primer cambio necesitamos que aceptes el
[Acuerdo de Licencia de Contribución (CLA)](CLA.md). Tú sigues siendo dueño de tu código; el acuerdo
nos permite distribuirlo dentro de NÚCLEO (incluida la app móvil en las tiendas) y nos compromete a
que la versión de escritorio siga siendo libre.

Cuando abras tu primera solicitud de cambios (*pull request*), un asistente automático te pedirá que
comentes exactamente:

> He leído el Acuerdo de Contribución (CLA) y lo acepto

Con eso basta; queda registrado para tus aportes siguientes.

## 2. Reglas del proyecto

- **Sin valores normativos en el código.** Tasas, topes, tramos, UF o UTM van en paquetes normativos o
  los ingresa la persona (`docs/TAX_RULES.md`). `python3 tools/check_normativa.py` lo revisa.
- **Cálculos en `nucleo-domain`**, puros y con enteros, con su espejo en TypeScript y casos en `golden/`
  que se ejecutan en ambos lados.
- **Textos en español de Chile, claros y sin jerga**: la persona usuaria no es contadora.
- **Privacidad primero:** nada sale del computador sin una acción explícita de la persona.

## 3. Antes de enviar

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd apps/desktop && pnpm tsc --noEmit && pnpm vitest run
python3 tools/check_normativa.py
```

## 4. Dudas

Abre un *issue* en el repositorio. Para temas de seguridad, revisa `docs/SECURITY.md` y no publiques
el detalle en un *issue* abierto.
