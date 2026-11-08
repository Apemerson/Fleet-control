import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const PROJECT_REF = 'owvbxpugkybolyojukqo';
const COOLIFY_APP_UUID = '0jbeyfwrs89micuxqyffglaw';
const COOLIFY_BASE_URL = 'https://coolify.emersontorres.com.br/api/v1';
const AUTH_FIELDS = [
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_admin_email', 'smtp_sender_name',
  'external_email_enabled', 'mailer_autoconfirm', 'mailer_secure_email_change_enabled',
  'password_hibp_enabled', 'password_min_length', 'disable_signup', 'site_url', 'rate_limit_email_sent',
];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function defaultKey(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw);
    return keys.default || Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

function safeAuthSettings(config: Record<string, unknown>) {
  return {
    smtpConfigured: Boolean(config.smtp_host && config.smtp_user),
    smtpHost: String(config.smtp_host || ''),
    smtpPort: String(config.smtp_port || '587'),
    smtpUser: String(config.smtp_user || ''),
    smtpAdminEmail: String(config.smtp_admin_email || ''),
    smtpSenderName: String(config.smtp_sender_name || ''),
    externalEmailEnabled: Boolean(config.external_email_enabled),
    mailerAutoconfirm: Boolean(config.mailer_autoconfirm),
    passwordHibpEnabled: Boolean(config.password_hibp_enabled),
    passwordMinLength: Number(config.password_min_length || 8),
    emailRateLimit: Number(config.rate_limit_email_sent || 2),
    disableSignup: Boolean(config.disable_signup),
    siteUrl: String(config.site_url || ''),
  };
}

async function readResponse(response: Response) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const message = body.message || body.msg || `Serviço respondeu com status ${response.status}.`;
    throw new Error(String(message).slice(0, 240));
  }
  return body;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Método não permitido.' }, 405);

  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return respond({ error: 'Sessão inválida.' }, 401);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || defaultKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS'));
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || defaultKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!supabaseUrl || !anonKey || !secretKey) return respond({ error: 'Serviço administrativo indisponível.' }, 503);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return respond({ error: 'Sessão inválida.' }, 401);
  const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await adminClient.from('users').select('role').eq('id', authData.user.id).maybeSingle();
  if (profile?.role !== 'admin') return respond({ error: 'Acesso restrito ao administrador.' }, 403);

  let input: Record<string, any>;
  try { input = await request.json(); } catch { return respond({ error: 'Requisição inválida.' }, 400); }
  const action = input.action;
  if (typeof action !== 'string') return respond({ error: 'Ação inválida.' }, 400);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!token || token.length > 1000) return respond({ error: 'Informe um token administrativo válido.' }, 400);

  try {
    if (action === 'supabase_auth_read' || action === 'supabase_auth_update') {
      const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
      if (action === 'supabase_auth_read') {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        return respond(safeAuthSettings(await readResponse(response)));
      }
      const incoming = input.settings;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return respond({ error: 'Configuração inválida.' }, 400);
      const settings: Record<string, unknown> = {};
      for (const key of AUTH_FIELDS) if (key in incoming) settings[key] = incoming[key];
      if (typeof settings.smtp_port === 'string' && !/^\d{1,5}$/.test(settings.smtp_port)) return respond({ error: 'Porta SMTP inválida.' }, 400);
      if (typeof settings.password_min_length === 'number' && (settings.password_min_length < 8 || settings.password_min_length > 72)) return respond({ error: 'A senha mínima deve ficar entre 8 e 72 caracteres.' }, 400);
      if (typeof settings.rate_limit_email_sent === 'number' && (settings.rate_limit_email_sent < 1 || settings.rate_limit_email_sent > 1000)) return respond({ error: 'O limite de e-mails precisa ficar entre 1 e 1000 por hora.' }, 400);
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      await readResponse(response);
      const refreshed = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      return respond(safeAuthSettings(await readResponse(refreshed)));
    }

    if (action.startsWith('coolify_')) {
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      if (action === 'coolify_app_read') {
        const response = await fetch(`${COOLIFY_BASE_URL}/applications/${COOLIFY_APP_UUID}`, { headers });
        const app = await readResponse(response);
        return respond({
          status: app.status || '', fqdn: app.fqdn || '', gitBranch: app.git_branch || '',
          gitRepository: app.git_repository || '', healthCheckEnabled: Boolean(app.health_check_enabled),
          healthCheckPath: app.health_check_path || '/',
        });
      }
      if (action === 'coolify_domain_update') {
        const fqdn = typeof input.fqdn === 'string' ? input.fqdn.trim() : '';
        let parsed: URL;
        try { parsed = new URL(fqdn); } catch { return respond({ error: 'Informe um domínio HTTPS válido.' }, 400); }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return respond({ error: 'Informe um domínio HTTPS válido, sem credenciais, parâmetros ou fragmentos.' }, 400);
        const response = await fetch(`${COOLIFY_BASE_URL}/applications/${COOLIFY_APP_UUID}`, { method: 'PATCH', headers, body: JSON.stringify({ fqdn }) });
        const result = await readResponse(response);
        return respond({ fqdn: result.fqdn || fqdn });
      }
      if (action === 'coolify_health_update') {
        const enabled = Boolean(input.enabled);
        const path = typeof input.path === 'string' ? input.path.trim() : '';
        if (!path.startsWith('/') || path.length > 200 || path.includes('..')) return respond({ error: 'Informe um caminho de health check válido.' }, 400);
        const response = await fetch(`${COOLIFY_BASE_URL}/applications/${COOLIFY_APP_UUID}`, {
          method: 'PATCH', headers, body: JSON.stringify({ health_check_enabled: enabled, health_check_path: path }),
        });
        const result = await readResponse(response);
        return respond({ healthCheckEnabled: Boolean(result.health_check_enabled), healthCheckPath: result.health_check_path || path });
      }
      if (action === 'coolify_env_read') {
        const response = await fetch(`${COOLIFY_BASE_URL}/applications/${COOLIFY_APP_UUID}/envs`, { headers });
        const variables = await readResponse(response);
        return respond({ variables: (Array.isArray(variables) ? variables : []).map((item: any) => ({
          key: String(item.key || ''), isBuildtime: Boolean(item.is_buildtime), isRuntime: Boolean(item.is_runtime),
          isPreview: Boolean(item.is_preview), isShownOnce: Boolean(item.is_shown_once),
        })) });
      }
      if (action === 'coolify_env_update') {
        const key = typeof input.key === 'string' ? input.key.trim() : '';
        const value = typeof input.value === 'string' ? input.value : '';
        if (!/^[A-Z][A-Z0-9_]{1,100}$/.test(key) || value.length > 10000) return respond({ error: 'Nome ou valor da variável inválido.' }, 400);
        const response = await fetch(`${COOLIFY_BASE_URL}/applications/${COOLIFY_APP_UUID}/envs`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ key, value, is_buildtime: true, is_runtime: false, is_preview: false }),
        });
        await readResponse(response);
        return respond({ saved: true, key });
      }
      if (action === 'coolify_deploy') {
        const response = await fetch(`${COOLIFY_BASE_URL}/deploy?uuid=${COOLIFY_APP_UUID}`, { method: 'POST', headers });
        return respond(await readResponse(response));
      }
    }
    return respond({ error: 'Ação desconhecida.' }, 400);
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Não foi possível concluir a operação.').replaceAll(token, '[token oculto]');
    return respond({ error: message }, 502);
  }
});
