import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getDefaultKey(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw);
    return keys.default || Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

function isAllowedWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (/^(10\.|127\.|192\.168\.|169\.254\.)/.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Método não permitido.' }, 405);

  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return jsonResponse({ error: 'Sessão inválida.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || getDefaultKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || getDefaultKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!supabaseUrl || !anonKey || !secretKey) return jsonResponse({ error: 'Serviço de configuração indisponível.' }, 503);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonResponse({ error: 'Sessão inválida.' }, 401);

  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Requisição inválida.' }, 400);
  }

  const isAdmin = async () => {
    const { data } = await adminClient.from('users').select('role').eq('id', authData.user.id).maybeSingle();
    return data?.role === 'admin';
  };

  if (input.action === 'status' || input.action === 'save') {
    if (!(await isAdmin())) return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403);
    if (input.action === 'status') {
      const { data, error } = await adminClient.from('app_settings').select('key').eq('key', 'webhook_url').maybeSingle();
      if (error) return jsonResponse({ error: 'Não foi possível consultar a integração.' }, 500);
      return jsonResponse({ configured: Boolean(data) });
    }

    const value = typeof input.url === 'string' ? input.url.trim() : '';
    if (value && (value.length > 2048 || !isAllowedWebhookUrl(value))) {
      return jsonResponse({ error: 'Informe uma URL HTTPS pública válida.' }, 400);
    }
    const result = value
      ? await adminClient.from('app_settings').upsert({ key: 'webhook_url', value, updated_at: new Date().toISOString() })
      : await adminClient.from('app_settings').delete().eq('key', 'webhook_url');
    if (result.error) return jsonResponse({ error: 'Não foi possível salvar a integração.' }, 500);
    return jsonResponse({ configured: Boolean(value) });
  }

  if (input.action === 'send') {
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      return jsonResponse({ error: 'Evento inválido.' }, 400);
    }
    const requested = input.payload as Record<string, unknown>;
    const event = requested.event;
    const recordId = event === 'trip_start' || event === 'trip_end' ? requested.tripId : requested.taskId;
    if (!['trip_start', 'trip_end', 'task_completed'].includes(String(event)) || typeof recordId !== 'string') {
      return jsonResponse({ error: 'Evento não permitido.' }, 400);
    }

    let eventPayload: Record<string, unknown>;
    if (event === 'trip_start' || event === 'trip_end') {
      const { data: trip } = await adminClient
        .from('reservations')
        .select('id, user_id, employee_name, vehicle, start_odometer, end_odometer, itinerary, start_time, end_time, status')
        .eq('id', recordId)
        .eq('user_id', authData.user.id)
        .maybeSingle();
      const expectedStatus = event === 'trip_start' ? 'active' : 'completed';
      if (!trip || trip.status !== expectedStatus) return jsonResponse({ error: 'Viagem não encontrada ou não pertence a este usuário.' }, 403);
      eventPayload = event === 'trip_start'
        ? { event, tripId: trip.id, motorista: trip.employee_name, vehicle: trip.vehicle, km_inicial: trip.start_odometer, itinerary: trip.itinerary }
        : {
            event,
            tripId: trip.id,
            motorista: trip.employee_name,
            vehicle: trip.vehicle,
            km_inicial: trip.start_odometer,
            km_final: trip.end_odometer,
            km_total: Number(trip.end_odometer || 0) - Number(trip.start_odometer || 0),
            duracao_minutos: trip.end_time && trip.start_time ? Math.round((new Date(trip.end_time).getTime() - new Date(trip.start_time).getTime()) / 60000) : null,
          };
    } else {
      const { data: task } = await adminClient
        .from('tasks')
        .select('id, title, assigned_to, status')
        .eq('id', recordId)
        .eq('assigned_to', authData.user.id)
        .maybeSingle();
      if (!task || task.status !== 'concluida') return jsonResponse({ error: 'Tarefa não encontrada ou não pertence a este usuário.' }, 403);
      const { data: profile } = await adminClient.from('users').select('name').eq('id', authData.user.id).maybeSingle();
      eventPayload = { event, taskId: task.id, taskTitle: task.title, userId: authData.user.id, userName: profile?.name || '' };
    }

    const serialized = JSON.stringify(eventPayload);
    if (new TextEncoder().encode(serialized).length > 16000) return jsonResponse({ error: 'Evento excede o tamanho permitido.' }, 413);

    const { data: setting, error } = await adminClient.from('app_settings').select('value').eq('key', 'webhook_url').maybeSingle();
    if (error) return jsonResponse({ error: 'Não foi possível carregar a integração.' }, 500);
    if (!setting?.value) return jsonResponse({ skipped: true });
    if (!isAllowedWebhookUrl(setting.value)) return jsonResponse({ error: 'A URL configurada não é permitida.' }, 400);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(setting.value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: new Date().toISOString(), ...eventPayload }),
        signal: controller.signal,
      });
      if (!response.ok) return jsonResponse({ error: `O webhook respondeu com status ${response.status}.` }, 502);
      return jsonResponse({ delivered: true });
    } catch {
      return jsonResponse({ error: 'Falha ao enviar o evento para o webhook.' }, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  return jsonResponse({ error: 'Ação desconhecida.' }, 400);
});
