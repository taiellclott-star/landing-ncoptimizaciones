# context.md — NC Optimizaciones

> Este archivo es la fuente principal de contexto del proyecto. Cualquier
> sesión de IA o desarrollador que retome el trabajo debería poder leer
> **solo este archivo y el `CHANGELOG.md`** y entender el proyecto sin
> tener que re-analizar todo el repositorio desde cero.
>
> Última actualización: 2026-08-04

---

## 1. Descripción del proyecto

### Qué hace la landing
Es la landing page de **NC Optimizaciones**, un servicio de optimización
remota de PC orientado a gaming. El objetivo funcional de la página es
llevar a personas interesadas a **sacar un turno** para que el dueño del
servicio optimice su PC de forma remota (por AnyDesk).

### Objetivo de negocio
Generar confianza y atención sobre el servicio, y convertir esa atención
en reservas de turno hechas directamente desde la landing.

### Problema que resuelve
Mejora la estabilidad del sistema, los FPS y la conexión de internet,
siguiendo un enfoque que el dueño considera más seguro que otros métodos
de optimización: **no toca componentes críticos del sistema operativo**,
a diferencia de otros servicios que "rompen" funciones cotidianas de
Windows a cambio de más rendimiento.

### Cliente ideal
- Edad aproximada: 13 a 25 años.
- Perfil: alguien centrado en el gaming, o con una PC de gama media/baja
  que busca ganar FPS "de donde sea".
- Nivel de PC: cualquiera — el servicio se adapta a cualquier nivel de
  optimización necesario.

### Flujo esperado del usuario (customer journey, no solo el flujo técnico)
1. El usuario descubre el servicio por **Instagram, TikTok o YouTube**,
   donde el dueño sube videos cortos / tips de optimización.
2. Instagram es el canal central: es donde se espera el mayor flujo de
gente junto con TikTok, y el contacto por mensajes privados (DM) es el
canal principal de atención.
3. El interesado escribe por Instagram, o entra directamente a la
landing, gana confianza, y **reserva turno y paga desde ahí**.
4. Coordinación de la sesión por Instagram DM/Discord y ejecución remota
vía AnyDesk.
### Funcionalidades futuras (roadmap declarado por el dueño del negocio)
Una vez que el negocio prospere, se piensa en:
- Bot que responda mensajes automáticamente en redes sociales.
- Un backend más robusto (ver sección 7 para sugerencias concretas).
- Poder ver/gestionar la lista de reservas desde cualquier lugar, no solo
  abriendo el Google Sheet manualmente.
- Rehacer el sistema de toma de turnos actual, que hoy se percibe como
  "precario" (ver sección 6 y 7).
- Comprar un dominio propio `.com` (hoy el sitio corre en un subdominio
  gratuito de Cloudflare Workers).- Implementar recordatorios automáticos y un PWA para “agregar a inicio”
en mobile (ya incorporados en esta etapa como base funcional).
---

## 2. Arquitectura del proyecto

El repositorio es **estático + serverless**: no hay backend propio, todo
el "servidor" es Google Apps Script actuando como intermediario hacia
Google Sheets.

### `index.html`
- Es la landing page principal y el **único archivo de frontend**.
- Contiene HTML, todo el CSS (en un único `<style>` inline en el
  `<head>`) y todo el JavaScript (en un `<script>` al final del body),
  no hay archivos `.css` ni `.js` separados.
- Maneja toda la experiencia de usuario: hero, planes, FAQ, y el
  **formulario de reserva multi-paso** (4 pasos: datos personales →
  fecha/horario → pago y comprobante → confirmación + datos opcionales).
- Desde acá se hacen los `fetch()` hacia la Web App de Google Apps
  Script: un `GET` para consultar turnos ocupados de un día
  (`doGet`) y dos tipos de `POST` (`type: 'reserva'` y
  `type: 'extra'`) que van a `doPost`.
- Incluye JSON-LD (`Service` y `FAQPage`) para SEO, Open Graph y Twitter
  Cards para previews al compartir el link.
