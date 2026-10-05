# Seguridad — NÚCLEO ERP

## Modelo de amenazas (resumen)

| Amenaza | Protección |
|---|---|
| Robo o pérdida del computador / disco | Base cifrada (SQLCipher, AES-256); clave en el almacén seguro de Windows |
| Copia de un respaldo | `.erpbackup` cifrado con AES-256-GCM y clave derivada con Argon2id (64 MiB, 3 pasadas) |
| Respaldo alterado o dañado | Autenticación GCM + SHA-256 por archivo + validación de rutas (sin `..` ni rutas absolutas) |
| Edición de la base por fuera de NÚCLEO | Auditoría encadenada: `verify_chain` indica el primer registro alterado |
| Pérdida del almacén de claves (Windows reinstalado) | Clave de recuperación de 13 grupos entregada una sola vez al crear el negocio |
| Fuga de datos por red | Sin telemetría; CSP sin orígenes externos; capacidades Tauri sin HTTP ni shell |
| Base abierta desde carpeta de red | Rutas UNC rechazadas |
| Contenido malicioso en la interfaz | React escapa contenido; CSP estricta; sin `eval` ni recursos remotos |

## Reglas absolutas

- NÚCLEO **no** solicita, guarda ni transmite credenciales tributarias, ni se conecta a plataformas fiscales (ADR-003).
- Ninguna clave en texto plano en disco, registros (logs) o configuración.
- `DataKey` se borra de memoria al soltarse (escritura volátil).

## Limitaciones conocidas de la Fase 1 (a resolver en la Fase 13)

1. La clave de datos se guarda en el almacén de Windows **sin** envoltura adicional con la contraseña
   del administrador (aún no hay usuarios). Quien inicie sesión en la cuenta de Windows puede abrir NÚCLEO.
2. `app.db` (registro de negocios) guarda **nombre y carpeta** de cada negocio sin cifrar.
3. El respaldo se arma en memoria: para respaldos muy grandes se implementará cifrado por bloques.
4. Los adjuntos de `documents/` aún no se cifran por archivo (no hay adjuntos hasta la Fase 4).
5. La cadena hexadecimal de la clave usada en `PRAGMA key` vive brevemente en memoria sin borrado garantizado.
6. El instalador aún no está firmado (requiere certificado de firma de código).

## Dependencias

`cargo audit`/`cargo deny` y `pnpm audit` se agregan a la CI en la Fase 2. Cada dependencia nueva se
justifica en [DECISIONS.md](DECISIONS.md).

## Reportar vulnerabilidades

Mientras se habilita un canal oficial, reportar de forma privada al mantenedor del repositorio (no en
issues públicos).
