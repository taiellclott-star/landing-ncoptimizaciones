-- ============================================================
-- NC Optimizaciones — Migración inicial a Supabase
-- Reemplaza la planilla de Google Sheets (pestañas Reservas,
-- Datos extra y Reseñas) por tres tablas de Postgres.
-- ============================================================

create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ----------------------------------------------------------------
-- Tabla: reservas
-- ----------------------------------------------------------------
create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  nombre_completo text not null,
  correo text not null,
  whatsapp text not null,
  discord text,

  plan text not null check (plan in ('Oficina', 'Gaming', 'Gaming Plus')),
  fecha date not null,
  horario text not null, -- formato 'HH:MM'

  comentarios text,

  -- path dentro del bucket 'comprobantes' de Storage, no la URL pública
  -- (el bucket es privado, se generan signed URLs cuando hace falta verlo)
  comprobante_path text,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmado', 'cancelado')),

  recordatorio_enviado boolean not null default false
);

create index if not exists idx_reservas_fecha on public.reservas (fecha);
create index if not exists idx_reservas_fecha_horario on public.reservas (fecha, horario);
create index if not exists idx_reservas_estado on public.reservas (estado);

-- Evita doble-reserva del mismo slot exacto (la superposición por duración
-- de plan se sigue validando en la Edge Function, esto es un extra de
-- integridad a nivel de base de datos)
create unique index if not exists idx_reservas_fecha_horario_unica
  on public.reservas (fecha, horario)
  where estado <> 'cancelado';

-- ----------------------------------------------------------------
-- Tabla: datos_extra
-- ----------------------------------------------------------------
create table if not exists public.datos_extra (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  correo text,
  nombre_completo text,
  pais text,
  edad int,
  genero text,
  juego_extra text
);

-- ----------------------------------------------------------------
-- Tabla: resenas
-- ----------------------------------------------------------------
create table if not exists public.resenas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre_completo text not null,
  rating int not null check (rating between 1 and 5),
  pc text,
  mensaje text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada'))
);

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------
-- Las escrituras (INSERT) las hace SIEMPRE la Edge Function con la
-- service_role key, que ignora RLS. Por eso acá NO hay policy de INSERT
-- pública: nadie puede escribir directo a la tabla desde el navegador,
-- todo pasa por la validación del backend (Edge Function).
--
-- La LECTURA (SELECT) se habilita solo para usuarios autenticados
-- (vos, desde el panel de admin con tu login de Supabase Auth).

alter table public.reservas enable row level security;
alter table public.datos_extra enable row level security;
alter table public.resenas enable row level security;

create policy "admin puede leer reservas"
  on public.reservas for select
  to authenticated
  using (true);

create policy "admin puede actualizar reservas"
  on public.reservas for update
  to authenticated
  using (true);

create policy "admin puede leer datos_extra"
  on public.datos_extra for select
  to authenticated
  using (true);

create policy "admin puede leer resenas"
  on public.resenas for select
  to authenticated
  using (true);

create policy "admin puede actualizar resenas"
  on public.resenas for update
  to authenticated
  using (true);

-- ----------------------------------------------------------------
-- Storage: bucket privado para comprobantes de pago
-- ----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- Cualquiera puede SUBIR un archivo (lo hace el cliente desde el
-- formulario, antes de que exista la reserva). No puede leer ni listar
-- lo que suben otros: solo el admin autenticado o la Edge Function
-- (service_role) pueden leer.
create policy "cualquiera puede subir comprobantes"
  on storage.objects for insert
  to public
  with check (bucket_id = 'comprobantes');

create policy "admin puede leer comprobantes"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'comprobantes');
