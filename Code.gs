var SPREADSHEET_ID = '1_Hg1x_IntEqNWfa5aoALpylWIsswaGcrRVO73ZnctvI';
var MAIL_NOTIFICACION = 'taiellclott@gmail.com,taieljuega@gmail.com'; // separados por coma, sin espacios

// Columnas en la pestaña "Reservas", en el mismo orden en que las escribe
// guardarReserva() más abajo. Se sacó la columna Instagram porque el
// formulario ya no lo pide.
// 0=timestamp, 1=nombreCompleto, 2=correo, 3=whatsapp, 4=discord,
// 5=plan, 6=fecha, 7=horario, 8=comentarios, 9=comprobanteUrl
var COL_PLAN = 5;
var COL_FECHA = 6;
var COL_HORARIO = 7;

// ⚠️ Si cambiás esto, cambiá también PLAN_DURATION en index.html (línea ~938).
// doGet() devuelve este mismo objeto en la respuesta (campo planDuration) para
// que el frontend lo use como fuente de verdad real en lugar del hardcodeo
// local, así ambos lados no pueden quedar desincronizados silenciosamente.
var PLAN_DURATION = { 'Oficina': 20, 'Gaming': 30, 'Gaming Plus': 45 };
var PLANES_VALIDOS = ['Oficina', 'Gaming', 'Gaming Plus'];
var REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var REGEX_WHATSAPP = /^\+?[0-9\s()-]{8,15}$/;
var REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
var REGEX_HORARIO = /^\d{1,2}:\d{2}$/;

// Rango de atención según el día de la semana. Se usa tanto en el frontend
// (dayRange() en index.html) como acá en validarReserva(), para que el
// backend rechace horarios fuera de rango aunque alguien llame al Web App
// directamente (fetch/Postman) sin pasar por la UI.
// ⚠️ Si cambiás los horarios, cambiá también dayRange() en index.html (línea ~956).
function rangoAtencion(fecha){
  // fecha viene como 'YYYY-MM-DD'; se arma como fecha local a medianoche,
  // igual que hace dayRange() del lado del cliente.
  var d = new Date(fecha + 'T00:00:00');
  var day = d.getDay(); // 0 domingo ... 6 sábado
  if(day === 0 || day === 6) return { start: 13 * 60, end: 18 * 60 }; // fin de semana 13:00-18:00
  return { start: 18 * 60, end: 22 * 60 }; // semana 18:00-22:00
}

// Tipos de archivo permitidos para el comprobante de pago. El atributo
// accept="image/*,.pdf" del <input type="file"> es solo una sugerencia de
// UI y no evita que alguien llame al endpoint directamente con cualquier
// tipo de archivo, así que se valida también acá.
var TIPOS_COMPROBANTE_VALIDOS = ['image/jpeg', 'image/png', 'application/pdf'];

function enviarRecordatoriosTurno() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Reservas');
    if (!sheet) return;

    var values = sheet.getDataRange().getValues();
    var ahora = new Date();
    var ahoraMs = ahora.getTime();
    var cache = CacheService.getScriptCache();

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      if (!(row[0] instanceof Date)) continue;

      var fecha = String(row[COL_FECHA] || '').trim();
      var horario = String(row[COL_HORARIO] || '').trim();
      if (!fecha || !horario) continue;

      var reservaDate = new Date(fecha + 'T' + horario + ':00');
      if (isNaN(reservaDate.getTime())) continue;

      var diffMin = Math.round((reservaDate.getTime() - ahoraMs) / 60000);
      if (diffMin < 0 || diffMin > 60) continue;

      var cacheKey = 'reminder_' + String(row[0].getTime()) + '_' + fecha + '_' + horario + '_' + String(row[2] || '').trim().toLowerCase();
      if (cache.get(cacheKey)) continue;

      var nombre = String(row[1] || '').trim() || 'cliente';
      var correo = String(row[2] || '').trim();
      var plan = String(row[COL_PLAN] || '').trim();

      if (!correo) continue;

      var asunto = '⏰ Recordatorio de turno · NC Optimizaciones';
      var cuerpo =
        'Hola ' + nombre + ',\n\n' +
        'Este es un recordatorio automático de tu turno para optimizar tu PC.\n' +
        'Plan: ' + plan + '\n' +
        'Fecha: ' + fecha + '\n' +
        'Horario: ' + horario + '\n\n' +
        'Te esperamos para la sesión. Si necesitás ajustar algo, respondé este mail o escribinos por Instagram DM.\n\n' +
        'NC Optimizaciones';

      MailApp.sendEmail(correo, asunto, cuerpo);
      cache.put(cacheKey, 'sent', 7 * 24 * 60 * 60);
    }
  } catch (err) {
    Logger.log('Error en enviarRecordatoriosTurno: ' + err);
  }
}

function createReminderTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function(t) {
    return t.getHandlerFunction() === 'enviarRecordatoriosTurno';
  });

  if (!exists) {
    ScriptApp.newTrigger('enviarRecordatoriosTurno')
      .timeBased()
      .everyMinutes(15)
      .create();
  }
}

function doGet(e) {
  var fecha = e && e.parameter ? e.parameter.fecha : null;
  var out = { turnos: [], planDuration: PLAN_DURATION };

  if (!fecha) {
    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName('Reservas');
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];

      // Si la primera celda no es una fecha (Date), es una fila de encabezado
      // manual y la salteamos.
      if (!(row[0] instanceof Date)) continue;

      var rowFecha = String(row[COL_FECHA] || '').trim();
      if (rowFecha !== fecha) continue;

      var horario = String(row[COL_HORARIO] || '').trim();
      if (!horario) continue;

      var parts = horario.split(':');
      var startMin = Number(parts[0]) * 60 + Number(parts[1] || 0);
      var planName = String(row[COL_PLAN] || '').trim();
      var duration = PLAN_DURATION[planName] || 30;

      out.turnos.push({ start: startMin, duration: duration });
    }
  } catch (err) {
    Logger.log('Error en doGet: ' + err);
  }

  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'No llegaron datos en el POST.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(e.postData.contents);

    if (data.type !== 'reserva' && data.type !== 'extra' && data.type !== 'review') {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'Tipo de solicitud inválido' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.type === 'reserva') {
      var errorValidacion = validarReserva(data);
      if (errorValidacion) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, reason: 'validation_error', error: errorValidacion }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      if (!verificarRecaptcha(data.recaptchaToken)) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, reason: 'bot_suspected' }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      if (excedeFrecuencia(data)) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, reason: 'rate_limited', error: 'Se recibieron demasiadas solicitudes con este correo/WhatsApp en poco tiempo. Esperá unos minutos y volvé a intentar.' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (data.type === 'review') {
      var errorValidacion = validarReview(data);
      if (errorValidacion) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, reason: 'validation_error', error: errorValidacion }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (data.type === 'reserva') {
      var sheetReservas = ss.getSheetByName('Reservas');
      if (!sheetReservas) {
        throw new Error('No existe la pestaña "Reservas" en la planilla.');
      }
      if (hayConflicto(sheetReservas, data)) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, reason: 'slot_taken', error: 'Ese turno ya no está disponible.' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      guardarReserva(ss, data);
    } else if (data.type === 'extra') {
      guardarDatosExtra(ss, data);
    } else if (data.type === 'review') {
      guardarResena(ss, data);
    }

    enviarNotificacion(data);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error en doPost: ' + err);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Verifica el token de reCAPTCHA v3 contra la API de Google. La secret key
// se lee de Script Properties (Configuración del proyecto > Propiedades del
// script > RECAPTCHA_SECRET_KEY), nunca hardcodeada acá.
function verificarRecaptcha(token) {
  var secretKey = PropertiesService.getScriptProperties().getProperty('RECAPTCHA_SECRET_KEY');
  if (!secretKey) {
    Logger.log('RECAPTCHA_SECRET_KEY no está configurada en Script Properties.');
    return false;
  }
  if (!token) return false;

  try {
    var response = UrlFetchApp.fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'post',
      payload: {
        secret: secretKey,
        response: token
      },
      muteHttpExceptions: true
    });
    var result = JSON.parse(response.getContentText());
    var UMBRAL_SCORE = 0.5;
    return !!(result && result.success && (typeof result.score !== 'number' || result.score >= UMBRAL_SCORE));
  } catch (err) {
    Logger.log('Error verificando reCAPTCHA: ' + err);
    return false;
  }
}

