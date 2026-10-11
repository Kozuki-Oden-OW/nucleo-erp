# NÚCLEO ERP — Publicar la app móvil en Google Play y App Store

> Investigado el 2026-10-11, revisando las cuentas de FAVOR SpA (solo lectura) y la documentación
> oficial. Complementa `SINCRONIZACION.md` (diseño de la app, fases S0–S4).

## 1. Estado de las cuentas (FAVOR SpA)

| | Google Play Console | Apple (App Store Connect) |
|---|---|---|
| Tipo de cuenta | **Organización** (ID 7062309807444488432), verificada | **Organización** FAVOR SpA, Guardia Vieja 202 of. 403 |
| Apps existentes | FAVOR (`cl.favor.app`, en producción); Growcenter (retirada) | — |
| Verificación de desarrolladores de Android | Paquetes registrados | — |
| Acuerdo para apps gratuitas | — | Activo (17-09-2026 al 18-09-2027) |
| **Para cobrar** | **Falta crear el perfil de pagos** (cuenta de comerciante) | **Falta firmar el acuerdo para apps de pago**, luego datos bancarios y formulario fiscal de EE. UU. |
| Unión Europea | — | Falta declarar si es «comerciante» (DSA); se puede excluir la UE |

Al ser cuenta de organización, Google no exige la prueba cerrada de 12 personas por 14 días (esa regla
es para cuentas personales creadas después del 13-11-2023).

## 2. Lo que hace el dueño en las consolas (no lo hace Claude)

**Google Play**
1. Play Console → Ajustes → Perfil de pagos → **Crear perfil de pagos** (cuenta de comerciante con los
   datos de FAVOR SpA, RUT y cuenta bancaria en Chile).
2. Registrarse como contribuyente de IVA en Chile dentro del perfil (si no, Google cobra 19 % de IVA
   sobre su comisión).

**Apple**
1. App Store Connect → Negocio → **Acuerdo para apps de pago** → ver y aceptar.
2. **Datos bancarios** (cuenta de FAVOR SpA) y **formulario fiscal de EE. UU.** (el cuestionario
   normalmente lleva al W-8BEN-E para una sociedad extranjera).
3. **App Store Small Business Program**: inscribirse para pagar 15 % de comisión en vez de 30 %.
4. **DSA (UE)**: declarar si es comerciante (pide dirección, teléfono y correo públicos) o no
   distribuir en la UE.

## 3. Precio y comisiones

- **$1.000** es un precio válido en ambas tiendas (en Apple, Chile va de $190 a $11.999.990 con pasos
  de $1.000 en ese tramo; también sirve $990).
- Comisión: **15 %** en Google para el primer millón de dólares anual (tramo de 15 %) y **15 %** en
  Apple con el Small Business Program.
- **IVA (revisar con el contador):** Google indica que si el desarrollador está en Chile, **él
  determina, cobra y entera el IVA** de las ventas a clientes chilenos. En Apple, Apple actúa como
  vendedor; confirmar el tratamiento con el contador antes de publicar. Esto cambia el ingreso neto
  estimado en `SINCRONIZACION.md` §6.

## 4. Requisitos técnicos

| | Android | iOS |
|---|---|---|
| Formato | App Bundle (`tauri android build --aab`), primera subida a mano en la consola | IPA (`tauri ios build --export-method app-store-connect`) |
| Nivel de API | Desde el 31-08-2026 las apps nuevas deben apuntar a **Android 16 (API 36)** (prórroga posible al 01-11-2026) | Xcode y SDK vigentes de Apple |
| Equipo | Cualquier PC | **Requiere macOS con Xcode**: un Mac o un ejecutor macOS en GitHub Actions/Xcode Cloud |
| Firma | Clave de subida + Play App Signing | Certificado de distribución y perfil; clave de la API de App Store Connect para subir desde CI |
| Identificador | p. ej. `cl.nucleoerp.app` (igual en `tauri.conf.json`) | Bundle ID registrado en App Store Connect, igual al de `tauri.conf.json` |
| Pago | Compra de la app (precio en la tienda) | Compra de la app; verificación local con StoreKit 2 (D-SYNC-01) |
| Cifrado | — | Declarar uso de cifrado estándar (TLS, SQLCipher) en «cumplimiento de exportación» |

## 5. Ficha de la tienda (ambas)

- Nombre, descripción corta y larga, ícono 512×512 (Play) y 1024×1024 (Apple), capturas de teléfono
  (y tablet si se ofrece), gráfico destacado 1024×500 (Play).
- **URL de política de privacidad** (www.nucleoerp.cl/privacidad: la app no envía datos a NÚCLEO) y URL
  de soporte.
- Google: cuestionario de clasificación de contenido, formulario de **Seguridad de los datos**,
  público objetivo. Apple: **etiquetas de privacidad**, clasificación por edad, categoría
  (Productividad o Negocios).
- **Revisión:** la app debe poder probarse sin el computador. Se necesita un **modo demostración**
  dentro de la app (datos de ejemplo) y notas para el revisor explicando el emparejamiento por QR.

## 6. Orden sugerido

1. Construir la app (fases S0–S2 de `SINCRONIZACION.md`) con modo demostración.
2. Mientras tanto, el dueño completa §2 (perfil de pagos, acuerdo de pago, banco, impuestos, SBP) y
   consulta el IVA con el contador.
3. Android primero (prueba interna → cerrada → producción); iOS después con un ejecutor macOS en
   GitHub Actions.

## Fuentes

- Google: [prueba para cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465),
  [nivel de API objetivo](https://developer.android.com/google/play/requirements/target-sdk),
  [tipos de cuenta](https://support.google.com/googleplay/android-developer/answer/13628312),
  [comisiones](https://support.google.com/googleplay/android-developer/answer/112622),
  [impuestos por país (Chile)](https://support.google.com/googleplay/android-developer/answer/138000).
- Apple: [información fiscal](https://developer.apple.com/help/app-store-connect/manage-tax-information/provide-tax-information),
  [precios por país](https://www.apple.com/newsroom/pdfs/App-Store-Pricing-Update.pdf),
  [Small Business Program](https://adapty.io/blog/app-store-small-business-program/).
- Tauri: [App Store](https://v2.tauri.app/distribute/app-store/), [Google Play](https://v2.tauri.app/distribute/google-play/).
