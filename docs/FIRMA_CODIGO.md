# Firma de código y antivirus

## Por qué los antivirus bloquean el instalador

`NucleoERPSetup.exe` se publica **sin firma digital**. Windows SmartScreen y muchos antivirus
desconfían de los programas nuevos sin firma y sin "reputación", aunque sean seguros; los
instaladores NSIS (que usa Tauri) además suelen recibir falsos positivos por heurística. Lo que más
ayuda es **firmar** el instalador con un certificado de una autoridad reconocida y firmar siempre con
la misma identidad, para que la reputación se acumule de una versión a otra.

El instalador ya hace lo posible para no parecer sospechoso: se instala solo para el usuario (sin
permisos de administrador), declara nombre, versión, editor y sitio web en sus propiedades, no usa
compresores de ejecutables y se publica con su SHA-256.

## Opciones de firma (octubre 2026)

| Opción | Costo | ¿Sirve para NÚCLEO? |
|---|---|---|
| **SignPath Foundation** (proyectos de código abierto) | Gratis | **Sí, la recomendada.** NÚCLEO es AGPL (licencia OSI), se compila con GitHub Actions desde el repositorio público y ya tiene una versión publicada |
| Azure Artifact Signing (ex Trusted Signing) | ~USD 9,99/mes | No por ahora: organizaciones de EE. UU., Canadá, UE y Reino Unido; personas solo de EE. UU. y Canadá |
| Certificado OV (DigiCert, Sectigo…) | ~USD 150–300/año + token de hardware | Sí, en cualquier país, pero de pago y con token físico (complica firmar en la nube) |
| Certificado EV | USD 400+/año | Ya no evita SmartScreen al primer día (Microsoft lo quitó en 2024) |
| Microsoft Store (MSIX) | Gratis | A futuro: Microsoft firma el paquete; requiere empaquetar como MSIX |

Ninguna opción da confianza instantánea en SmartScreen: la reputación se gana con descargas y
firmando siempre con la misma identidad.

## Pasos para activar SignPath (los hace el dueño del repositorio)

1. Activa la **autenticación de dos factores** en tu cuenta de GitHub (SignPath la exige a todo el equipo).
2. Verifica que la página `https://www.nucleoerp.cl/firma/` esté publicada (política de firma de
   código: créditos a SignPath, roles del equipo y privacidad). Ya está en `apps/web/firma/`.
3. Postula en <https://signpath.org> ("Apply") con el repositorio `Kozuki-Oden-OW/nucleo-erp`.
   La SignPath Foundation revisa el proyecto; puede tardar algunas semanas.
4. Cuando te aprueben, en SignPath crea el proyecto `nucleo-erp` con una política de firma
   `release-signing` (aprobación manual) conectada a GitHub Actions, y genera un token de API.
5. En GitHub → Settings → Secrets and variables → Actions:
   - Variable `SIGNPATH_ORGANIZATION_ID` = el id de tu organización en SignPath.
   - Secreto `SIGNPATH_API_TOKEN` = el token.
   - (Opcional) variables `SIGNPATH_PROJECT_SLUG` y `SIGNPATH_POLICY_SLUG` si usaste otros nombres.
6. Publica una versión como siempre. `release.yml` envía el instalador a firmar, espera tu
   aprobación en SignPath, verifica la firma y publica el instalador firmado con su nuevo SHA-256.
   Sin esas variables, sigue publicando sin firma.

## Mientras tanto

- **Reportar falsos positivos:** sube el instalador oficial a
  <https://www.microsoft.com/wdsi/filesubmission> (Microsoft Defender, como "software developer",
  "incorrectly detected"). Si otro antivirus lo bloquea, usa su formulario de falso positivo; revisa
  primero en <https://www.virustotal.com> qué motores lo marcan.
- **Para quien instala:** la página de descarga explica cómo verificar el SHA-256 y cómo permitirlo
  en Defender ("Historial de protección → Permitir en el dispositivo").

## Fuentes

- Microsoft Learn, *Code signing options for Windows apps*: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- SignPath Foundation, condiciones: <https://signpath.org/terms>
