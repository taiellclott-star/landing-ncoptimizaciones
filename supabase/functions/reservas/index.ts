// Edge Function: reservas
// Reemplaza doGet() y doPost() del Code.gs original.
//
// GET  /reservas?fecha=YYYY-MM-DD   -> turnos ocupados ese día + duración de planes
// POST /reservas                    -> body { type: 'reserva' | 'extra' | 'review', ... }
//
// Variables de entorno necesarias (Supabase → Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL              (ya viene seteada por defecto)
//   SUPABASE_SERVICE_ROLE_KEY (ya viene seteada por defecto)
//   RECAPTCHA_SECRET_KEY
//   RESEND_API_KEY
//   MAIL_NOTIFICACION         ej: "taielclott@gmail.com,taieljuega@gmail.com"
//   MAIL_FROM                 ej: "NC Optimizaciones <reservas@ncoptimizaciones.com>" (dominio verificado en Resend)

import { createClient } from "npm:@supabase/supabase-js@2";

const PLAN_DURATION: Record<string, number> = {
  "Oficina": 20,
  "Gaming": 30,
  "Gaming Plus": 45,
};
const PLANES_VALIDOS = Object.keys(PLAN_DURATION);

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_WHATSAPP = /^\+?[0-9\s()-]{8,15}$/;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORARIO = /^\d{1,2}:\d{2}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // podés restringir a tu dominio: 'https://www.ncoptimizaciones.com'
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function rangoAtencion(fecha: string) {
  const d = new Date(fecha + "T00:00:00");
  const day = d.getDay(); // 0 domingo ... 6 sábado
  if (day === 0 || day === 6) return { start: 13 * 60, end: 18 * 60 };
  return { start: 18 * 60, end: 22 * 60 };
}

function sanitizarTexto(v: unknown, maxLen: number) {
  let s = String(v ?? "").trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  return s;
}

function sanitizarCorreo(v: unknown) {
  let s = String(v ?? "").trim();
  s = s.replace(/[\r\n\t\u0000-\u001f\u007f]/g, "");
  s = s.replace(/[<>'"`]/g, "");
  s = s.replace(/\s+/g, "");
  if (s.length > 254) s = s.substring(0, 254);
  return s;
}

function sanitizarWhatsApp(v: unknown) {
  let s = String(v ?? "").trim();
  s = s.replace(/[\r\n\t\u0000-\u001f\u007f]/g, "");
  s = s.replace(/[<>'"`]/g, "");
  s = s.replace(/[^\d+\-\s()]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 20) s = s.substring(0, 20);
  return s;
}

async function verificarRecaptcha(token: string | undefined) {
  const secretKey = Deno.env.get("RECAPTCHA_SECRET_KEY");
  if (!secretKey) {
    console.warn("RECAPTCHA_SECRET_KEY no configurada, se deja pasar sin validar.");
    return true; // si todavía no configuraste recaptcha, no bloqueamos reservas
  }
  if (!token) return false;
  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token }),
    });
    const result = await res.json();
    const UMBRAL_SCORE = 0.5;
    return !!(result?.success && (typeof result.score !== "number" || result.score >= UMBRAL_SCORE));
  } catch (err) {
    console.error("Error verificando reCAPTCHA:", err);
    return false;
  }
}

// Rate limit simple: máx 3 solicitudes por correo/whatsapp cada 10 min,
// consultando las reservas recientes en la propia tabla.
async function excedeFrecuencia(correo: string, whatsapp: string) {
  const clave = (correo || whatsapp || "").toLowerCase();
  if (!clave) return false;
  const desde = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("reservas")
    .select("id", { count: "exact", head: true })
    .gte("created_at", desde)
    .or(`correo.eq.${correo},whatsapp.eq.${whatsapp}`);
  return (count ?? 0) >= 3;
}

