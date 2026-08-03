
(function(){
  "use strict";

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/service-worker.js').catch(function(err){
        console.warn('No se pudo registrar el service worker', err);
      });
    });
  }

  // ==== CONEXIÓN A GOOGLE SHEETS ====
  // Pegá acá la URL de tu Web App de Google Apps Script (ver instrucciones que te pasé aparte).
  var SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyiizuzfiDQn8a7sDmgjyulZSefquJLMfrxvaZbP3rfpniEpK4TrUH3joIZ2Pupf7NL2A/exec';

  var GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
  var COOKIE_CONSENT_KEY = 'nc_cookie_consent';

  function getCookieConsent(){
    try{
      var value = localStorage.getItem(COOKIE_CONSENT_KEY);
      return value || '';
    }catch(e){ return ''; }
  }

  function setCookieConsent(value){
    try{ localStorage.setItem(COOKIE_CONSENT_KEY, value); }catch(e){}
  }

  function cargarGoogleAnalytics(){
    if(!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID.indexOf('G-') === -1 || window.__gaLoaded) return;
    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    window.__gaLoaded = true;
  }

  function aplicarConsentimiento(value){
    setCookieConsent(value);
    var banner = document.getElementById('cookieBanner');
    if(banner) banner.style.display = 'none';
    if(value === 'accepted') cargarGoogleAnalytics();
  }

  // Pegá acá tu site key de reCAPTCHA v3 (la secret key correspondiente va
  // en Script Properties del Apps Script, no acá). Mientras diga
  // "PEGA_ACA", no se carga el script ni se manda token con la reserva.
  var RECAPTCHA_SITE_KEY = '6LeJUXEtAAAAAGr3k5GKmyV0z5QtlOc1KuWNPErw';

  function cargarRecaptchaScript(){
    if(!RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.indexOf('PEGA_ACA') !== -1) return;
    if(document.getElementById('recaptcha-v3-script')) return;
    var s = document.createElement('script');
    s.id = 'recaptcha-v3-script';
    s.src = 'https://www.google.com/recaptcha/api.js?render=' + RECAPTCHA_SITE_KEY;
    document.head.appendChild(s);
  }
  cargarRecaptchaScript();

  function sanitizarCampoCorreo(v){
    var s = String(v || '').trim();
    s = s.replace(/[\r\n\t\u0000-\u001f\u007f]/g, '');
    s = s.replace(/[<>'"`]/g, '');
    s = s.replace(/\s+/g, '');
    if(s.length > 254) s = s.substring(0, 254);
    return s;
  }

  function sanitizarCampoWhatsApp(v){
    var s = String(v || '').trim();
    s = s.replace(/[\r\n\t\u0000-\u001f\u007f]/g, '');
    s = s.replace(/[<>'"`]/g, '');
    s = s.replace(/[^\d+\-\s()]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if(s.length > 20) s = s.substring(0, 20);
    return s;
  }

  // Genera un token de reCAPTCHA v3 para la acción indicada. Devuelve ''
  // si no hay site key configurada o si algo falla (el backend trata un
  // token vacío como sospechoso).
  function obtenerTokenRecaptcha(accion){
    if(!RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY.indexOf('PEGA_ACA') !== -1) return Promise.resolve('');
    if(typeof grecaptcha === 'undefined') return Promise.resolve('');
    return new Promise(function(resolve){
      try{
        grecaptcha.ready(function(){
          grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: accion })
            .then(resolve)
            .catch(function(e){ console.error('Error ejecutando reCAPTCHA', e); resolve(''); });
        });
      }catch(e){
        console.error('Error inicializando reCAPTCHA', e);
        resolve('');
      }
    });
  }

  // Envía el payload al Web App de Apps Script y devuelve una Promise<boolean>
  // que resuelve a true solo si el servidor confirmó que guardó los datos.
  async function sendToSheet(payload){
    if(!SHEETS_WEBHOOK_URL || SHEETS_WEBHOOK_URL.indexOf('PEGA_ACA') !== -1){
      console.warn('SHEETS_WEBHOOK_URL sin configurar: los datos no se están guardando en ninguna planilla todavía.');
      return null;
    }
    try{
      if(payload){
        if(payload.correo !== undefined) payload.correo = sanitizarCampoCorreo(payload.correo);
        if(payload.whatsapp !== undefined) payload.whatsapp = sanitizarCampoWhatsApp(payload.whatsapp);
      }
      var res = await fetch(SHEETS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      if(!res.ok) return null;
      var data = await res.json();
      return data || null;
    }catch(e){
      console.error('Error enviando datos a la planilla', e);
      return null;
    }
  }

  var RESERVA_INFO = {};
  var COMPROBANTE_DATA = null;
  var PLAN_PRICES = { 'Oficina': 18000, 'Gaming': 25000, 'Gaming Plus': 45000 };

  // Contador opcional del hero. Completá este número SOLO si es real y
  // verificable (ej: cantidad de reservas confirmadas en la planilla). Si
  // lo dejás en 0, el bloque "+XX PCs optimizadas" no se muestra.
  var PCS_OPTIMIZADAS = 0;

  // Si el <video> de #resultados no puede cargar el archivo (src placeholder
  // o archivo faltante), mostramos el fallback con el link a TikTok en su
  // lugar, en vez de dejar un recuadro vacío o roto. Si no hay contenido
  // real cargado, el bloque completo se oculta para mantener el sitio limpio.
  window.mostrarFallbackVideo = function(videoEl){
    try{
      videoEl.style.display = 'none';
      var fallback = document.getElementById('videoFallback');
      var frame = document.getElementById('videoFrame');
      var section = document.getElementById('resultados');
      if(fallback) fallback.style.display = 'flex';
      if(frame) frame.style.display = 'none';
      if(section) section.style.display = 'none';
    }catch(e){ console.error('Error mostrando fallback de video', e); }
  };

  function mostrarContenidoRealVideo(){
    try{
      var frame = document.getElementById('videoFrame');
      var videoEl = document.getElementById('resultadosVideo');
      var fallback = document.getElementById('videoFallback');
      var section = document.getElementById('resultados');
      if(!frame || !videoEl) return;
      var src = videoEl.getAttribute('src') || (videoEl.querySelector('source') ? videoEl.querySelector('source').getAttribute('src') : '');
      if(!src){
        if(frame) frame.style.display = 'none';
        if(section) section.style.display = 'none';
        return;
      }
      if(src.indexOf('video-resultados.mp4') === -1 && src.indexOf('placeholder') === -1){
        frame.style.display = '';
        if(fallback) fallback.style.display = 'none';
        if(section) section.style.display = '';
        return;
      }
      fetch(src, { method: 'HEAD' }).then(function(res){
        if(res.ok){
          frame.style.display = '';
          if(fallback) fallback.style.display = 'none';
          if(section) section.style.display = '';
        } else {
          frame.style.display = 'none';
          if(section) section.style.display = 'none';
        }
      }).catch(function(){
        frame.style.display = 'none';
        if(section) section.style.display = 'none';
      });
    }catch(e){ console.error('Error verificando video real', e); }
  }

  function mostrarContenidoRealTestimonios(){
    try{
      var section = document.getElementById('testimonios');
      if(!section) return;
      var cards = section.querySelectorAll('.testimonial-card');
      var hasRealContent = false;
      cards.forEach(function(card){
        var isExplicitlyReal = card.getAttribute('data-testimonial-real') === 'true';
        var nameEl = card.querySelector('.testimonial-name');
        var imgEl = card.querySelector('img');
        var name = nameEl ? nameEl.textContent.trim() : '';
        var src = imgEl ? imgEl.getAttribute('src') || '' : '';
        var hasRealName = !!name && name.indexOf('TODO') === -1 && name.length > 2;
        var hasRealImage = !!src && src.indexOf('testimonio-') === -1 && src.indexOf('placeholder') === -1;
        var isReal = isExplicitlyReal || (hasRealName && hasRealImage);
        card.style.display = isReal ? '' : 'none';
        if(isReal) hasRealContent = true;
      });
      section.style.display = hasRealContent ? '' : 'none';
    }catch(e){ console.error('Error verificando testimonios reales', e); }
  }

  try{ document.getElementById('year').textContent = new Date().getFullYear(); }catch(e){}

  // ---- Turnos predefinidos ----
  // Lunes a viernes 18:00-22:00, sábados y domingos 13:00-18:00, cada 15 min.
  // La duración de cada plan determina cuántos turnos consecutivos ocupa.
  //
  // ⚠️ Si cambiás esto, cambiá también PLAN_DURATION en el .gs (Code.gs, línea ~12).
  // Este valor es solo un fallback: en cuanto responde el doGet, se pisa con
  // planDuration que devuelve el propio Apps Script (fuente de verdad real),
  // así el front no puede quedar desincronizado del back. Ver actualizarPlanDurationDesdeBackend().
  var PLAN_DURATION = { 'Oficina': 20, 'Gaming': 30, 'Gaming Plus': 45 };

  // Se sobreescribe con lo que devuelva el backend la primera vez que
  // consultamos turnos (ver fetchBookedFromSheet). Mientras no haya
  // respondido, se usa el fallback hardcodeado de arriba.
  function actualizarPlanDurationDesdeBackend(planDuration){
    if(!planDuration || typeof planDuration !== 'object') return;
    Object.keys(planDuration).forEach(function(k){
      var v = Number(planDuration[k]);
      if(v > 0) PLAN_DURATION[k] = v;
    });
  }

  function minutesToLabel(mins){
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function dayRange(dateStr){
    var d = new Date(dateStr + 'T00:00:00');
    var day = d.getDay(); // 0 domingo ... 6 sábado
    if(day === 0 || day === 6) return { start: 13*60, end: 18*60 };
    return { start: 18*60, end: 22*60 };
  }

  function overlaps(aStart, aEnd, bStart, bEnd){
    return aStart < bEnd && bStart < aEnd;
  }

  // Antelación mínima para poder reservar un turno hoy mismo: no tiene
  // sentido operativo ofrecer un turno que empieza en 10 minutos, hace
  // falta tiempo para coordinar (AnyDesk/Discord, etc.).
  var ANTELACION_MINIMA_MIN = 120;

  // Trae del Google Sheet (vía Apps Script doGet) los turnos ya reservados
  // para una fecha dada. Devuelve una Promise que resuelve a un array
  // de objetos { start, duration } (en minutos).
  function fetchBookedFromSheet(dateStr){
    var url = SHEETS_WEBHOOK_URL + '?fecha=' + encodeURIComponent(dateStr);
    return fetch(url, { method: 'GET' })
      .then(function(res){
        if(!res.ok) throw new Error('Respuesta HTTP ' + res.status);
        return res.json();
      })
      .then(function(data){
        if(!data || !Array.isArray(data.turnos)) throw new Error('Formato de respuesta inesperado');
        actualizarPlanDurationDesdeBackend(data.planDuration);
        return data.turnos;
      });
  }

  // ---- Badge "turnos disponibles hoy" (hero + sticky-cta) ----
  // Reusa fetchBookedFromSheet, no dispara un fetch nuevo/paralelo: se pide
  // una sola vez la fecha de hoy y se pinta en todos los data-turnos-hoy.
  function contarTurnosDisponiblesHoy(booked){
    var today = new Date().toISOString().slice(0,10);
    var range = dayRange(today);
    var now = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var duration = PLAN_DURATION['Gaming']; // duración de referencia (30 min) para el conteo general
    var count = 0;
    for(var t = range.start; t + duration <= range.end; t += 15){
      if(t <= nowMins + ANTELACION_MINIMA_MIN) continue;
      var taken = booked.some(function(b){ return overlaps(t, t + duration, b.start, b.start + b.duration); });
      if(!taken) count++;
    }
    return count;
  }

  function renderTurnosHoyBadge(){
    var badges = document.querySelectorAll('[data-turnos-hoy]');
    if(!badges.length) return;
    var today = new Date().toISOString().slice(0,10);
    fetchBookedFromSheet(today).then(function(booked){
      var n = contarTurnosDisponiblesHoy(booked);
      badges.forEach(function(el){
        if(n > 0){
          el.textContent = n === 1 ? '🟢 Queda 1 turno disponible hoy' : '🟢 Quedan ' + n + ' turnos disponibles hoy';
          el.style.display = '';
        } else {
          el.style.display = 'none'; // sin turnos hoy: mejor ocultar el badge que desalentar con un "0"
        }
      });
    }).catch(function(){
      // Si el webhook no responde (sin conexión, planilla caída, etc.) el
      // badge simplemente no se muestra: no es un dato crítico para reservar.
      badges.forEach(function(el){ el.style.display = 'none'; });
    });
  }

  // Token para evitar que una respuesta vieja (de una fecha/plan anterior)
  // pise el resultado de la consulta más reciente si el usuario cambia rápido.
  var slotsRequestToken = 0;

  function renderSlots(){
    var fechaInput = document.getElementById('fecha');
    var wrap = document.getElementById('slotsWrap');
    var grid = document.getElementById('slotsGrid');
    var hint = document.getElementById('slotsHint');
    var horarioInput = document.getElementById('horario');
    if(!fechaInput || !wrap || !grid) return;
    var dateStr = fechaInput.value;
    if(!dateStr){ wrap.style.display = 'none'; return; }

    var thisRequest = ++slotsRequestToken;

    wrap.style.display = 'block';
    grid.innerHTML = '';
    horarioInput.value = '';
    hint.textContent = 'Buscando turnos disponibles...';

    fetchBookedFromSheet(dateStr).then(function(booked){
      if(thisRequest !== slotsRequestToken) return; // llegó tarde, ya no aplica
      pintarSlots(dateStr, booked);
    }).catch(function(err){
      if(thisRequest !== slotsRequestToken) return;
      console.error('Error consultando turnos ocupados', err);
      grid.innerHTML = '';
      hint.textContent = 'No pudimos cargar los turnos disponibles. Revisá tu conexión y volvé a intentar, o escribinos directamente por WhatsApp/Discord para coordinar el horario.';
    });
  }

  function pintarSlots(dateStr, booked){
    var grid = document.getElementById('slotsGrid');
    var hint = document.getElementById('slotsHint');
    var horarioInput = document.getElementById('horario');

    var planSelect = document.getElementById('plan');
    var planName = planSelect ? planSelect.value : '';
    var duration = PLAN_DURATION[planName] || 30;

    var range = dayRange(dateStr);

    var now = new Date();
    var isToday = dateStr === now.toISOString().slice(0,10);
    var nowMins = now.getHours() * 60 + now.getMinutes();

    grid.innerHTML = '';
    horarioInput.value = '';
    var any = false;

    for(var t = range.start; t + duration <= range.end; t += 15){
      if(isToday && t <= nowMins + ANTELACION_MINIMA_MIN) continue;
      any = true;
      var taken = booked.some(function(b){ return overlaps(t, t + duration, b.start, b.start + b.duration); });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn' + (taken ? ' taken' : '');
      btn.textContent = minutesToLabel(t);
      if(!taken){
        btn.addEventListener('click', function(){
          grid.querySelectorAll('.slot-btn').forEach(function(b){ b.classList.remove('selected'); });
          this.classList.add('selected');
          horarioInput.value = this.textContent;
        });
      } else {
        btn.disabled = true;
      }
      grid.appendChild(btn);
    }

    if(!any){
      hint.textContent = 'No quedan turnos disponibles para este día. Probá con otra fecha.';
    } else {
      var isWeekend = (new Date(dateStr + 'T00:00:00').getDay() % 6) === 0;
      hint.textContent = isWeekend ? 'Fin de semana: turnos de 13:00 a 18:00.' : 'Semana: turnos de 18:00 a 22:00.';
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    var consent = getCookieConsent();
    var banner = document.getElementById('cookieBanner');
    var acceptBtn = document.getElementById('cookieAccept');
    var rejectBtn = document.getElementById('cookieReject');

    if(acceptBtn){ acceptBtn.addEventListener('click', function(){ aplicarConsentimiento('accepted'); }); }
    if(rejectBtn){ rejectBtn.addEventListener('click', function(){ aplicarConsentimiento('rejected'); }); }

    if(!consent && banner){
      banner.style.display = 'flex';
    } else if(consent === 'accepted'){
      cargarGoogleAnalytics();
    }

    var fechaInput = document.getElementById('fecha');
    if(fechaInput){
      var today = new Date().toISOString().slice(0,10);
      fechaInput.setAttribute('min', today);
      fechaInput.addEventListener('change', renderSlots);
    }
    var planSelectEl = document.getElementById('plan');
    if(planSelectEl){
      planSelectEl.addEventListener('change', function(){
        if(document.getElementById('fecha') && document.getElementById('fecha').value) renderSlots();
      });
    }

    renderTurnosHoyBadge();
    mostrarContenidoRealVideo();
    mostrarContenidoRealTestimonios();

    // Contador opcional "+XX PCs optimizadas". Completá PCS_OPTIMIZADAS más
    // abajo SOLO con un número real y verificable; si queda en 0 el bloque
    // no se muestra.
    var pcsEl = document.getElementById('pcsOptimizadas');
    if(pcsEl && PCS_OPTIMIZADAS > 0){
      pcsEl.textContent = '+' + PCS_OPTIMIZADAS + ' PCs optimizadas';
      pcsEl.style.display = '';
    }
  });

  // ---- Plan selection from pricing cards ----
  window.selectPlan = function(planName){
    try{
      var select = document.getElementById('plan');
      var chip = document.getElementById('planChip');
      if(select) select.value = planName;
      if(chip) chip.textContent = 'Plan: ' + planName;
      var target = document.getElementById('formulario');
      if(target) target.scrollIntoView({behavior:'smooth'});
    }catch(e){ console.error(e); }
  };

  // ---- Multi-step form ----
  var CURRENT_STEP = 1;

  function showStep(n){
    document.querySelectorAll('.form-step').forEach(function(el){
      el.classList.toggle('active', Number(el.getAttribute('data-step')) === n);
    });
    document.querySelectorAll('[data-step-bar]').forEach(function(el){
      var s = Number(el.getAttribute('data-step-bar'));
      el.classList.toggle('active', s === n);
      el.classList.toggle('done', s < n);
    });
    CURRENT_STEP = n;
  }

  document.querySelectorAll('.error-msg[data-error-for]').forEach(function(el){
    el.dataset.defaultMsg = el.textContent;
  });

  function validateStep(n){
    var stepEl = document.querySelector('.form-step[data-step="'+n+'"]');
    if(!stepEl) return true;
    var fields = stepEl.querySelectorAll('input[required], select[required], textarea[required]');
    var ok = true;
    var hasFormatError = false;
    fields.forEach(function(f){
      if(!f.checkValidity()){
        ok = false;
        if(!f.validity.valueMissing && (f.validity.patternMismatch || f.validity.typeMismatch)){
          hasFormatError = true;
        }
      }
    });
    if(n === 2){
      var horarioInput = document.getElementById('horario');
      if(horarioInput && !horarioInput.value){
        ok = false;
      }
    }
    if(n === 3){
      var privacidadInput = document.getElementById('aceptaPrivacidad');
      if(privacidadInput && !privacidadInput.checked){
        ok = false;
      }
    }
    var errEl = document.querySelector('.error-msg[data-error-for="'+n+'"]');
    if(errEl){
      if(!ok && hasFormatError){
        errEl.textContent = 'Revisá el formato del correo y/o el número de WhatsApp (ej: 11 2345 6789).';
      } else if(errEl.dataset.defaultMsg){
        errEl.textContent = errEl.dataset.defaultMsg;
      }
      errEl.classList.toggle('show', !ok);
    }
    return ok;
  }

  window.nextStep = function(current){
    if(!validateStep(current)) return;
    if(current === 1){
      RESERVA_INFO = {
        nombreCompleto: (document.getElementById('nombreCompleto') || {}).value || '',
        correo: sanitizarCampoCorreo((document.getElementById('correo') || {}).value || ''),
        whatsapp: sanitizarCampoWhatsApp((document.getElementById('whatsapp') || {}).value || ''),
        discord: (document.getElementById('discord') || {}).value || '',
        instagram: (document.getElementById('instagram') || {}).value || ''
      };
    }
    var chip = document.getElementById('planChip');
    var planVal = document.getElementById('plan');
    if(chip && planVal && planVal.value) chip.textContent = 'Plan: ' + planVal.value;
    if(current === 2){
      var montoEl = document.getElementById('montoText');
      var planNombre = planVal ? planVal.value : '';
      var monto = PLAN_PRICES[planNombre];
      if(montoEl) montoEl.textContent = monto ? ('$' + monto.toLocaleString('es-AR')) : '—';
    }
    showStep(current + 1);
    var panel = document.querySelector('.form-panel');
    if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
  };

  window.prevStep = function(current){
    showStep(current - 1);
  };

  window.submitReserva = async function(){
    if(!validateStep(3)) return;

    // Honeypot: si este campo oculto llegó completo, lo llenó un bot.
    // Simulamos que el envío fue exitoso (avanzamos al paso 4 sin mandar
    // nada a la Sheet) para no delatar el mecanismo: si devolviéramos un
    // error, un bot más sofisticado podría usar esa respuesta para
    // detectar el honeypot y ajustar su comportamiento.
    var honeypotEl = document.getElementById('empresaWeb');
    if(honeypotEl && honeypotEl.value){
      showStep(4);
      var panelHp = document.querySelector('.form-panel');
      if(panelHp) panelHp.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }

    // NOTA: no hay backend propio. Este envío va directo a tu Google Sheet
    // a través del Web App de Apps Script configurado en SHEETS_WEBHOOK_URL.
    var sendErrorEl = document.getElementById('sendErrorStep3');
    var btn = document.getElementById('btnSubmitReserva');
    if(sendErrorEl) sendErrorEl.classList.remove('show');
    if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }

    var result = null;
    try{
      var fecha = document.getElementById('fecha').value;
      var horario = document.getElementById('horario').value;
      var planSelect = document.getElementById('plan');
      var planName = planSelect ? planSelect.value : '';
      var comentariosEl = document.getElementById('comentarios');
      var recaptchaToken = await obtenerTokenRecaptcha('reserva');
      result = await sendToSheet({
        type: 'reserva',
        nombreCompleto: RESERVA_INFO.nombreCompleto || '',
        correo: RESERVA_INFO.correo || '',
        whatsapp: RESERVA_INFO.whatsapp || '',
        discord: RESERVA_INFO.discord || '',
        instagram: RESERVA_INFO.instagram || '',
        plan: planName,
        fecha: fecha,
        horario: horario,
        comentarios: comentariosEl ? comentariosEl.value : '',
        comoMeEncontraste: document.getElementById('comoMeEncontraste') ? document.getElementById('comoMeEncontraste').value : '',
        referido: document.getElementById('referido') ? document.getElementById('referido').value : '',
        comprobanteBase64: COMPROBANTE_DATA ? COMPROBANTE_DATA.base64 : '',
        comprobanteName: COMPROBANTE_DATA ? COMPROBANTE_DATA.name : '',
        comprobanteType: COMPROBANTE_DATA ? COMPROBANTE_DATA.type : '',
        recaptchaToken: recaptchaToken
      });
    }catch(e){
      console.error(e);
      result = null;
    }

    if(btn){ btn.disabled = false; btn.textContent = 'Enviar comprobante'; }

    if(!result || !result.ok){
      if(result && result.reason === 'slot_taken'){
        var errEl2 = document.querySelector('.error-msg[data-error-for="2"]');
        if(errEl2){
          errEl2.textContent = 'Ese turno se ocupó mientras completabas el formulario, elegí otro.';
          errEl2.classList.add('show');
        }
        showStep(2);
        renderSlots();
        var panel2 = document.querySelector('.form-panel');
        if(panel2) panel2.scrollIntoView({behavior:'smooth', block:'start'});
        return;
      }
      if(sendErrorEl) sendErrorEl.classList.add('show');
      return;
    }

    showStep(4);
    var panel = document.querySelector('.form-panel');
    if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
  };

  window.submitExtraData = async function(){
    var msg = document.getElementById('extraDataMsg');
    var sendErrorEl = document.getElementById('sendErrorExtra');
    var btn = document.getElementById('btnSubmitExtra');
    var paisEl = document.getElementById('pais');
    var edadEl = document.getElementById('edadExtra');
    var generoEl = document.getElementById('generoExtra');
    var juegoEl = document.getElementById('juegoExtra');

    // Honeypot: mismo criterio que en submitReserva, simulamos éxito
    // sin enviar nada a la Sheet.
    var honeypotElExtra = document.getElementById('empresaWeb');
    if(honeypotElExtra && honeypotElExtra.value){
      if(msg) msg.style.display = 'block';
      if(btn){ btn.disabled = true; btn.textContent = 'Enviado'; }
      return;
    }

    if(sendErrorEl) sendErrorEl.classList.remove('show');
    if(msg) msg.style.display = 'none';
    if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }

    var result = null;
    try{
      result = await sendToSheet({
        type: 'extra',
        correo: RESERVA_INFO.correo || '',
        nombreCompleto: RESERVA_INFO.nombreCompleto || '',
        pais: paisEl ? paisEl.value : '',
        edad: edadEl ? edadEl.value : '',
        genero: generoEl ? generoEl.value : '',
        juegoExtra: juegoEl ? juegoEl.value : ''
      });
    }catch(e){
      console.error(e);
      result = null;
    }

    if(btn){ btn.disabled = false; btn.textContent = 'Enviar'; }

    if(!result || !result.ok){
      if(sendErrorEl) sendErrorEl.classList.add('show');
      return;
    }

    if(msg) msg.style.display = 'block';
  };

  window.fileChosen = function(input){
    try{
      var fname = document.getElementById('fname');
      var errEl = document.getElementById('uploadFileError');
      var MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB, para archivos que no se pueden comprimir (PDF, etc)
      var MAX_IMG_DIM = 1600; // px, lado más largo

      if(errEl){ errEl.textContent = ''; errEl.classList.remove('show'); }

      function formatSize(bytes){
        if(bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        return Math.max(1, Math.round(bytes / 1024)) + ' KB';
      }

      function showUploadError(text){
        if(fname) fname.textContent = '';
        COMPROBANTE_DATA = null;
        try{ input.value = ''; }catch(e2){}
        if(errEl){
          errEl.textContent = text;
          errEl.classList.add('show');
        }
      }

      if(fname && input.files && input.files[0]){
        var file = input.files[0];

        if(file.type && file.type.indexOf('image/') === 0){
          // Imagen: redimensionar con canvas antes de convertir a base64
          var imgUrl = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function(){
            var w = img.width, h = img.height;
            var scale = Math.min(1, MAX_IMG_DIM / Math.max(w, h));
            var newW = Math.max(1, Math.round(w * scale));
            var newH = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement('canvas');
            canvas.width = newW;
            canvas.height = newH;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, newW, newH);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.75);
            var base64 = dataUrl.split(',')[1] || '';
            var approxBytes = Math.round(base64.length * 3 / 4);
            COMPROBANTE_DATA = { base64: base64, name: file.name, type: 'image/jpeg' };
            fname.textContent = file.name + ' (' + formatSize(approxBytes) + ')';
            URL.revokeObjectURL(imgUrl);
          };
          img.onerror = function(){
            URL.revokeObjectURL(imgUrl);
            showUploadError('No se pudo procesar la imagen. Probá con otro archivo.');
          };
          img.src = imgUrl;
        }else{
          // PDF u otro tipo: no se puede comprimir con canvas, validar tamaño máximo
          if(file.size > MAX_FILE_SIZE){
            showUploadError('El archivo pesa más de 8MB. Subí uno más liviano para poder enviarlo.');
            return;
          }
          var reader = new FileReader();
          reader.onload = function(){
            var base64 = String(reader.result).split(',')[1] || '';
            COMPROBANTE_DATA = { base64: base64, name: file.name, type: file.type };
            fname.textContent = file.name + ' (' + formatSize(file.size) + ')';
          };
          reader.readAsDataURL(file);
        }
      }
    }catch(e){}
  };

  window.copyAlias = function(){
    var text = document.getElementById('aliasText').textContent.trim();
    try{
      navigator.clipboard.writeText(text);
    }catch(e){
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); }catch(e2){}
      document.body.removeChild(ta);
    }
  };

  var form = document.getElementById('reserva-form');
  if(form){ form.addEventListener('submit', function(e){ e.preventDefault(); }); }

  // ---- Count-up numbers on scroll ----
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateCount(el){
    var to = Number(el.getAttribute('data-count-to'));
    var from = Number(el.getAttribute('data-start') || el.textContent) || to;
    if(reduceMotion || isNaN(to)){ el.textContent = to; return; }
    var duration = 1100, startTime = null;
    function step(ts){
      if(!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var val = Math.round(from + (to - from) * progress);
      el.textContent = val;
      if(progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var counters = document.querySelectorAll('[data-count-to]');
  var bars = document.querySelectorAll('.hud-bar span');

  if('IntersectionObserver' in window){
    var seen = new WeakSet();
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting && !seen.has(entry.target)){
          seen.add(entry.target);
          if(entry.target.hasAttribute('data-count-to')) animateCount(entry.target);
          if(entry.target.hasAttribute('data-fill')){
            entry.target.style.width = reduceMotion ? entry.target.getAttribute('data-fill') + '%' : '0%';
            requestAnimationFrame(function(){ entry.target.style.width = entry.target.getAttribute('data-fill') + '%'; });
          }
        }
      });
    }, {threshold:0.4});
    counters.forEach(function(c){ obs.observe(c); });
    bars.forEach(function(b){ obs.observe(b); });
  } else {
    counters.forEach(function(c){ c.textContent = c.getAttribute('data-count-to'); });
    bars.forEach(function(b){ b.style.width = b.getAttribute('data-fill') + '%'; });
  }

})();
