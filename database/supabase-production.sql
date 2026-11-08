-- ET Frota: schema inicial seguro para Supabase hospedado.
-- O papel de administrador é atribuído apenas ao endereço aprovado pelo proprietário.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone BIGINT UNIQUE,
  role TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  plate TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Passeio' CHECK (type IN ('Passeio', 'Utilitario')),
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT,
  blocked_at TIMESTAMPTZ,
  blocked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vehicle_status (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  vehicle_name TEXT UNIQUE NOT NULL,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT,
  blocked_at TIMESTAMPTZ,
  blocked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.reservations (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employee_name TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  start_odometer BIGINT NOT NULL CHECK (start_odometer >= 0),
  end_odometer BIGINT CHECK (end_odometer IS NULL OR end_odometer >= start_odometer),
  itinerary TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ CHECK (end_time IS NULL OR end_time >= start_time),
  status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.schedules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  reserver_name TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  title TEXT NOT NULL,
  description TEXT,
  deadline TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa', 'media', 'alta')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_progresso', 'concluida')),
  assigned_to TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  destination_name TEXT,
  destination_address TEXT,
  destination_latitude DOUBLE PRECISION,
  destination_longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.veiculos_posicoes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  reservation_id TEXT NOT NULL,
  veiculo_id TEXT NOT NULL,
  motorista_nome TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  velocidade DOUBLE PRECISION DEFAULT 0,
  precisao DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parado BOOLEAN DEFAULT FALSE,
  parado_desde TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notificacoes_parada (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  reservation_id TEXT NOT NULL,
  veiculo_id TEXT NOT NULL,
  motorista_nome TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  parado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visualizada BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS update_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_vehicle_status_updated_at ON public.vehicle_status;
CREATE TRIGGER update_vehicle_status_updated_at BEFORE UPDATE ON public.vehicle_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_tasks_updated_at ON public.tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Profile creation is tied to Supabase Auth. This is the only place profiles are inserted.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  user_role TEXT := CASE WHEN lower(NEW.email) = 'apemerson@hotmail.com' THEN 'admin' ELSE 'driver' END;
  phone_text TEXT := regexp_replace(COALESCE(NEW.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g');
BEGIN
  INSERT INTO public.users (id, name, email, phone, role)
  VALUES (
    NEW.id::TEXT,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''), split_part(NEW.email, '@', 1)),
    NEW.email,
    NULLIF(phone_text, '')::BIGINT,
    user_role
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Narrow SECURITY DEFINER helper avoids recursive RLS when checking administrator status.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid())::TEXT AND role = 'admin')
$$;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- Drivers need to know whether a vehicle is occupied, without receiving route or GPS data.
CREATE OR REPLACE FUNCTION public.get_active_vehicle_usage()
RETURNS TABLE (id TEXT, employee_name TEXT, vehicle TEXT, start_time TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.id, r.employee_name, r.vehicle, r.start_time
  FROM public.reservations r
  WHERE r.status = 'active' AND (SELECT auth.uid()) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.get_active_vehicle_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_vehicle_usage() TO authenticated;

CREATE OR REPLACE VIEW public.veiculos_posicoes_atual WITH (security_invoker = true) AS
SELECT DISTINCT ON (vp.veiculo_id) vp.id, vp.reservation_id, vp.veiculo_id, vp.motorista_nome,
  vp.lat, vp.lng, vp.velocidade, vp.precisao, vp.heading, vp.timestamp, vp.parado, vp.parado_desde
FROM public.veiculos_posicoes vp
JOIN public.reservations r ON r.id = vp.reservation_id
WHERE r.status = 'active' ORDER BY vp.veiculo_id, vp.timestamp DESC;

CREATE OR REPLACE VIEW public.active_trips WITH (security_invoker = true) AS
SELECT r.id, r.user_id, r.employee_name, r.vehicle, r.start_odometer, r.itinerary, r.start_time,
  EXTRACT(EPOCH FROM (NOW() - r.start_time))/60 AS duration_minutes
FROM public.reservations r WHERE r.status = 'active' ORDER BY r.start_time DESC;

CREATE OR REPLACE VIEW public.trip_statistics WITH (security_invoker = true) AS
SELECT employee_name, COUNT(*) AS total_trips,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_trips,
  SUM(CASE WHEN status = 'completed' THEN (end_odometer - start_odometer) ELSE 0 END) AS total_km,
  AVG(CASE WHEN status = 'completed' THEN (end_odometer - start_odometer) ELSE NULL END) AS avg_km_per_trip,
  MAX(start_time) AS last_trip_date
FROM public.reservations GROUP BY employee_name;

-- Seed only non-sensitive fleet settings; never seed a fixed admin account.
INSERT INTO public.vehicles (id, name, plate, type) VALUES
  ('polo-vw', 'Polo Volkswagen', 'ABC-1234', 'Passeio'),
  ('fiorino-fiat', 'Fiorino Fiat', 'DEF-5678', 'Utilitario') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.vehicle_status (id, vehicle_name) VALUES ('polo-vw', 'Polo Volkswagen') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app_settings (key, value) VALUES
  ('company_name', 'ET Frota'), ('logo_url', '/logo.png'),
  ('about_text', 'Sistema de controle de frota empresarial.') ON CONFLICT (key) DO NOTHING;

-- RLS on every exposed table. Re-running this migration safely refreshes policies.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['users','user_logs','vehicles','vehicle_status','reservations','schedules','tasks','app_settings','veiculos_posicoes','notificacoes_parada'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS users_read_self_or_admin ON public.users;
CREATE POLICY users_read_self_or_admin ON public.users FOR SELECT TO authenticated USING (id = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin()));
DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())::TEXT) WITH CHECK (id = (SELECT auth.uid())::TEXT);

