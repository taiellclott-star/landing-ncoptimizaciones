# Instrucciones para GitHub Copilot — NC Optimizaciones

Antes de responder o generar código en este repositorio, leé
`context.md` (arquitectura, flujo de datos, convenciones y estado
actual del proyecto) y `CHANGELOG.md` (historial de cambios). No asumas
nada sobre el negocio o la arquitectura que ya esté documentado ahí.

## Reglas de este proyecto

- Es un sitio estático (HTML/CSS/JS vanilla, sin build step) desplegado
  en Cloudflare. `Code.gs` pertenece a Google Apps Script y **no se
  despliega junto al sitio** — cualquier cambio ahí hay que avisarlo
  explícitamente porque se copia a mano del vscode al editor de Apps Script.
- El backend (`Code.gs`) revalida todo lo que ya valida el frontend
  (formato de fecha, email, rango horario, tipo de archivo). Si cambiás
  una validación, cambiala en los dos lados.
- Hay valores duplicados a propósito entre `index.html` y `Code.gs`
  (duración de planes, rango horario de atención) marcados con `⚠️` en
  los comentarios. Si tocás uno, tocá el otro.
- No cambies la CSP de `_headers` (`'unsafe-inline'`) sin avisar — es
  una decisión de arquitectura conocida, no un error, y sacarla requiere
  migrar los `onclick` inline primero.
- Todo el contenido visible y los comentarios de código van en español.

## Después de cada cambio

Nunca termines una tarea sin:
1. Actualizar `context.md` si cambió algo de arquitectura, estado actual
   o convenciones (sin borrar información histórica, solo actualizarla).
2. Recordar actualizar a la par `Code.gs` en caso de ser necesario


Si una tarea es puramente exploratoria (responder una pregunta, revisar
código sin modificarlo), no hace falta tocar ninguno de los dos archivos.
