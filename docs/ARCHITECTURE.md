# Arquitectura — NÚCLEO ERP

Resumen operativo de la arquitectura aprobada en el Blueprint Maestro v1.0 (§2, §11, §12) y de cómo
quedó implementada en la Fase 1.

## 1. Estilo

**Monolito modular hexagonal** en un solo proceso de escritorio. Sin servidores, sin microservicios.

```
UI (React + TypeScript, WebView2)
   │  IPC de Tauri (comandos)            apps/desktop/src/lib/api.ts  ⇄  src-tauri/src/commands.rs
   ▼
Capa Tauri (delgada)                     apps/desktop/src-tauri
   ▼
nucleo-app   casos de uso, transacciones, auditoría, claves, respaldos
   ├── nucleo-domain   cálculos puros (sin IO)
   ├── nucleo-rules    normativa versionada
   ├── nucleo-io       formatos de archivo (.erpbackup)
   └── nucleo-db       SQLite + SQLCipher
```

## 2. Reglas de dependencia

| Crate | Puede depender de | No puede |
|---|---|---|
| `nucleo-domain` | nada interno | IO, base de datos, Tauri |
| `nucleo-rules` | nada interno | IO de red |
| `nucleo-db` | — | lógica de negocio |
| `nucleo-io` | — | base de datos |
| `nucleo-app` | todos los anteriores | Tauri |
| `src-tauri` | `nucleo-app` | reglas de negocio |

- La UI **nunca** decide permisos ni calcula montos que se guardan: el backend recalcula siempre.
- `src-tauri/src/commands.rs` solo traduce: recibe parámetros, llama a `nucleo-app`, devuelve
  resultados o `{ code, message }`.

## 3. Datos en disco

```
%LOCALAPPDATA%\NucleoERP\
├─ app.db                         registro de negocios (nombre, perfil, carpeta). Sin datos de negocio.
└─ companies\<uid>\
   ├─ company.db (+ -wal, -shm)   base cifrada con SQLCipher
   └─ documents\                  adjuntos (cifrado por archivo: Fase 13)
Documentos\NUCLEO ERP Respaldos\  respaldos .erpbackup
```

Las claves de datos se guardan en el **Windows Credential Manager** (servicio `NucleoERP`, una entrada
por negocio).

## 4. Concurrencia y transacciones

- SQLite en modo **WAL**, `foreign_keys = ON`, `synchronous = NORMAL`, `busy_timeout = 5 s`.
- Fase 1: una conexión por negocio abierto, protegida por `Mutex` en el estado de Tauri.
- Fase 2/4: hilo escritor dedicado + lectores para listas grandes (Blueprint §2.3).
- Cada caso de uso que escribe usa **una transacción** con el cambio + `audit_log`.

## 5. Números

- Dinero: `i64` en unidad mínima de la moneda (`nucleo_domain::money::Money`).
- Cálculo: `rust_decimal` (exacto). Redondeo y alcance del redondeo son **parámetros**.
- Fechas de registro: UTC RFC 3339. Fechas contables: `DATE` local (desde Fase 2).

## 6. Frontend

- React 19 + TypeScript estricto + Vite + Tailwind CSS 4 (tokens claro/oscuro en `src/styles.css`).
- Contrato IPC en `src/lib/api.ts` (tipos espejados a mano en Fase 1; ver DECISIONS D-F1-03).
- Sin recursos externos: la CSP solo permite `self` e IPC.

## 7. Seguridad de la aplicación

- Capacidades Tauri mínimas (`capabilities/default.json`): `core:default` y `dialog:allow-open`.
  Sin shell, sin HTTP, sin acceso libre al sistema de archivos.
- Validación de entradas en Rust (nombre, RUT con módulo 11, correo).
- Rutas UNC (`\\servidor\...`) rechazadas: SQLite por red corrompe datos.

## 8. Herramientas y sitio

- `tools/nucleo-tools`: `seed` (datos masivos), `bench` (metas de rendimiento), `explain` (planes de
  consulta), `rules` (claves y firma de paquetes normativos). No se distribuyen con la aplicación.
- `apps/web`: sitio estático www.nucleoerp.cl, construido por `tools/build_web.py` (ver `WEB.md`).

## 9. Lo que falta (por fase)

Ver [ROADMAP.md](ROADMAP.md). Los puntos abiertos de arquitectura son: hilo escritor y `tauri-specta`
(Fase 4), usuarios/roles (Fase 4), PDF (Fase 5), cifrado de adjuntos y respaldo por bloques (Fase 13).