function validarReserva(data: any) {
  if (!String(data.nombreCompleto || "").trim()) return "Falta el nombre completo.";
  if (!String(data.correo || "").trim()) return "Falta el correo.";
  if (!String(data.whatsapp || "").trim()) return "Falta el WhatsApp.";
  if (!String(data.plan || "").trim()) return "Falta el plan.";
  if (!String(data.fecha || "").trim()) return "Falta la fecha.";
  if (!String(data.horario || "").trim()) return "Falta el horario.";

  if (!PLANES_VALIDOS.includes(data.plan)) return "El plan elegido no es válido.";
  if (!REGEX_EMAIL.test(String(data.correo).trim())) return "El correo no tiene un formato válido.";
  if (!REGEX_WHATSAPP.test(String(data.whatsapp).trim())) return "El WhatsApp no tiene un formato válido.";
  if (!REGEX_FECHA.test(String(data.fecha).trim())) return "La fecha no tiene el formato esperado (YYYY-MM-DD).";
  if (!REGEX_HORARIO.test(String(data.horario).trim())) return "El horario no tiene el formato esperado (HH:MM).";

  const [hh, mm] = String(data.horario).trim().split(":");
  const horarioMin = Number(hh) * 60 + Number(mm || 0);
  const rango = rangoAtencion(String(data.fecha).trim());
  const duracion = PLAN_DURATION[data.plan] || 30;
  if (horarioMin < rango.start || horarioMin + duracion > rango.end) {
    return "El horario elegido está fuera del rango de atención para ese día.";
  }
  return null;
}

function validarReview(data: any) {
  if (!String(data.nombreCompleto || "").trim()) return "Falta el nombre completo.";
  if (!String(data.rating || "").trim()) return "Falta la calificación.";
  if (!String(data.mensaje || "").trim()) return "Falta el mensaje de la reseña.";
  return null;
}

async function hayConflicto(fecha: string, horario: string, plan: string) {
  const [hh, mm] = horario.split(":");
  const newStart = Number(hh) * 60 + Number(mm || 0);
  const newDuration = PLAN_DURATION[plan] || 30;
  const newEnd = newStart + newDuration;

  const { data: rows, error } = await supabase
    .from("reservas")
    .select("horario, plan")
    .eq("fecha", fecha)
    .neq("estado", "cancelado");

  if (error) throw error;

  for (const row of rows ?? []) {
    const [rhh, rmm] = String(row.horario).split(":");
    const rowStart = Number(rhh) * 60 + Number(rmm || 0);
    const rowDuration = PLAN_DURATION[row.plan as string] || 30;
    const rowEnd = rowStart + rowDuration;
    if (newStart < rowEnd && rowStart < newEnd) return true;
  }
  return false;
}

async function enviarMail(to: string[], subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY o MAIL_FROM no configurados, no se manda mail.");
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
  } catch (err) {
    console.error("Error enviando mail:", err);
  }
}

async function handleGet(url: URL) {
  const fecha = url.searchParams.get("fecha");
  if (!fecha) return json({ turnos: [], planDuration: PLAN_DURATION });

  const { data: rows, error } = await supabase
    .from("reservas")
    .select("horario, plan")
    .eq("fecha", fecha)
    .neq("estado", "cancelado");

  if (error) {
    console.error("Error en GET /reservas:", error);
    return json({ turnos: [], planDuration: PLAN_DURATION });
  }

  const turnos = (rows ?? []).map((row) => {
    const [hh, mm] = String(row.horario).split(":");
    const start = Number(hh) * 60 + Number(mm || 0);
    const duration = PLAN_DURATION[row.plan as string] || 30;
    return { start, duration };
  });

  return json({ turnos, planDuration: PLAN_DURATION });
}

