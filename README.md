# NÚCLEO ERP

> **Todo tu negocio. Un solo núcleo.**
> Privado. Local. Simple. — Desde tu primera venta hasta tu empresa.
> **Tu negocio. Tus datos. Tu computador.**

NÚCLEO ERP es un software de gestión **gratuito, de código abierto y local** para emprendedores,
personas con inicio de actividades y empresas chilenas. Funciona sin Internet, guarda todo cifrado en
el computador del usuario y **no es un sistema tributario**: no emite documentos tributarios, no pide
credenciales y no se conecta con plataformas fiscales.

| | |
|---|---|
| Estado | **Fase 2 completa** (modelo de datos). Aún no apto para uso productivo. |
| Sitio | [www.nucleoerp.cl](https://www.nucleoerp.cl) (`apps/web`) |
| Plataforma | Windows 10/11 x64 (macOS y Linux más adelante) |
| Licencia | [AGPL-3.0-or-later](LICENSE) |
| Modelo | Gratis, sin licencias ni activación. Donaciones voluntarias. |

## Documentos del proyecto

| Documento | Contenido |
|---|---|
| [docs/01_VISION_PRODUCTO.md](docs/01_VISION_PRODUCTO.md) | Visión oficial del producto (documento rector) |
| [docs/02_INTELIGENCIA_COMERCIAL.md](docs/02_INTELIGENCIA_COMERCIAL.md) | Especificación de inteligencia comercial |
| [docs/00_BLUEPRINT_MAESTRO.md](docs/00_BLUEPRINT_MAESTRO.md) | Blueprint Maestro v1.0 (aprobado) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura y estructura del código |
| [docs/DATABASE.md](docs/DATABASE.md) | Base de datos, migraciones y reglas |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Registro de decisiones (ADR) y dependencias |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Fases y estado |
| [docs/SECURITY.md](docs/SECURITY.md) | Cifrado, claves, respaldos, auditoría |
| [docs/TESTING.md](docs/TESTING.md) | Estrategia y cómo ejecutar las pruebas |
| [docs/TAX_RULES.md](docs/TAX_RULES.md) · [docs/COMEX_RULES.md](docs/COMEX_RULES.md) | Política de normativa versionada |
| [docs/WEB.md](docs/WEB.md) | Sitio web, DNS y publicación de descargas |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Cambios por versión |

## Estructura

```
crates/nucleo-domain   cálculos puros: dinero, RUT, totales, inventario, estados de venta
crates/nucleo-rules    normativa versionada con vigencia y fuente obligatoria
crates/nucleo-db       SQLite + SQLCipher, migraciones, auditoría encadenada, búsqueda FTS5
crates/nucleo-io       formato de respaldo .erpbackup
crates/nucleo-app      casos de uso: negocios, clientes, respaldos, claves
apps/desktop           aplicación de escritorio (Tauri 2 + React + TypeScript)
apps/web               sitio www.nucleoerp.cl (estático, sin rastreadores)
tools/nucleo-tools     seed (datos masivos), bench (rendimiento), rules (firma de normativa)
docs/                  documentación y decisiones
```

## Desarrollo

Requisitos en Windows: [Rust](https://rustup.rs) (la versión exacta la fija `rust-toolchain.toml`),
Node.js 22+, pnpm 10+, *Build Tools for Visual Studio* (C++) y Strawberry Perl (lo usa la compilación
de OpenSSL que incluye SQLCipher). WebView2 viene con Windows 11.

```bash
# Pruebas de toda la lógica (Rust)
cargo test --workspace

# Aplicación de escritorio en modo desarrollo
cd apps/desktop
pnpm install
pnpm tauri dev

# Instalador Windows (NSIS)
pnpm tauri build
```

La integración continua (`.github/workflows/ci.yml`) compila, prueba y genera `NucleoERPSetup.exe`
en Windows en cada cambio.

## Principios que el código debe respetar

1. Sin conexión a plataformas fiscales, sin credenciales tributarias, sin emisión de documentos tributarios.
2. Ningún valor normativo (tasas, topes, tablas) escrito en el código: todo viene de `nucleo-rules` con fuente.
3. Dinero como enteros en unidad mínima y decimales exactos; nunca `f64`.
4. Todo cambio de datos ocurre en una transacción que incluye su registro de auditoría.
5. Cero telemetría. Cualquier conexión saliente futura es opcional y explícita.
