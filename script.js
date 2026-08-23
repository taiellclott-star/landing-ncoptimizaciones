
(function(){
  "use strict";

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('/service-worker.js').catch(function(err){
        console.warn('No se pudo registrar el service worker', err);
      });
    });
  }

  // ==== CONEXIÓN A SUPABASE ====
  // Reemplaza al Web App de Apps Script. Completá estos 3 valores:
  //  - SUPABASE_URL y SUPABASE_ANON_KEY: Supabase Dashboard > Settings > API Keys
  //    (usá la "anon public" key, NUNCA la service_role acá)
  //  - RESERVAS_FUNCTION_URL: la URL de la Edge Function "reservas" una vez
  //    deployada (Supabase Dashboard > Edge Functions > reservas > Invoke URL)
  var SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
  var SUPABASE_ANON_KEY = 'TU-ANON-KEY-ACA';
  var RESERVAS_FUNCTION_URL = SUPABASE_URL + '/functions/v1/reservas';

  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  // en los Secrets de la Edge Function, no acá). Mientras diga "PEGA_ACA",
  // no se carga el script ni se manda token con la reserva.
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

  // Genera un token de reCAPTCHA v3 para la acción indicada.
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

  // Envía el payload a la Edge Function "reservas" y devuelve una
  // Promise<object|null> que resuelve al JSON de respuesta, o null si
  // falló la request en sí (red caída, etc).
  async function sendToBackend(payload){
    try{
      if(payload){
        if(payload.correo !== undefined) payload.correo = sanitizarCampoCorreo(payload.correo);
        if(payload.whatsapp !== undefined) payload.whatsapp = sanitizarCampoWhatsApp(payload.whatsapp);
      }
      var res = await fetch(RESERVAS_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function(){ return null; });
      return data;
    }catch(e){
      console.error('Error enviando datos al backend', e);
      return null;
    }
  }

  // Sube el comprobante directo a Supabase Storage (bucket privado
  // 'comprobantes') desde el navegador, y devuelve el path guardado.
  // Reemplaza el envío de comprobanteBase64 dentro del POST: ahora el
  // archivo va aparte, más liviano y sin límites de tamaño de payload JSON.
  async function subirComprobante(file, fileName){
    var ext = (fileName.split('.').pop() || 'bin').toLowerCase();
    var path = 'reservas/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var { error } = await supabaseClient.storage.from('comprobantes').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });
    if(error){
      console.error('Error subiendo comprobante', error);
      return null;
    }
    return path;
  }

  var RESERVA_INFO = {};
  var COMPROBANTE_FILE = null; // File original, se sube a Storage recién al confirmar el envío
  var PLAN_PRICES = { 'Oficina': 18000, 'Gaming': 25000, 'Gaming Plus': 45000 };

  // Contador opcional del hero. Completá este número SOLO si es real y
  // verificable. Si lo dejás en 0, el bloque "+XX PCs optimizadas" no se muestra.
  var PCS_OPTIMIZADAS = 0;

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

  // ⚠️ Si cambiás esto, cambiá también PLAN_DURATION en supabase/functions/reservas/index.ts
  var PLAN_DURATION = { 'Oficina': 20, 'Gaming': 30, 'Gaming Plus': 45 };

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
    var day = d.getDay();
    if(day === 0 || day === 6) return { start: 13*60, end: 18*60 };
    return { start: 18*60, end: 22*60 };
  }

  function overlaps(aStart, aEnd, bStart, bEnd){
    return aStart < bEnd && bStart < aEnd;
  }

  var ANTELACION_MINIMA_MIN = 120;

  // Trae de la Edge Function los turnos ya reservados para una fecha dada.
  function fetchBookedFromBackend(dateStr){
    var url = RESERVAS_FUNCTION_URL + '?fecha=' + encodeURIComponent(dateStr);
    return fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'apikey': SUPABASE_ANON_KEY
      }
    })
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

  function contarTurnosDisponiblesHoy(booked){
    var today = new Date().toISOString().slice(0,10);
    var range = dayRange(today);
    var now = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var duration = PLAN_DURATION['Gaming'];
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
    fetchBookedFromBackend(today).then(function(booked){
      var n = contarTurnosDisponiblesHoy(booked);
      badges.forEach(function(el){
        if(n > 0){
          el.textContent = n === 1 ? 'Queda 1 turno disponible hoy' : 'Quedan ' + n + ' turnos disponibles hoy';
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      });
    }).catch(function(){
      badges.forEach(function(el){ el.style.display = 'none'; });
    });
  }

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

    fetchBookedFromBackend(dateStr).then(function(booked){
      if(thisRequest !== slotsRequestToken) return;
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
    initTestimonialCarousel();
    initReviewRatingStars();
    initSpecularButtons();
    initSpotlightCards();

    var pcsEl = document.getElementById('pcsOptimizadas');
    if(pcsEl && PCS_OPTIMIZADAS > 0){
      var countEl = pcsEl.querySelector('[data-count-to]');
      if(countEl){
        countEl.setAttribute('data-count-to', PCS_OPTIMIZADAS);
        countEl.setAttribute('data-start', '0');
        if('IntersectionObserver' in window){
          requestAnimationFrame(function(){ animateCount(countEl); });
        } else {
          countEl.textContent = PCS_OPTIMIZADAS;
        }
      }
      pcsEl.style.display = '';
    }
  });

  function initSpecularButtons(){
    var buttons = document.querySelectorAll('.btn-specular');
    if(!buttons.length) return;
    buttons.forEach(function(btn){
      btn.style.setProperty('--specular-x','50%');
      btn.style.setProperty('--specular-y','40%');
      btn.addEventListener('pointermove', function(event){
        var rect = btn.getBoundingClientRect();
        var x = event.clientX - rect.left;
        var y = event.clientY - rect.top;
        var px = Math.max(0, Math.min(1, x / rect.width));
        var py = Math.max(0, Math.min(1, y / rect.height));
        btn.style.setProperty('--specular-x', (px * 100).toFixed(2) + '%');
        btn.style.setProperty('--specular-y', (py * 100).toFixed(2) + '%');
      });
      btn.addEventListener('pointerleave', function(){
        btn.style.setProperty('--specular-x','50%');
        btn.style.setProperty('--specular-y','40%');
      });
    });
  }

  function initSpotlightCards(){
    var cards = document.querySelectorAll('.spotlight-card');
    if(!cards.length) return;
    cards.forEach(function(card){
      var color = card.getAttribute('data-spotlight-color') || 'rgba(79, 168, 255, 0.14)';
      card.style.setProperty('--spotlight-color', color);
      card.style.setProperty('--mouse-x', '50%');
      card.style.setProperty('--mouse-y', '50%');
      card.addEventListener('pointermove', function(event){
        var rect = card.getBoundingClientRect();
        var x = event.clientX - rect.left;
        var y = event.clientY - rect.top;
        var px = Math.max(0, Math.min(100, (x / rect.width) * 100));
        var py = Math.max(0, Math.min(100, (y / rect.height) * 100));
        card.style.setProperty('--mouse-x', px.toFixed(2) + '%');
        card.style.setProperty('--mouse-y', py.toFixed(2) + '%');
      });
      card.addEventListener('pointerleave', function(){
        card.style.setProperty('--mouse-x', '50%');
        card.style.setProperty('--mouse-y', '50%');
      });
    });
  }

  function initReviewRatingStars(){
    var groups = document.querySelectorAll('.rating-stars');
    if(!groups.length) return;

    function updateStars(group){
      var labels = Array.prototype.slice.call(group.querySelectorAll('label.star'));
      var checked = group.querySelector('input[name="reviewRating"]:checked');
      labels.forEach(function(label){
        var value = parseFloat(label.getAttribute('data-value')) || 0;
        label.classList.remove('selected');
        if(checked){
          var selectedValue = parseFloat(checked.value);
          if(value <= selectedValue){
            label.classList.add('selected');
          }
        }
      });
    }

    groups.forEach(function(group){
      group.addEventListener('change', function(){ updateStars(group); });
      group.addEventListener('pointerover', function(event){
        var target = event.target.closest('label.star');
        if(!target) return;
        var labels = Array.prototype.slice.call(group.querySelectorAll('label.star'));
        var hoverValue = parseFloat(target.getAttribute('data-value')) || 0;
        labels.forEach(function(label){
          var value = parseFloat(label.getAttribute('data-value')) || 0;
          if(value <= hoverValue){
            label.classList.add('selected');
          } else {
            label.classList.remove('selected');
          }
        });
      });
      group.addEventListener('pointerleave', function(){ updateStars(group); });
      var labels = Array.prototype.slice.call(group.querySelectorAll('label.star'));
      labels.forEach(function(label){
        label.addEventListener('click', function(event){
          var input = label.querySelector('input[name="reviewRating"]');
          if(input){
            input.checked = true;
            updateStars(group);
          }
        });
      });
      updateStars(group);
    });
  }

  function initTestimonialCarousel(){
    var section = document.getElementById('testimonios');
    if(!section) return;
    var trackWrap = section.querySelector('.carousel-track-wrap');
    var track = section.querySelector('.carousel-track');
    if(!trackWrap || !track) return;

    var cards = Array.prototype.slice.call(track.querySelectorAll('.testimonial-card'));
    if(cards.length === 0) return;

    var state = {
      isDragging: false,
      startX: 0,
      startTranslate: 0,
      currentTranslate: 0,
      minTranslate: 0,
      maxTranslate: 0,
      originalWidth: 0
    };

    function clamp(value, min, max){
      return Math.min(Math.max(value, min), max);
    }

    function calculateOriginalWidth(){
      var total = 0;
      cards.forEach(function(card, index){
        var rect = card.getBoundingClientRect();
        total += rect.width;
        if(index > 0) total += 18;
      });
      return total;
    }

    function createClones(){
      cards.slice().reverse().forEach(function(card){
        track.insertBefore(card.cloneNode(true), track.firstChild);
      });
      cards.forEach(function(card){
        track.appendChild(card.cloneNode(true));
      });
    }

    function updateBounds(){
      state.originalWidth = calculateOriginalWidth();
      var trackRect = track.getBoundingClientRect();
      var wrapRect = trackWrap.getBoundingClientRect();
      state.maxTranslate = 0;
      state.minTranslate = Math.min(0, wrapRect.width - trackRect.width);
      wrapPosition();
      state.currentTranslate = clamp(state.currentTranslate, state.minTranslate, state.maxTranslate);
      track.style.transition = 'transform .24s ease';
      track.style.transform = 'translateX(' + state.currentTranslate + 'px)';
    }

    function playDemo(){
      if(sessionStorage.getItem('testimonialCarouselDemoShown')) return;
      sessionStorage.setItem('testimonialCarouselDemoShown', '1');
      var offset = Math.min(140, state.originalWidth / 2);
      window.requestAnimationFrame(function(){
        track.style.transition = 'transform 1.2s ease';
        track.style.transform = 'translateX(' + (state.currentTranslate - offset) + 'px)';
        setTimeout(function(){
          track.style.transition = 'transform 1.2s ease';
          track.style.transform = 'translateX(' + state.currentTranslate + 'px)';
        }, 1400);
      });
    }

    function beginDrag(event){
      if(event.pointerType === 'mouse' && event.button !== 0) return;
      state.isDragging = true;
      state.startX = event.clientX;
      state.startTranslate = state.currentTranslate;
      track.style.transition = 'none';
      trackWrap.classList.add('dragging');
      trackWrap.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function wrapPosition(){
      while(state.currentTranslate > -state.originalWidth){
        state.currentTranslate -= state.originalWidth;
      }
      while(state.currentTranslate < -state.originalWidth * 2){
        state.currentTranslate += state.originalWidth;
      }
    }

    function moveDrag(event){
      if(!state.isDragging) return;
      var delta = event.clientX - state.startX;
      state.currentTranslate = state.startTranslate + delta;
      wrapPosition();
      track.style.transform = 'translateX(' + state.currentTranslate + 'px)';
    }

    function endDrag(){
      if(!state.isDragging) return;
      state.isDragging = false;
      trackWrap.classList.remove('dragging');
      wrapPosition();
      track.style.transition = 'transform .24s ease';
      track.style.transform = 'translateX(' + state.currentTranslate + 'px)';
    }

    state.originalWidth = calculateOriginalWidth();
    createClones();
    state.currentTranslate = -state.originalWidth;

    trackWrap.addEventListener('pointerdown', beginDrag);
    trackWrap.addEventListener('pointermove', moveDrag);
    trackWrap.addEventListener('pointerup', endDrag);
    trackWrap.addEventListener('pointerleave', endDrag);
    trackWrap.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', function(){
      updateBounds();
      state.currentTranslate = clamp(state.currentTranslate, state.minTranslate, state.maxTranslate);
      track.style.transform = 'translateX(' + state.currentTranslate + 'px)';
    });

    updateBounds();

    if('IntersectionObserver' in window){
      var observer = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(entry.isIntersecting && entry.intersectionRatio > 0.2){
            playDemo();
            observer.disconnect();
          }
        });
      }, { threshold: 0.2, rootMargin: '0px 0px -20% 0px' });
      observer.observe(section);
    } else {
      playDemo();
    }
  }

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
        discord: (document.getElementById('discord') || {}).value || ''
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

    var honeypotEl = document.getElementById('empresaWeb');
    if(honeypotEl && honeypotEl.value){
      showStep(4);
      var panelHp = document.querySelector('.form-panel');
      if(panelHp) panelHp.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }

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

      // 1. Subir el comprobante directo a Storage (si hay uno elegido)
      var comprobantePath = null;
      if(COMPROBANTE_FILE){
        if(btn) btn.textContent = 'Subiendo comprobante...';
        comprobantePath = await subirComprobante(COMPROBANTE_FILE, COMPROBANTE_FILE.name);
        if(!comprobantePath){
          if(btn){ btn.disabled = false; btn.textContent = 'Enviar comprobante'; }
          if(sendErrorEl) sendErrorEl.classList.add('show');
          return;
        }
      }

      if(btn) btn.textContent = 'Enviando...';

      // 2. Crear la reserva con el path del comprobante ya subido
      result = await sendToBackend({
        type: 'reserva',
        nombreCompleto: RESERVA_INFO.nombreCompleto || '',
        correo: RESERVA_INFO.correo || '',
        whatsapp: RESERVA_INFO.whatsapp || '',
        discord: RESERVA_INFO.discord || '',
        plan: planName,
        fecha: fecha,
        horario: horario,
        comentarios: comentariosEl ? comentariosEl.value : '',
        comprobantePath: comprobantePath,
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

  window.submitReview = async function(){
    var errorEl = document.getElementById('reviewError');
    var successEl = document.getElementById('reviewSuccess');
    var btn = document.getElementById('btnSubmitReview');
    var honeypotEl = document.getElementById('reviewWeb');
    var nameEl = document.getElementById('reviewName');
    var ratingEl = document.querySelector('input[name="reviewRating"]:checked');
    var pcEl = document.getElementById('reviewPC');
    var msgEl = document.getElementById('reviewMessage');

    if(errorEl){ errorEl.classList.remove('show'); }
    if(successEl){ successEl.style.display = 'none'; }

    if(honeypotEl && honeypotEl.value){
      if(successEl) successEl.style.display = 'block';
      if(btn){ btn.disabled = true; btn.textContent = 'Enviado'; }
      return;
    }

    if(!nameEl || !ratingEl || !msgEl || !nameEl.value.trim() || !msgEl.value.trim()){
      if(errorEl){ errorEl.textContent = 'Completá tu nombre, la calificación y el mensaje para enviar la reseña.'; errorEl.classList.add('show'); }
      return;
    }

    if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }

    var result = null;
    try{
      result = await sendToBackend({
        type: 'review',
        nombreCompleto: nameEl.value.trim(),
        rating: ratingEl.value,
        pc: pcEl ? pcEl.value.trim() : '',
        mensaje: msgEl.value.trim(),
      });
    }catch(e){
      console.error(e);
      result = null;
    }

    if(btn){ btn.disabled = false; btn.textContent = 'Enviar reseña'; }

    if(!result || !result.ok){
      if(errorEl){ errorEl.textContent = 'No se pudo enviar tu reseña ahora. Intentá de nuevo en unos minutos.'; errorEl.classList.add('show'); }
      return;
    }

    if(successEl){ successEl.style.display = 'block'; }
    if(btn){ btn.disabled = true; }
    nameEl.value = '';
    if(pcEl) pcEl.value = '';
    if(msgEl) msgEl.value = '';
    document.querySelectorAll('input[name="reviewRating"]').forEach(function(r){ r.checked = false; if(r.parentElement) r.parentElement.classList.remove('selected'); });
  };

  window.submitExtraData = async function(){
    var msgEl = document.getElementById('extraDataMsg');
    var errEl = document.getElementById('sendErrorExtra');
    var btn = document.getElementById('btnSubmitExtra');
    if(errEl) errEl.classList.remove('show');

    var correo = RESERVA_INFO.correo || '';
    var nombreCompleto = RESERVA_INFO.nombreCompleto || '';
    var pais = (document.getElementById('pais') || {}).value || '';
    var edad = (document.getElementById('edadExtra') || {}).value || '';
    var genero = (document.getElementById('generoExtra') || {}).value || '';
    var juegoExtra = (document.getElementById('juegoExtra') || {}).value || '';

    if(btn){ btn.disabled = true; btn.textContent = 'Enviando...'; }

    var result = await sendToBackend({
      type: 'extra',
      correo: correo,
      nombreCompleto: nombreCompleto,
      pais: pais,
      edad: edad,
      genero: genero,
      juegoExtra: juegoExtra
    });

    if(btn){ btn.disabled = false; btn.textContent = 'Enviar'; }

    if(!result || !result.ok){
      if(errEl) errEl.classList.add('show');
      return;
    }
    if(msgEl) msgEl.style.display = 'block';
    if(btn) btn.style.display = 'none';
  };

  // fileChosen: ahora solo valida y guarda el File original en memoria
  // (COMPROBANTE_FILE). La subida real a Storage pasa en submitReserva(),
  // recién cuando el usuario confirma el envío.
  window.fileChosen = function(input){
    try{
      var fname = document.getElementById('fname');
      var errEl = document.getElementById('uploadFileError');
      var MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB
      var TIPOS_VALIDOS = ['image/jpeg', 'image/png', 'application/pdf'];

      if(errEl){ errEl.textContent = ''; errEl.classList.remove('show'); }

      function formatSize(bytes){
        if(bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        return Math.max(1, Math.round(bytes / 1024)) + ' KB';
      }

      function showUploadError(text){
        if(fname) fname.textContent = '';
        COMPROBANTE_FILE = null;
        try{ input.value = ''; }catch(e2){}
        if(errEl){
          errEl.textContent = text;
          errEl.classList.add('show');
        }
      }

      if(fname && input.files && input.files[0]){
        var file = input.files[0];

        if(TIPOS_VALIDOS.indexOf(file.type) === -1){
          showUploadError('Formato no permitido. Subí una imagen (JPG/PNG) o un PDF.');
          return;
        }
        if(file.size > MAX_FILE_SIZE){
          showUploadError('El archivo pesa más de 8MB. Subí uno más liviano para poder enviarlo.');
          return;
        }

        if(file.type.indexOf('image/') === 0){
          // Redimensionar con canvas antes de guardar, igual que antes,
          // para no subir fotos de 12MB directas de un celular.
          var MAX_IMG_DIM = 1600;
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
            canvas.toBlob(function(blob){
              COMPROBANTE_FILE = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
              fname.textContent = file.name + ' (' + formatSize(blob.size) + ')';
            }, 'image/jpeg', 0.75);
            URL.revokeObjectURL(imgUrl);
          };
          img.onerror = function(){
            URL.revokeObjectURL(imgUrl);
            showUploadError('No se pudo procesar la imagen. Probá con otro archivo.');
          };
          img.src = imgUrl;
        }else{
          COMPROBANTE_FILE = file;
          fname.textContent = file.name + ' (' + formatSize(file.size) + ')';
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
  var sections = document.querySelectorAll('section.section');

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
          if(entry.target.matches('section.section')){
            entry.target.classList.add('is-visible');
          }
        }
      });
    }, {threshold:0.2});
    counters.forEach(function(c){ obs.observe(c); });
    bars.forEach(function(b){ obs.observe(b); });
    sections.forEach(function(section){ obs.observe(section); });
  } else {
    counters.forEach(function(c){ c.textContent = c.getAttribute('data-count-to'); });
    bars.forEach(function(b){ b.style.width = b.getAttribute('data-fill') + '%'; });
    sections.forEach(function(section){ section.classList.add('is-visible'); });
  }

  if(reduceMotion){
    sections.forEach(function(section){ section.classList.add('is-visible'); });
  }

})();