// Límite simple de frecuencia: máximo 3 solicitudes por correo/whatsapp
// cada 10 minutos, usando el cache del script (no persiste en la planilla).
function excedeFrecuencia(data) {
  var clave = String(sanitizarCorreo(data.correo) || sanitizarWhatsApp(data.whatsapp) || '').trim().toLowerCase();
  if (!clave) return false;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'freq_' + clave;
  var actual = Number(cache.get(cacheKey) || 0);

  if (actual >= 3) return true;

  cache.put(cacheKey, String(actual + 1), 600);
  return false;
}

function validarReserva(data) {
  data.correo = sanitizarCorreo(data.correo);
  data.whatsapp = sanitizarWhatsApp(data.whatsapp);

  if (!String(data.nombreCompleto || '').trim()) return 'Falta el nombre completo.';
  if (!String(data.correo || '').trim()) return 'Falta el correo.';
  if (!String(data.whatsapp || '').trim()) return 'Falta el WhatsApp.';
  if (!String(data.plan || '').trim()) return 'Falta el plan.';
  if (!String(data.fecha || '').trim()) return 'Falta la fecha.';
  if (!String(data.horario || '').trim()) return 'Falta el horario.';

  if (PLANES_VALIDOS.indexOf(data.plan) === -1) return 'El plan elegido no es válido.';
  if (!REGEX_EMAIL.test(String(data.correo).trim())) return 'El correo no tiene un formato válido.';
  if (!REGEX_WHATSAPP.test(String(data.whatsapp).trim())) return 'El WhatsApp no tiene un formato válido.';
  if (!REGEX_FECHA.test(String(data.fecha).trim())) return 'La fecha no tiene el formato esperado (YYYY-MM-DD).';
  if (!REGEX_HORARIO.test(String(data.horario).trim())) return 'El horario no tiene el formato esperado (HH:MM).';

  // Validación del rango de atención: antes esto solo existía en el
  // JavaScript del cliente (dayRange() en index.html), así que alguien que
  // llamara al Web App directamente podía crear una reserva a las 4am un
  // martes. Se recalcula acá con la misma lógica de horarios.
  var horarioParts = String(data.horario).trim().split(':');
  var horarioMin = Number(horarioParts[0]) * 60 + Number(horarioParts[1] || 0);
  var rango = rangoAtencion(String(data.fecha).trim());
  var duracion = PLAN_DURATION[data.plan] || 30;
  if (horarioMin < rango.start || (horarioMin + duracion) > rango.end) {
    return 'El horario elegido está fuera del rango de atención para ese día.';
  }

  return null;
}

