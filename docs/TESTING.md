# Pruebas — NÚCLEO ERP

## Cómo ejecutar

```bash
cargo test --workspace                 # toda la lógica en Rust
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cd apps/desktop && pnpm test           # pruebas del frontend (Vitest)
cd apps/desktop && pnpm typecheck
python3 tools/check_normativa.py       # sin valores normativos en el código
```

## Estado al cierre de la Fase 2 (85 pruebas en Rust + 3 en el frontend)

| Crate | Pruebas | Qué cubren |
|---|---|---|
| `nucleo-domain` | 36 | Dinero y redondeo, RUT, numeración, totales con afecto/exento, costo promedio, stock real/futuro, velocidad, cobertura, quiebre, reorden, clientes en riesgo, estados de venta |
| `nucleo-rules` | 10 | Vigencias, error sin valor, fuente obligatoria, superposición, tipos, firma Ed25519 (válida, alterada, clave desconocida, formato), diff |
| `nucleo-db` | 17 + 7 esquema | Cifrado, clave incorrecta, rutas de red, migraciones, auditoría, FTS5, paginación, copia en caliente; **esquema**: integridad, stock como libro, ventas inmutables y flujo de estados, pagos parciales, asientos cuadrados y períodos cerrados, stock real golden en SQL, restricciones de formato |
| `nucleo-io` | 6 | Respaldo ida y vuelta, contenido ilegible, contraseña errónea/débil, alteración, formato futuro, rutas peligrosas |
| `nucleo-app` | 4 + 4 integración | Flujo completo crear → escribir → respaldar → restaurar, clave de recuperación, validaciones, creación "todo o nada" |
| `nucleo-tools` | 1 | Cálculo de fechas del generador |
| Frontend | 3 | Formatos chilenos (CLP, RUT, tamaños) |

**Prueba manual en la app (2026-10-05, Linux):** crear negocio, clave de recuperación, agregar clientes
con validación de RUT, búsqueda sin tildes, respaldo verificado y auditoría íntegra. Capturas en
`docs/capturas-fase1/`. Se verificó que `company.db`, `-wal` y `-shm` no contienen texto legible.

## Casos golden

Los ejemplos numéricos de `02_INTELIGENCIA_COMERCIAL.md` son pruebas automáticas (`golden_*` en
`nucleo-domain`): stock futuro 120 y 518, disponible real 18, cobertura 30 días, riesgo de quiebre de
25 días y cliente en riesgo (72 vs. 25 días). Los casos tributarios y de COMEX se agregarán con revisión
del contador colaborador (D-07).

## Estrategia por fase

- **Unitarias** en el dominio para todo cálculo.
- **Integración** en `nucleo-app/tests` para cada flujo con base real cifrada.
- **Migraciones**: a partir de la primera beta, fixtures de cada versión publicada.
- **Rendimiento**: `seed` + `bench` (ver resultados en `DATABASE.md` §7). Para una prueba rápida:
  `cargo run --release -p nucleo-tools --bin seed -- /tmp/b.db 0.01 && cargo run --release -p nucleo-tools --bin bench -- /tmp/b.db`.
- **E2E de UI** (Fase 14): Tauri WebDriver en Windows. En desarrollo, `NUCLEO_EPHEMERAL_KEYS=1`
  (solo compilaciones debug) permite probar sin almacén de claves.
- **Prueba de corte** (Fase 14): matar el proceso durante escrituras y verificar integridad.
- **Cero red** (Fase 14): monitorear conexiones salientes durante la suite E2E.