async function handlePost(data: any) {
  if (!["reserva", "extra", "review"].includes(data?.type)) {
    return json({ ok: false, error: "Tipo de solicitud inválido" }, 400);
  }

  if (data.type === "reserva") {
    data.correo = sanitizarCorreo(data.correo);
    data.whatsapp = sanitizarWhatsApp(data.whatsapp);

    const errorValidacion = validarReserva(data);
    if (errorValidacion) {
      return json({ ok: false, reason: "validation_error", error: errorValidacion }, 400);
    }

    const recaptchaOk = await verificarRecaptcha(data.recaptchaToken);
    if (!recaptchaOk) {
      return json({ ok: false, reason: "bot_suspected" }, 403);
    }

    if (await excedeFrecuencia(data.correo, data.whatsapp)) {
      return json({
        ok: false,
        reason: "rate_limited",
        error: "Se recibieron demasiadas solicitudes con este correo/WhatsApp en poco tiempo. Esperá unos minutos y volvé a intentar.",
      }, 429);
    }

    if (await hayConflicto(data.fecha, data.horario, data.plan)) {
      return json({ ok: false, reason: "slot_taken", error: "Ese turno ya no está disponible." }, 409);
    }

    const { error: insertError } = await supabase.from("reservas").insert({
      nombre_completo: sanitizarTexto(data.nombreCompleto, 200),
      correo: data.correo,
      whatsapp: data.whatsapp,
      discord: sanitizarTexto(data.discord, 200),
      plan: data.plan,
      fecha: data.fecha,
      horario: data.horario,
      comentarios: sanitizarTexto(data.comentarios, 1000),
      comprobante_path: data.comprobantePath || null,
    });

    if (insertError) {
      console.error("Error insertando reserva:", insertError);
      return json({ ok: false, error: "No se pudo guardar la reserva." }, 500);
    }

    const mailDest = (Deno.env.get("MAIL_NOTIFICACION") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (mailDest.length) {
      await enviarMail(
        mailDest,
        `🎮 Nueva reserva: ${data.nombreCompleto} — ${data.plan}`,
        `Nombre: ${data.nombreCompleto}\nCorreo: ${data.correo}\nWhatsApp: ${data.whatsapp}\nDiscord: ${data.discord || ""}\nPlan: ${data.plan}\nFecha: ${data.fecha}\nHorario: ${data.horario}\nComentarios: ${data.comentarios || ""}\n\nRevisá el comprobante en el panel de admin.`,
      );
    }

    return json({ ok: true });
  }

  if (data.type === "extra") {
    const { error } = await supabase.from("datos_extra").insert({
      correo: sanitizarCorreo(data.correo),
      nombre_completo: sanitizarTexto(data.nombreCompleto, 200),
      pais: sanitizarTexto(data.pais, 200),
      edad: data.edad || null,
      genero: data.genero || null,
      juego_extra: sanitizarTexto(data.juegoExtra, 200),
    });
    if (error) {
      console.error("Error insertando datos_extra:", error);
      return json({ ok: false, error: "No se pudieron guardar los datos." }, 500);
    }
    return json({ ok: true });
  }

  // review
  const errorValidacion = validarReview(data);
  if (errorValidacion) {
    return json({ ok: false, reason: "validation_error", error: errorValidacion }, 400);
  }

  const { error } = await supabase.from("resenas").insert({
    nombre_completo: sanitizarTexto(data.nombreCompleto, 200),
    rating: Number(data.rating),
    pc: sanitizarTexto(data.pc, 200),
    mensaje: sanitizarTexto(data.mensaje, 1000),
  });

  if (error) {
    console.error("Error insertando reseña:", error);
    return json({ ok: false, error: "No se pudo guardar la reseña." }, 500);
  }

  const mailDest = (Deno.env.get("MAIL_NOTIFICACION") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (mailDest.length) {
    await enviarMail(
      mailDest,
      `📝 Nueva reseña pendiente: ${data.nombreCompleto}`,
      `Nombre: ${data.nombreCompleto}\nCalificación: ${data.rating}\nPC: ${data.pc || ""}\nMensaje: ${data.mensaje}`,
    );
  }

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      return await handleGet(url);
    }

    if (req.method === "POST") {
      const data = await req.json();
      return await handlePost(data);
    }

    return json({ ok: false, error: "Método no soportado" }, 405);
  } catch (err) {
    console.error("Error en Edge Function reservas:", err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