- Variables CSS clave en `:root` (`--bg`, `--panel`, `--accent`,
  `--amber`, `--text`, `--muted`, fuentes, radios). **Importante:** la
  variable de color de marca se llama `--accent` (antes se llamaba
  `--lime` por error histórico — hex `#4FA8FF`, que en realidad es azul,
  no lima; se corrigió el nombre el 2026-08-03, ver `CHANGELOG.md`).

### `Code.gs`
- Pertenece a **Google Apps Script**, no al frontend.
- El flujo de reserva ahora exige también un usuario de Instagram como dato de contacto principal, y el campo se guarda en la planilla y se incluye en las notificaciones.
- **No se despliega junto al sitio estático**: hay que copiar su
  contenido manualmente al editor de Apps Script del proyecto vinculado
  a la Google Sheet (`SPREADSHEET_ID` hardcodeado al inicio del archivo),
  y publicarlo ahí como Web App para obtener la URL que el frontend usa
  en sus `fetch()`.
- Es el encargado de **toda la comunicación entre la landing y la "base
  de datos"** (Google Sheets): validación de datos, chequeo de
  conflictos de horario, guardado de reservas, guardado de datos extra,
  envío de notificaciones por mail, y manejo de comprobantes de pago
  (los sube a Google Drive).
- Funciones principales:
  - `doGet(e)` — devuelve los turnos ya ocupados de una fecha dada, más
    `PLAN_DURATION` (para que el frontend no tenga que hardcodear la
    duración de cada plan y ambos lados queden sincronizados).
  - `doPost(e)` — punto de entrada de escritura. Usa `LockService` para
    evitar condiciones de carrera entre reservas simultáneas. Según
    `data.type` deriva a la lógica de `reserva` o `extra`.
  - `validarReserva(data)` / `sanitizarTexto(v, maxLen)` — validación y
    limpieza de los datos que llegan del formulario (nunca confía en lo
    que valida el HTML del lado del cliente).
  - `verificarRecaptcha(token)` — valida reCAPTCHA v3 contra la API de
    Google (la secret key vive en Script Properties, no hardcodeada).
  - `excedeFrecuencia(data)` — rate limiting simple por correo/WhatsApp
    (3 intentos / 10 min). Ver limitación conocida en sección 6.
  - `hayConflicto(sheet, data)` — chequea que el horario elegido no
    choque con otra reserva ya guardada.
  - `guardarReserva(ss, data)` / `guardarDatosExtra(ss, data)` — escriben
    filas en las pestañas correspondientes del Sheet. `guardarReserva`
    también sube el comprobante de pago a Drive
    (`DriveApp.Access.ANYONE_WITH_LINK`, ver sección 6).
  - `enviarNotificacion(data)` — manda mail a
    `taiellclott@gmail.com,taieljuega@gmail.com` cuando entra una
    reserva o datos extra.
  - `rangoAtencion(fecha)` — define el rango horario de atención según
    el día (semana: 18–22 hs, fin de semana: 13–18 hs). **Está
    duplicado a propósito** en `index.html` (`dayRange()`) para que el
    frontend muestre los horarios correctos sin depender de una llamada
    al backend, pero el backend vuelve a validar por si alguien llama al
    endpoint directamente sin pasar por la UI. Si se cambia un lado, hay
    que cambiar el otro (está comentado en el código con un `⚠️`).
  - Funciones de test manual (`testEscritura`, `testNotificacion`,
    `testDoGet`) para probar desde el editor de Apps Script sin pasar
    por el frontend.
- Cualquier cambio relacionado con la comunicación entre la página y
  Google Sheets **casi seguro va a requerir tocar este archivo**, y
  después **copiar el cambio a mano** al proyecto real de Apps Script
  (no hay despliegue automático de este archivo).

### `_headers`
- Es un archivo de configuración de **Cloudflare** (headers HTTP),
  no de la aplicación en sí.