// Neutraliza posible inyección de fórmulas en Sheets: si el texto empieza
// con =, +, - o @, Sheets lo interpretaría como fórmula al abrir la
// planilla. Anteponer un apóstrofe lo fuerza a texto plano. También trunca
// a una longitud máxima razonable.
function sanitizarTexto(v, maxLen) {
  var s = String(v || '').trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function sanitizarCorreo(v) {
  var s = String(v || '').trim();
  s = s.replace(/[\r\n\t\u0000-\u001f\u007f]/g, '');
  s = s.replace(/[<>'"`]/g, '');
  s = s.replace(/\s+/g, '');
  if (s.length > 254) s = s.substring(0, 254);
  return s;
}

function sanitizarWhatsApp(v) {
  var s = String(v || '').trim();
  s = s.replace(/[\r\n\t\u0000-\u001f\u007f]/g, '');
  s = s.replace(/[<>'"`]/g, '');
  s = s.replace(/[^\d+\-\s()]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 20) s = s.substring(0, 20);
  return s;
}

function hayConflicto(sheet, data) {
  var fecha = String(data.fecha || '').trim();
  var horario = String(data.horario || '').trim();
  if (!fecha || !horario) return false;

  var parts = horario.split(':');
  var newStart = Number(parts[0]) * 60 + Number(parts[1] || 0);
  var newDuration = PLAN_DURATION[data.plan] || 30;
  var newEnd = newStart + newDuration;

  var values = sheet.getDataRange().getValues();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];

    // Si la primera celda no es una fecha (Date), es una fila de encabezado
    // manual y la salteamos, igual que en doGet.
    if (!(row[0] instanceof Date)) continue;

    var rowFecha = String(row[COL_FECHA] || '').trim();
    if (rowFecha !== fecha) continue;

    var rowHorario = String(row[COL_HORARIO] || '').trim();
    if (!rowHorario) continue;

    var rowParts = rowHorario.split(':');
    var rowStart = Number(rowParts[0]) * 60 + Number(rowParts[1] || 0);
    var rowPlan = String(row[COL_PLAN] || '').trim();
    var rowDuration = PLAN_DURATION[rowPlan] || 30;
    var rowEnd = rowStart + rowDuration;

    if (newStart < rowEnd && rowStart < newEnd) {
      return true;
    }
  }

  return false;
}

function guardarReserva(ss, data) {
  var sheet = ss.getSheetByName('Reservas');
  if (!sheet) {
    throw new Error('No existe la pestaña "Reservas" en la planilla.');
  }
  var comprobanteUrl = '';

  if (data.comprobanteBase64) {
    // Valida el tipo de archivo declarado contra una whitelist antes de
    // crear el blob. El atributo accept="image/*,.pdf" del input en el
    // frontend es solo una sugerencia de UI, no una validación real: sin
    // esto, cualquiera que llame al endpoint directamente podría hacer que
    // termine en Drive cualquier tipo de archivo con cualquier nombre.
    var tipoDeclarado = data.comprobanteType || 'application/octet-stream';
    if (TIPOS_COMPROBANTE_VALIDOS.indexOf(tipoDeclarado) === -1) {
      comprobanteUrl = 'Adjunto rechazado: tipo de archivo no permitido (' + tipoDeclarado + ')';
    } else {
      try {
        var bytes = Utilities.base64Decode(data.comprobanteBase64);
        var blob = Utilities.newBlob(
          bytes,
          tipoDeclarado,
          data.comprobanteName || 'comprobante'
        );
        var carpeta = getOrCreateFolder('NC Optimizaciones - Comprobantes');
        var file = carpeta.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        comprobanteUrl = file.getUrl();
      } catch (err) {
        comprobanteUrl = 'Error al guardar el archivo: ' + err;
      }
    }
  }

  sheet.appendRow([
    new Date(),
    sanitizarTexto(data.nombreCompleto, 200),
    sanitizarCorreo(data.correo),
    sanitizarWhatsApp(data.whatsapp),
    sanitizarTexto(data.discord, 200),
    data.plan || '',
    data.fecha || '',
    data.horario || '',
    sanitizarTexto(data.comentarios, 1000),
    comprobanteUrl
  ]);
}

function guardarDatosExtra(ss, data) {
  var sheet = ss.getSheetByName('Datos extra');
  if (!sheet) {
    throw new Error('No existe la pestaña "Datos extra" en la planilla.');
  }
  sheet.appendRow([
    new Date(),
    sanitizarCorreo(data.correo),
    sanitizarTexto(data.nombreCompleto, 200),
    sanitizarTexto(data.pais, 200),
    data.edad || '',
    data.genero || '',
    sanitizarTexto(data.juegoExtra, 200)
  ]);
}

function validarReview(data) {
  if (!String(data.nombreCompleto || '').trim()) return 'Falta el nombre completo.';
  if (!String(data.rating || '').trim()) return 'Falta la calificación.';
  if (!String(data.mensaje || '').trim()) return 'Falta el mensaje de la reseña.';
  return null;
}

function guardarResena(ss, data) {
  var sheet = ss.getSheetByName('Reseñas');
  if (!sheet) {
    throw new Error('No existe la pestaña "Reseñas" en la planilla.');
  }
  sheet.appendRow([
    new Date(),
    sanitizarTexto(data.nombreCompleto, 200),
    sanitizarTexto(data.rating, 2),
    sanitizarTexto(data.pc, 200),
    sanitizarTexto(data.mensaje, 1000),
    'pendiente'
  ]);
}

function enviarNotificacion(data) {
  try {
    if (!data || typeof data !== 'object') {
      Logger.log('enviarNotificacion: se llamó sin datos válidos. Si la corriste manual desde el editor, ejecutá "testNotificacion" en su lugar (no esta función sola).');
      return;
    }

    var asunto, cuerpo;

    if (data.type === 'reserva') {
      asunto = '🎮 Nueva reserva: ' + (data.nombreCompleto || 'Sin nombre') + ' — ' + (data.plan || '');
      cuerpo =
        'Nombre: ' + (data.nombreCompleto || '') + '\n' +
        'Correo: ' + sanitizarCorreo(data.correo) + '\n' +
        'WhatsApp: ' + sanitizarWhatsApp(data.whatsapp) + '\n' +
        'Discord: ' + (data.discord || '') + '\n' +
        'Plan: ' + (data.plan || '') + '\n' +
        'Fecha: ' + (data.fecha || '') + '\n' +
        'Horario: ' + (data.horario || '') + '\n' +
        'Comentarios: ' + (data.comentarios || '') + '\n' +
        '\nRevisá el comprobante en la pestaña "Reservas" de la planilla.';
    } else if (data.type === 'extra') {
      asunto = '📋 Datos extra: ' + (data.nombreCompleto || data.correo || 'Sin nombre');
      cuerpo =
        'Correo: ' + sanitizarCorreo(data.correo) + '\n' +
        'Nombre: ' + (data.nombreCompleto || '') + '\n' +
        'País: ' + (data.pais || '') + '\n' +
        'Edad: ' + (data.edad || '') + '\n' +
        'Género: ' + (data.genero || '') + '\n' +
        'Juego principal: ' + (data.juegoExtra || '');
    } else if (data.type === 'review') {
      asunto = '📝 Nueva reseña pendiente: ' + (data.nombreCompleto || 'Sin nombre');
      cuerpo =
        'Nombre: ' + (data.nombreCompleto || '') + '\n' +
        'Calificación: ' + (data.rating || '') + '\n' +
        'PC optimizada: ' + (data.pc || '') + '\n' +
        'Mensaje: ' + (data.mensaje || '') + '\n' +
        '\nRevisá la reseña en la pestaña "Reseñas" de la planilla.';
    } else {
      return; // tipo desconocido, no mandamos mail
    }

    MailApp.sendEmail(MAIL_NOTIFICACION, asunto, cuerpo);
  } catch (err) {
    // Si falla el mail, no queremos que se caiga el guardado en la planilla.
    Logger.log('Error enviando notificación: ' + err);
  }
}

function testEscritura() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  guardarReserva(ss, {
    nombreCompleto: 'Prueba Test',
    correo: 'prueba@test.com',
    whatsapp: '11111111',
    discord: 'test#0000',
    plan: 'Gaming',
    fecha: '2026-08-01',
    horario: '18:00',
    comentarios: 'Esto es una prueba manual desde el editor de Apps Script'
  });
  Logger.log('Listo, revisá la pestaña Reservas de tu planilla.');
}

function testNotificacion() {
  enviarNotificacion({
    type: 'reserva',
    nombreCompleto: 'Prueba Test',
    correo: 'prueba@test.com',
    whatsapp: '11111111',
    discord: 'test#0000',
    plan: 'Gaming',
    fecha: '2026-08-01',
    horario: '18:00',
    comentarios: 'Esto es una prueba manual del mail'
  });
  Logger.log('Listo, revisá tu bandeja de entrada (' + MAIL_NOTIFICACION + ').');
}

function testDoGet() {
  var resultado = doGet({ parameter: { fecha: '2026-08-01' } });
  Logger.log(resultado.getContent());
}

function getOrCreateFolder(nombre) {
  var folders = DriveApp.getFoldersByName(nombre);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(nombre);
}