DROP POLICY IF EXISTS logs_insert_self ON public.user_logs;
CREATE POLICY logs_insert_self ON public.user_logs FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid())::TEXT);
DROP POLICY IF EXISTS logs_read_admin ON public.user_logs;
CREATE POLICY logs_read_admin ON public.user_logs FOR SELECT TO authenticated USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS vehicles_read ON public.vehicles;
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS vehicles_admin_write ON public.vehicles;
CREATE POLICY vehicles_admin_write ON public.vehicles FOR ALL TO authenticated USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS vehicle_status_read ON public.vehicle_status;
CREATE POLICY vehicle_status_read ON public.vehicle_status FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS vehicle_status_admin_write ON public.vehicle_status;
CREATE POLICY vehicle_status_admin_write ON public.vehicle_status FOR ALL TO authenticated USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS reservations_read ON public.reservations;
CREATE POLICY reservations_read ON public.reservations FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin()));
DROP POLICY IF EXISTS reservations_insert_self ON public.reservations;
CREATE POLICY reservations_insert_self ON public.reservations FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid())::TEXT);
DROP POLICY IF EXISTS reservations_update_owner_admin ON public.reservations;
CREATE POLICY reservations_update_owner_admin ON public.reservations FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin())) WITH CHECK (user_id = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin()));
DROP POLICY IF EXISTS reservations_delete_admin ON public.reservations;
CREATE POLICY reservations_delete_admin ON public.reservations FOR DELETE TO authenticated USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS schedules_read_auth ON public.schedules;
CREATE POLICY schedules_read_auth ON public.schedules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS schedules_insert_self ON public.schedules;
CREATE POLICY schedules_insert_self ON public.schedules FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid())::TEXT);
DROP POLICY IF EXISTS schedules_admin_write ON public.schedules;
CREATE POLICY schedules_admin_write ON public.schedules FOR UPDATE TO authenticated USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS schedules_admin_delete ON public.schedules;
CREATE POLICY schedules_admin_delete ON public.schedules FOR DELETE TO authenticated USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS tasks_read_assigned_or_admin ON public.tasks;
CREATE POLICY tasks_read_assigned_or_admin ON public.tasks FOR SELECT TO authenticated USING (assigned_to = (SELECT auth.uid())::TEXT OR created_by = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin()));
DROP POLICY IF EXISTS tasks_insert_admin ON public.tasks;
CREATE POLICY tasks_insert_admin ON public.tasks FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_admin()));
DROP POLICY IF EXISTS tasks_update_assigned_or_admin ON public.tasks;
CREATE POLICY tasks_update_assigned_or_admin ON public.tasks FOR UPDATE TO authenticated USING (assigned_to = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin())) WITH CHECK (assigned_to = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin()));
DROP POLICY IF EXISTS tasks_delete_admin ON public.tasks;
CREATE POLICY tasks_delete_admin ON public.tasks FOR DELETE TO authenticated USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS settings_read ON public.app_settings;
CREATE POLICY settings_read ON public.app_settings FOR SELECT TO anon, authenticated USING (key <> 'webhook_url');
DROP POLICY IF EXISTS settings_admin_write ON public.app_settings;
CREATE POLICY settings_admin_write ON public.app_settings FOR ALL TO authenticated USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS positions_read_active ON public.veiculos_posicoes;
CREATE POLICY positions_read_active ON public.veiculos_posicoes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND (r.user_id = (SELECT auth.uid())::TEXT OR (SELECT private.is_admin()))));
DROP POLICY IF EXISTS positions_insert_owner ON public.veiculos_posicoes;
CREATE POLICY positions_insert_owner ON public.veiculos_posicoes FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND r.user_id = (SELECT auth.uid())::TEXT AND r.status = 'active'));
DROP POLICY IF EXISTS positions_admin_delete ON public.veiculos_posicoes;
CREATE POLICY positions_admin_delete ON public.veiculos_posicoes FOR DELETE TO authenticated USING ((SELECT private.is_admin()));

DROP POLICY IF EXISTS stops_insert_owner ON public.notificacoes_parada;
CREATE POLICY stops_insert_owner ON public.notificacoes_parada FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = reservation_id AND r.user_id = (SELECT auth.uid())::TEXT));
DROP POLICY IF EXISTS stops_admin_read_update ON public.notificacoes_parada;
CREATE POLICY stops_admin_read_update ON public.notificacoes_parada FOR ALL TO authenticated USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.app_settings, public.vehicles, public.vehicle_status TO anon;
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE (name, phone) ON public.users TO authenticated;
GRANT SELECT, INSERT ON public.user_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles, public.vehicle_status, public.reservations,
  public.schedules, public.tasks, public.app_settings, public.veiculos_posicoes, public.notificacoes_parada TO authenticated;
GRANT SELECT ON public.users, public.active_trips, public.veiculos_posicoes_atual TO authenticated;
GRANT SELECT ON public.trip_statistics TO authenticated;
REVOKE ALL ON public.users, public.user_logs, public.reservations, public.schedules, public.tasks,
  public.veiculos_posicoes, public.notificacoes_parada FROM anon;
REVOKE ALL ON public.trip_statistics FROM anon, authenticated;
GRANT SELECT ON public.trip_statistics TO authenticated;
