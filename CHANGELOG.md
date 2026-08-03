# CHANGELOG.md — NC Optimizaciones

Registro cronológico de cambios en el proyecto. Formato de cada entrada:
**Fecha · Archivos · Qué cambió · Por qué · Impacto.**

---

## 2026-08-03 — Sanitización de correo y WhatsApp

**Archivos:** `index.html`, `Code.gs`, `context.md`

**Qué cambió:** se agregó sanitización y límites de longitud a los campos
`correo` y `whatsapp` en el frontend y en el backend antes de enviarlos,
guardarlos o incluirlos en correos de notificación.

**Por qué:** cerrar los hallazgos críticos de seguridad de la Etapa 0
relacionados con valores sin limpiar que podían llegar a la planilla y a
las notificaciones.

**Impacto:** bajo riesgo; mejora la seguridad del flujo de reserva sin
cambiar la experiencia del usuario.

---

## 2026-08-03 — Documentación inicial del proyecto

**Archivos:** `context.md` (nuevo), `CHANGELOG.md` (nuevo)

**Qué cambió:** se creó la documentación base del repositorio: contexto
de negocio (qué hace la landing, objetivo, cliente ideal, flujo de
usuario, roadmap declarado), arquitectura técnica de `index.html`,
`Code.gs` y `_headers`, diagrama de flujo de datos, tecnologías
utilizadas, convenciones y estado actual (funciona / pendiente /
problemas conocidos).

**Por qué:** el proyecto no tenía ninguna documentación; cualquier sesión
nueva (de IA o de otro desarrollador) tenía que releer todo el código
para entender el contexto de negocio y la arquitectura.

**Impacto:** ninguno sobre el sitio en producción. Es documentación pura;
no se tocó `index.html`, `Code.gs` ni `_headers` en esta entrada.

---

## 2026-08-03 — Corrección de imagen de marca (og-image) y verificación de logo

**Archivos:** `og-image.jpg` (nuevo/reemplazado), `assets/logo.png`
(sin cambios de contenido, solo confirmado como correcto)

**Qué cambió:** se generó un nuevo `og-image.jpg` (1200×630) con el logo
real del sitio, el wordmark "NC" (azul) + "OPTIMIZACIONES" (blanco), una
barra azul centrada y el tagline "PERFORMANCE · PRECISION · SEGURIDAD",
sobre el mismo fondo oscuro con acento en la esquina que usa el resto del
sitio.

**Por qué:** el `og-image.jpg` anterior no se pudo verificar que existiera
en el dominio real (hallazgo de auditoría previa), y el logo del header
no se veía en el sitio en vivo porque `assets/logo.png` no estaba
desplegado en esa ruta en el hosting.

**Impacto:** visual/marketing únicamente. Afecta cómo se ve el logo en el
header/footer del sitio y cómo se ve la preview del link al compartirlo
en WhatsApp/Instagram/Discord. No afecta lógica ni datos. Pendiente de
acción del lado del dueño: subir ambos archivos al hosting en las rutas
correctas (`/assets/logo.png` y `/og-image.jpg` en la raíz).

---

## 2026-08-03 — Correcciones de auditoría: nombre de variable CSS, accesibilidad, autocomplete

**Archivos:** `index.html`

**Qué cambió:**
- Se renombró la variable CSS `--lime` (hex `#4FA8FF`, un azul) a
  `--accent`, en las 41 apariciones del archivo. Cambio puramente
  cosmético a nivel de código, sin impacto visual.
- Se agregó `aria-live="polite"` a los 5 mensajes de error del
  formulario (`.error-msg`) y a los `<h3>` de cada paso (1 a 4), para que
  un lector de pantalla anuncie errores de validación y cambios de paso.
- Se agregaron atributos `autocomplete` (`name`, `email`, `tel`) a los
  campos de nombre, correo y WhatsApp del formulario, y `autocomplete="off"`
  al campo de Discord.

**Por qué:** hallazgos de una auditoría de código previa (mantenibilidad
del nombre de variable confuso, accesibilidad del formulario para
usuarios de lector de pantalla, fricción de autocompletado del
navegador).

**Impacto:** bajo riesgo, sin cambios visuales ni de comportamiento
funcional. Mejora la accesibilidad y la velocidad de completado del
formulario. No se tocaron `Code.gs` ni `_headers` en esta entrada — los
hallazgos de esa misma auditoría sobre CSP (`'unsafe-inline'`), rate
limiting y permisos de Google Drive quedaron documentados como
pendientes intencionales (ver `context.md`, sección 6), no como bugs a
resolver ahora.

---

## Cómo agregar una entrada nueva

Cada vez que se complete una tarea sobre el proyecto, agregar una entrada
arriba (orden cronológico descendente) con este formato:

```
## AAAA-MM-DD — Título corto del cambio

**Archivos:** archivo1, archivo2

**Qué cambió:** ...

**Por qué:** ...

**Impacto:** ...
```

No hace falta texto largo — el objetivo es que alguien pueda escanear
este archivo y entender la evolución del proyecto sin leer código.
