// Edge Function: recordatorios
// Reemplaza enviarRecordatoriosTurno() + el trigger de tiempo del Code.gs.
// Se dispara sola cada 15 min vía Supabase Cron (ver README, paso 6).
//
// Busca reservas cuyo turno empieza dentro de los próximos 60 minutos y
// todavía no tienen el recordatorio enviado, les manda un mail al cliente,
// y marca recordatorio_enviado = true para no duplicar.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function enviarMail(to: string, subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY o MAIL_FROM no configurados, no se manda mail.");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  return res.ok;
}

Deno.serve(async () => {
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const mañana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Trae candidatas de hoy y mañana (cubre turnos que cruzan medianoche
  // en la ventana de 60 min) que todavía no tienen recordatorio enviado.
  const { data: reservas, error } = await supabase
    .from("reservas")
    .select("id, nombre_completo, correo, plan, fecha, horario")
    .in("fecha", [hoy, mañana])
    .neq("estado", "cancelado")
    .eq("recordatorio_enviado", false);

  if (error) {
    console.error("Error consultando reservas:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500 });
  }

  let enviados = 0;

  for (const r of reservas ?? []) {
    const reservaDate = new Date(`${r.fecha}T${r.horario}:00`);
    if (isNaN(reservaDate.getTime())) continue;

    const diffMin = Math.round((reservaDate.getTime() - ahora.getTime()) / 60000);
    if (diffMin < 0 || diffMin > 60) continue;
    if (!r.correo) continue;

    const asunto = "⏰ Recordatorio de turno · NC Optimizaciones";
    const cuerpo =
      `Hola ${r.nombre_completo || "cliente"},\n\n` +
      `Este es un recordatorio automático de tu turno para optimizar tu PC.\n` +
      `Plan: ${r.plan}\n` +
      `Fecha: ${r.fecha}\n` +
      `Horario: ${r.horario}\n\n` +
      `Te esperamos para la sesión. Si necesitás ajustar algo, respondé este mail o escribinos por Instagram DM.\n\n` +
      `NC Optimizaciones`;

    const ok = await enviarMail(r.correo, asunto, cuerpo);
    if (ok) {
      await supabase.from("reservas").update({ recordatorio_enviado: true }).eq("id", r.id);
      enviados++;
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados }), {
    headers: { "Content-Type": "application/json" },
  });
});
