# NC Optimizaciones — Migración a Supabase

Reemplaza Apps Script + Google Sheets por Supabase (Postgres + Storage + Edge Functions) + Resend para mails.

## Qué reemplaza a qué

| Antes (Apps Script) | Ahora (Supabase) |
|---|---|
| Pestaña "Reservas" | Tabla `reservas` |
| Pestaña "Datos extra" | Tabla `datos_extra` |
| Pestaña "Reseñas" | Tabla `resenas` |
| Carpeta de Drive con comprobantes | Bucket `comprobantes` (Storage, privado) |
| `doGet` / `doPost` | Edge Function `reservas` |
| Trigger `enviarRecordatoriosTurno` (cada 15 min) | Edge Function `recordatorios` + Supabase Cron |
| `MailApp.sendEmail` | Resend (API) |
| Vos revisando el Sheet a mano | `admin/index.html` (panel con login) |

## Orden de deploy

### 1. Correr la migración SQL
Dashboard de Supabase → **SQL Editor** → pegá el contenido de `supabase/migrations/0001_init.sql` → Run.
Esto crea las 3 tablas, el bucket `comprobantes` y las políticas de RLS.

### 2. Crear tu usuario de admin
Dashboard → **Authentication → Users → Add user** → creá tu usuario (el correo/contraseña con el que vas a entrar al panel). No hace falta que la gente se registre, es solo para vos.

### 3. Deployar las Edge Functions
Como ya conectaste el repo de GitHub con Supabase, puede que se auto-deployen al hacer push a `main` (revisá en Integrations si "Deploy to production" incluye Edge Functions, si no, usá la CLI):

```bash
npm install -g supabase
supabase login
supabase link --project-ref TU-PROJECT-REF
supabase functions deploy reservas
supabase functions deploy recordatorios
```

### 4. Configurar los Secrets de las funciones
Dashboard → **Edge Functions → Secrets** (o `supabase secrets set`):

```bash
supabase secrets set RECAPTCHA_SECRET_KEY=tu_secret_key_de_recaptcha
supabase secrets set RESEND_API_KEY=tu_api_key_de_resend
supabase secrets set MAIL_NOTIFICACION="taielclott@gmail.com,taieljuega@gmail.com"
supabase secrets set MAIL_FROM="NC Optimizaciones <reservas@tudominio.com>"
```

> `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen seteadas automáticamente en las Edge Functions, no hace falta configurarlas.

**Sobre Resend:** creá cuenta gratis en resend.com, verificá un dominio (o usá el subdominio de prueba que te dan al principio, sirve para testear pero conviene el propio para producción) y generá un API key.

### 5. Configurar el Cron para los recordatorios
Dashboard → **Database → Cron Jobs** (usa pg_cron + pg_net por debajo) → **Create a new cron job**:
- Name: `recordatorios-turno`
- Schedule: `*/15 * * * *` (cada 15 min)
- Type: HTTP Request
- Method: POST
- URL: `https://TU-PROYECTO.supabase.co/functions/v1/recordatorios`
- Headers: `Authorization: Bearer TU-ANON-KEY` (o el service role si preferís)

### 6. Completar las variables en el frontend
En `frontend/script.js`, reemplazá:
```js
var SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
var SUPABASE_ANON_KEY = 'TU-ANON-KEY-ACA';
```
con los valores de Dashboard → **Settings → API Keys** (la **anon public**, nunca la service_role acá).

Agregá también en tu `index.html`, antes de `<script src="script.js">`, el cliente de Supabase:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="script.js"></script>
```

Reemplazá el `script.js` viejo por el de `frontend/script.js` de este paquete (o mergeá los cambios si le hiciste ajustes propios).

### 7. Completar las variables en el panel de admin
En `admin/index.html`, mismos valores:
```js
var SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
var SUPABASE_ANON_KEY = 'TU-ANON-KEY-ACA';
```
Subilo a tu repo (ej: como ruta `/admin`) y andá a `tudominio.com/admin` para entrar con tu usuario.

### 8. Deployar en Vercel
Con el repo ya conectado, un `git push` a `main` dispara el deploy automático tanto de la landing como del `/admin`.

## Testing antes de dar por cerrada la migración
- [ ] Completar una reserva de prueba de punta a punta (subida de comprobante incluida)
- [ ] Verificar que la fila aparece en el panel de admin
- [ ] Verificar que te llega el mail de notificación de nueva reserva
- [ ] Verificar que el link "Ver" del comprobante en el panel abre el archivo
- [ ] Probar reservar el mismo turno dos veces (debería rechazar la segunda con "Ese turno ya no está disponible")
- [ ] Esperar (o simular) que falte ~30 min para un turno de prueba y confirmar que llega el recordatorio
- [ ] Dejar una reseña de prueba y confirmar que llega el mail y aparece en `resenas`

## Notas
- El bucket `comprobantes` es **privado**: nadie puede ver los archivos con la URL directa, ni siquiera vos, sin generar un "signed URL" temporal (eso ya lo hace el botón "Ver" del panel).
- Las tablas tienen RLS activado: solo tu usuario autenticado puede leerlas desde el panel. Los INSERT los hace únicamente la Edge Function con la service_role key, así que nadie puede escribir basura directo a la base saltándose las validaciones.
- Si en algún momento querés dejar de usar reCAPTCHA, dejá `RECAPTCHA_SECRET_KEY` sin configurar: la función deja pasar la reserva sin bloquear (pero perdés esa capa anti-bot).