- Define, entre otras cosas:
  - **Content-Security-Policy (CSP)**: restringe de dónde puede cargar
    scripts, estilos, fuentes, imágenes y conexiones el sitio. Hoy
    incluye `'unsafe-inline'` en `script-src` y `style-src` porque
    `index.html` usa atributos `onclick="..."` inline y un único
    `<style>` inline gigante (ver sección 6, mejora pendiente no
    urgente).
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy`, `Permissions-Policy` — headers de hardening
    estándar.
- Afecta al despliegue: Cloudflare lee este archivo automáticamente al
  servir el sitio estático y aplica esos headers a **todas** las
  respuestas (el patrón `/*` cubre todo el sitio).
- **Nota sobre el hosting real:** el dominio actual es
  `nc-optimizaciones.taiellclott.workers.dev` — un subdominio de
  **Cloudflare Workers** (`.workers.dev`), no necesariamente un proyecto
  clásico de "Cloudflare Pages" (`.pages.dev`). Cloudflare unificó Pages
  y Workers con "assets" estáticos, y `_headers` funciona en ambos casos,
  pero conviene confirmar en el dashboard de Cloudflare bajo qué producto
  exacto está creado el proyecto (Workers vs Pages) antes de configurar
  integración con GitHub, para seguir la guía correcta.

### Otros archivos del proyecto (assets de marca)
- `assets/logo.png` — logo horizontal (625×200, PNG con transparencia),
  usado en el header y footer del sitio (`<img class="logo-mark-img">`).
- `og-image.jpg` — imagen de preview para redes sociales (1200×630),
  referenciada en la raíz del dominio por los meta tags Open Graph /
  Twitter Card. **Debe vivir en la raíz del sitio**, no en `assets/`,
  porque así lo referencia el `<meta property="og:image">`.
- No existen todavía `_redirects`, `manifest.json`, `robots.txt` ni
  `sitemap.xml` en este repositorio. Se documentarán acá apenas se
  agreguen.

---

## 3. Flujo del proyecto

```
Usuario
  │
  ▼
Landing (index.html) — ve el sitio, completa el formulario de reserva
  │
  ▼
fetch() — POST (type: 'reserva' o 'extra') / GET (turnos ocupados)
  │
  ▼
Google Apps Script (Code.gs desplegado como Web App)
  │  - valida los datos (nunca confía en la validación del navegador)
  │  - verifica reCAPTCHA v3
  │  - chequea rate limiting y conflictos de horario
  │  - sube el comprobante de pago a Google Drive
  │
  ▼
Google Sheets — se guarda la fila de la reserva / de los datos extra
  │
  ▼
Respuesta ({ ok: true/false, ... }) + email de notificación al dueño
  │
  ▼
Landing — muestra el paso de confirmación o el mensaje de error
```

En palabras: la landing nunca habla directo con Google Sheets. Todo pasa
por Apps Script, que actúa como una API intermedia: valida lo que manda
el formulario, decide si se guarda o se rechaza (turno ocupado, rate
limit, bot sospechoso), guarda la fila en la pestaña correspondiente del
Sheet, sube el comprobante a Drive, y devuelve un JSON simple
(`{ok: true}` o `{ok: false, reason, error}`) que el JavaScript de
`index.html` usa para avanzar al paso de confirmación o mostrar el
mensaje de error correspondiente.

---

## 4. Tecnologías utilizadas

- **HTML5** — estructura de la landing (`index.html`).
- **CSS3** — un único bloque `<style>` inline, con variables CSS
  (`:root`), grid/flexbox, animaciones respetando
  `prefers-reduced-motion`.
- **JavaScript vanilla** (sin frameworks, sin build step) — manejo del
  formulario multi-paso, validaciones, `fetch()` hacia Apps Script,
  compresión de imágenes en el navegador (canvas) antes de subir el
  comprobante, animaciones de conteo con `IntersectionObserver`.
- **Google Apps Script** (`Code.gs`) — backend serverless.
- **Google Sheets** — base de datos (pestañas "Reservas" y datos extra).
- **Google Drive** — almacenamiento de comprobantes de pago.
- **Google reCAPTCHA v3** — anti-bot en el envío del formulario.
- **Hosting:** Cloudflare (Workers/Pages con `_headers` para configurar
  CSP y otros headers HTTP). Dominio actual:
  `https://nc-optimizaciones.taiellclott.workers.dev` (subdominio
  gratuito — no hay dominio propio comprado todavía).
- **Google Fonts:** Space Grotesk, Inter, JetBrains Mono (cargadas por
  `<link>` a `fonts.googleapis.com`).
- **Repositorio:** Git, alojado en GitHub (recién creado, ver sección 7
  para la estructura sugerida).

---

## 5. Convenciones del proyecto

- **Idioma:** todo el contenido visible y los comentarios de código
  están en español (rioplatense).
- **Estilo de código:** JavaScript en `var` (no `let`/`const`), funciones
  con nombres descriptivos en español (`showStep`, `validateStep`,
  `submitReserva`, `fileChosen`, `guardarReserva`, `validarReserva`,
  etc.). No hay linter ni formateador configurado.
- **CSS:** variables centralizadas en `:root`; nombres de variable en
  inglés corto (`--bg`, `--panel`, `--line`, `--accent`, `--text`,
  `--muted`). Evitar nombres de color que describan un color distinto al
  real (ver corrección de `--lime` → `--accent`).
- **Estructura de carpetas actual:**
  ```
  /
  ├── index.html
  ├── Code.gs           (mirror local; el real vive en Apps Script)
  ├── _headers
  ├── assets/
  │   └── logo.png
  ├── og-image.jpg
  ├── context.md
  └── CHANGELOG.md
  ```
- **Buenas prácticas ya presentes en el código** (para no romperlas sin
  querer):
  - El backend **revalida todo** lo que el frontend ya validó (rango de
    horario, tipo de archivo del comprobante, formato de fecha/email),
    porque cualquiera puede llamar al endpoint directo sin pasar por la
    UI.
  - Valores que existen "espejados" en frontend y backend (duración de
    planes, rango horario de atención) están marcados con comentarios
    `⚠️` indicando que hay que cambiar ambos lados a la vez.
  - El honeypot (`empresaWeb`) simula éxito en vez de mostrar error,
    para no delatarle al bot que fue detectado.
- **Dependencias:** ninguna — no hay `package.json`, no hay build step,
  es HTML/CSS/JS servido tal cual.

---

## 6. Estado actual

### Qué funciona
- Landing completa con hero, planes, FAQ y formulario de reserva
  multi-paso (4 pasos).
- Validación de formulario en el cliente y revalidación en el servidor.
- Reserva de turno con chequeo de conflictos de horario y con
  reCAPTCHA v3 anti-bot.
- Subida de comprobante de pago (imagen o PDF) con compresión de
  imágenes en el navegador antes de enviarlas.
- Registro en Google Sheets y notificación por email al dueño.
- Paso "extra" opcional para recolectar estadísticas (país, edad,
  género, juego principal) después de confirmar la reserva.
- Accesibilidad: `aria-live` en mensajes de error y títulos de paso,
  `autocomplete` en campos de nombre/correo/teléfono (agregado
  2026-08-03).
- Sección simple de contenido legal en la landing con aclaración sobre
  resultados, política de privacidad y términos/reprogramación.
- Sanitización y validación de `correo` y `whatsapp` en frontend y
  backend antes de enviarlos, guardarlos o incluirlos en notificaciones.
- SEO/social: JSON-LD, Open Graph, Twitter Card. `og-image.jpg`
  rediseñado con la marca real (2026-08-03).

### Qué está pendiente
- **Dominio propio:** hoy corre en un subdominio gratuito de Cloudflare
  Workers; falta comprar un `.com`.
- **Repo en GitHub sin estructura formal todavía** — recién se creó, ver
  sugerencias de la sección 7.
- **Toma de turnos** percibida como "precaria" por el dueño del negocio
  — el flujo funciona, pero la experiencia/visual se puede mejorar (ver
  sección 7 para ideas concretas).
- Migrar los `onclick` inline y el `<style>` inline a archivos externos
  para poder eliminar `'unsafe-inline'` de la CSP (mejora de seguridad
  en profundidad, no urgente — documentado desde la auditoría previa).

### Problemas conocidos
- **CSP con `'unsafe-inline'`** en `script-src` y `style-src`: es
  consecuencia directa de usar `onclick` inline y un `<style>` inline
  gigante. No es un error de config, es una decisión de arquitectura
  actual. Impacto bajo hoy, relevante solo si en el futuro se agrega
  contenido dinámico de terceros.
- **Rate limiting bypasseable**: `excedeFrecuencia()` usa correo o
  WhatsApp como clave, así que alguien puede variar esos datos en cada
  intento y saltarse el límite. Impacto bajo porque reCAPTCHA v3 es la
  defensa principal; esto es una capa extra, no la única.
- **Comprobantes de pago compartidos como "cualquiera con el link"** en
  Drive (`DriveApp.Access.ANYONE_WITH_LINK`). Mitigado por lo
  impredecible del link, pero es una decisión a tener presente si en
  algún momento se comparte el Sheet con más gente.
- **Sin backend propio ni panel de administración**: la única forma de
  ver las reservas hoy es abrir el Google Sheet manualmente.

---

## 7. Sugerencias para las próximas etapas (roadmap técnico)

Esto es una propuesta, no algo ya decidido — para ir evaluando a medida
que el negocio crezca:

1. **Ordenar el repo en GitHub ahora, mientras es chico:**
   - Repo único, rama `main` = lo que está en producción.
   - Trabajar cambios en ramas cortas (`feature/...` o directamente en
     `main` si el equipo es solo el dueño) y hacer commits chicos y
     descriptivos.
   - Conectar el repo de GitHub directamente al proyecto de Cloudflare
     (Workers/Pages tienen integración nativa con GitHub): cada `push` a
     `main` dispara un deploy automático. Esto resuelve el problema de
     "trabajar desde casa, el trabajo, etc." sin tener que subir archivos
     a mano desde el dashboard de Cloudflare cada vez.
   - Mantener `Code.gs` en el repo como **espejo versionado**, aclarando
     siempre en el propio archivo y en `context.md` que hay que copiarlo
     a mano al editor de Apps Script después de cada cambio (Apps Script
     no se actualiza solo desde GitHub a menos que se configure `clasp`,
     la herramienta de línea de comandos oficial de Google para
     versionar Apps Script — se puede evaluar más adelante si el
     proyecto crece).

2. **Backend / panel de administración**, cuando el volumen lo
   justifique:
   - Antes de programar un backend propio, evaluar si alcanza con una
     vista mejor del Google Sheet (Google Sheets ya se puede ver desde
     el celular con la app oficial) o un dashboard simple hecho con
     Google Apps Script + `HtmlService` (sigue siendo gratis, sin
     backend nuevo que mantener).
   - Si el negocio crece y hace falta algo más robusto: una base de
     datos real (ej. Airtable, o Postgres en un proveedor gratuito) más
     un panel liviano, recién ahí se justifica salir de Google
     Sheets/Apps Script.

3. **Bot de respuesta automática en redes**, más adelante: es un
   proyecto aparte (requiere Meta Business API para Instagram/WhatsApp,
   o servicios como Manychain/Chatfuel). No es necesario para las
   primeras etapas del negocio.

4. **Rehacer la experiencia de toma de turnos**: se puede iterar el
   formulario actual (mejoras visuales incrementales) antes de
   reescribirlo desde cero — el flujo de datos con Apps Script/Sheets ya
   funciona y no hace falta tirarlo para mejorar la parte visual.

5. **Dominio propio**: una vez comprado, se configura como dominio
   personalizado del proyecto de Cloudflare (reemplaza al subdominio
   `.workers.dev`) sin tocar código.

---

## Cómo mantener este archivo

- Cada vez que se modifica el proyecto, esta sección de `context.md`
  correspondiente **debe reflejar el estado real** (arquitectura, estado
  actual, problemas conocidos).
- No se borra información histórica relevante; se actualiza o se agrega
  una nota nueva.
- El detalle línea-por-línea de cada cambio va en `CHANGELOG.md`, no
  acá — este archivo es el panorama general, no un historial.
