import React, { useState } from 'react';
import {
  AuthMailSettings,
  CoolifyApplicationSettings,
  CoolifyEnvSummary,
  platformAdminService,
} from '../services/platformAdminService';

const inputClass = 'w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white font-semibold outline-none focus:border-blue-500';
const labelClass = 'block text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider';

const emptyAuth: AuthMailSettings = {
  smtpConfigured: false,
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpAdminEmail: '',
  smtpSenderName: 'ET Frota',
  externalEmailEnabled: false,
  mailerAutoconfirm: false,
  passwordHibpEnabled: false,
  passwordMinLength: 8,
  emailRateLimit: 2,
  disableSignup: false,
  siteUrl: '',
};

export const PlatformSettings: React.FC = () => {
  const [supabaseToken, setSupabaseToken] = useState('');
  const [coolifyToken, setCoolifyToken] = useState('');
  const [authSettings, setAuthSettings] = useState<AuthMailSettings>(emptyAuth);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [coolifyApp, setCoolifyApp] = useState<CoolifyApplicationSettings | null>(null);
  const [variables, setVariables] = useState<CoolifyEnvSummary[]>([]);
  const [selectedVariable, setSelectedVariable] = useState('');
  const [variableValue, setVariableValue] = useState('');
  const [domainDraft, setDomainDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
      setNotice({ text: message, error: true });
    } finally {
      setBusy('');
    }
  };

  const loadAuth = () => run('auth-read', async () => {
    if (!supabaseToken.trim()) throw new Error('Informe o token de gerenciamento do Supabase.');
    const result = await platformAdminService.readAuthSettings(supabaseToken.trim());
    setAuthSettings(result);
    setNotice({ text: 'Configurações de autenticação carregadas.' });
  });

  const saveAuth = () => run('auth-save', async () => {
    if (!supabaseToken.trim()) throw new Error('Informe o token de gerenciamento do Supabase.');
    if (!authSettings.smtpHost.trim() || !authSettings.smtpUser.trim() || !authSettings.smtpAdminEmail.trim()) {
      throw new Error('Preencha host, usuário e e-mail remetente do SMTP.');
    }
    if (!authSettings.smtpConfigured && !smtpPassword) throw new Error('Informe a senha do SMTP para configurar o envio de e-mails.');
    const settings: Record<string, unknown> = {
      smtp_host: authSettings.smtpHost.trim(),
      smtp_port: authSettings.smtpPort,
      smtp_user: authSettings.smtpUser.trim(),
      smtp_admin_email: authSettings.smtpAdminEmail.trim(),
      smtp_sender_name: authSettings.smtpSenderName.trim(),
      external_email_enabled: true,
      mailer_autoconfirm: authSettings.mailerAutoconfirm,
      password_hibp_enabled: authSettings.passwordHibpEnabled,
      password_min_length: authSettings.passwordMinLength,
      rate_limit_email_sent: authSettings.emailRateLimit,
      disable_signup: authSettings.disableSignup,
    };
    if (authSettings.siteUrl.trim()) settings.site_url = authSettings.siteUrl.trim();
    if (smtpPassword) settings.smtp_pass = smtpPassword;
    const result = await platformAdminService.updateAuthSettings(supabaseToken.trim(), settings);
    setAuthSettings(result);
    setSmtpPassword('');
    setNotice({ text: 'Autenticação, SMTP e segurança atualizados no Supabase.' });
  });

  const loadCoolify = async () => {
    if (!coolifyToken.trim()) throw new Error('Informe um token de API do Coolify.');
    const [app, env] = await Promise.all([
      platformAdminService.readCoolifyApp(coolifyToken.trim()),
      platformAdminService.listCoolifyEnv(coolifyToken.trim()),
    ]);
    setCoolifyApp(app);
    setDomainDraft(app.fqdn);
    setVariables(env.variables);
    setNotice({ text: 'Configurações do Coolify carregadas; os valores das variáveis secretas permanecem ocultos.' });
  };

  const saveCoolifyDomain = () => run('coolify-domain', async () => {
    if (!coolifyToken.trim()) throw new Error('Informe um token de API do Coolify.');
    const result = await platformAdminService.updateCoolifyDomain(coolifyToken.trim(), domainDraft.trim());
    setDomainDraft(result.fqdn);
    setNotice({ text: 'Domínio atualizado no Coolify.' });
  });

  const saveCoolifyEnv = () => run('coolify-env', async () => {
    if (!coolifyToken.trim()) throw new Error('Informe um token de API do Coolify.');
    if (!selectedVariable || !variableValue) throw new Error('Escolha uma variável e informe o novo valor.');
    await platformAdminService.updateCoolifyEnv(coolifyToken.trim(), selectedVariable, variableValue);
    setVariableValue('');
    setNotice({ text: `${selectedVariable} atualizada. Faça uma implantação para aplicar a alteração.` });
  });

  const deploy = () => run('coolify-deploy', async () => {
    if (!coolifyToken.trim()) throw new Error('Informe um token de API do Coolify.');
    if (!window.confirm('Iniciar uma nova implantação do ET Frota agora?')) return;
    const result = await platformAdminService.deployCoolifyApp(coolifyToken.trim());
    setNotice({ text: result.deployment_uuid ? `Implantação iniciada: ${result.deployment_uuid}` : (result.message || 'Implantação solicitada.') });
  });

  return (
    <div className="space-y-6">
      {notice && <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${notice.error ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'}`} role="status">{notice.text}</div>}

      <section className="bg-black/30 backdrop-blur-xl rounded-3xl p-7 border border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-lg font-black uppercase tracking-wider flex items-center gap-3"><i className="fas fa-envelope text-emerald-300"></i> E-mail e autenticação</h3>
            <p className="text-sm text-gray-400 mt-2">Controla SMTP, confirmação de cadastro e proteção de senha pelo Supabase Management API.</p>
          </div>
          <a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 font-bold">Criar token com auth_config_read e auth_config_write <i className="fas fa-external-link-alt ml-1"></i></a>
        </div>
        <label className={labelClass}>Token temporário do Supabase</label>
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input type="password" autoComplete="off" value={supabaseToken} onChange={e => setSupabaseToken(e.target.value)} className={`${inputClass} flex-1`} placeholder="sbp_…" />
          <button type="button" onClick={loadAuth} disabled={busy !== ''} className="rounded-xl bg-white/10 hover:bg-white/15 px-5 py-3 text-sm font-bold disabled:opacity-50">{busy === 'auth-read' ? 'Carregando…' : 'Carregar configurações'}</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={labelClass}>Servidor SMTP</label><input value={authSettings.smtpHost} onChange={e => setAuthSettings({ ...authSettings, smtpHost: e.target.value })} className={inputClass} placeholder="smtp.seuprovedor.com" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelClass}>Porta</label><input value={authSettings.smtpPort} onChange={e => setAuthSettings({ ...authSettings, smtpPort: e.target.value })} className={inputClass} placeholder="587" /></div>
            <div><label className={labelClass}>Usuário SMTP</label><input value={authSettings.smtpUser} onChange={e => setAuthSettings({ ...authSettings, smtpUser: e.target.value })} className={inputClass} placeholder="Usuário do provedor" /></div>
          </div>
          <div><label className={labelClass}>Senha SMTP (opcional para manter a atual)</label><input type="password" autoComplete="new-password" value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} className={inputClass} placeholder={authSettings.smtpConfigured ? 'Deixe em branco para manter a senha atual' : 'Senha SMTP'} /></div>
          <div><label className={labelClass}>E-mail remetente</label><input type="email" value={authSettings.smtpAdminEmail} onChange={e => setAuthSettings({ ...authSettings, smtpAdminEmail: e.target.value })} className={inputClass} placeholder="no-reply@seudominio.com.br" /></div>
          <div><label className={labelClass}>Nome remetente</label><input value={authSettings.smtpSenderName} onChange={e => setAuthSettings({ ...authSettings, smtpSenderName: e.target.value })} className={inputClass} placeholder="ET Frota" /></div>
          <div><label className={labelClass}>URL principal do app no Auth</label><input type="url" value={authSettings.siteUrl} onChange={e => setAuthSettings({ ...authSettings, siteUrl: e.target.value })} className={inputClass} placeholder="https://frota.seudominio.com.br" /></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
          <label className="flex items-center gap-3 rounded-xl bg-white/5 p-4 text-sm"><input type="checkbox" checked={authSettings.mailerAutoconfirm} onChange={e => setAuthSettings({ ...authSettings, mailerAutoconfirm: e.target.checked })} /> Confirmar e-mail automaticamente</label>
          <label className="flex items-center gap-3 rounded-xl bg-white/5 p-4 text-sm"><input type="checkbox" checked={authSettings.passwordHibpEnabled} onChange={e => setAuthSettings({ ...authSettings, passwordHibpEnabled: e.target.checked })} /> Bloquear senhas vazadas</label>
          <label className="flex items-center gap-3 rounded-xl bg-white/5 p-4 text-sm"><input type="checkbox" checked={authSettings.disableSignup} onChange={e => setAuthSettings({ ...authSettings, disableSignup: e.target.checked })} /> Bloquear novos cadastros</label>
          <div className="rounded-xl bg-white/5 p-4"><label className={labelClass}>Tamanho mínimo da senha</label><input type="number" min={8} max={72} value={authSettings.passwordMinLength} onChange={e => setAuthSettings({ ...authSettings, passwordMinLength: Number(e.target.value) })} className={inputClass} /></div>
          <div className="rounded-xl bg-white/5 p-4"><label className={labelClass}>Limite de e-mails por hora</label><input type="number" min={1} max={1000} value={authSettings.emailRateLimit} onChange={e => setAuthSettings({ ...authSettings, emailRateLimit: Number(e.target.value) })} className={inputClass} /></div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <span className={`text-xs font-bold ${authSettings.smtpConfigured ? 'text-emerald-300' : 'text-amber-300'}`}>{authSettings.smtpConfigured ? 'SMTP aparece configurado' : 'SMTP ainda não foi carregado/configurado'}</span>
          <button type="button" onClick={saveAuth} disabled={busy !== ''} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-3 text-sm font-bold disabled:opacity-50">{busy === 'auth-save' ? 'Salvando…' : 'Salvar Auth e SMTP'}</button>
          <p className="basis-full text-xs text-gray-500">O token é usado somente nesta sessão da página. Configure SPF, DKIM e DMARC no DNS do domínio remetente.</p>
        </div>
      </section>

      <section className="bg-black/30 backdrop-blur-xl rounded-3xl p-7 border border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-lg font-black uppercase tracking-wider flex items-center gap-3"><i className="fas fa-cloud text-blue-300"></i> Coolify e implantação</h3>
            <p className="text-sm text-gray-400 mt-2">Domínio, variáveis de build e início de implantação do Fleet Control.</p>
          </div>
          <a href="https://coolify.emersontorres.com.br/" target="_blank" rel="noreferrer" className="text-xs text-blue-300 hover:text-blue-200 font-bold">Abrir Coolify <i className="fas fa-external-link-alt ml-1"></i></a>
        </div>
        <label className={labelClass}>Token de API do Coolify (temporário)</label>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <input type="password" autoComplete="off" value={coolifyToken} onChange={e => setCoolifyToken(e.target.value)} className={`${inputClass} flex-1`} placeholder="Token da API" />
          <button type="button" onClick={() => run('coolify-read', loadCoolify)} disabled={busy !== ''} className="rounded-xl bg-white/10 hover:bg-white/15 px-5 py-3 text-sm font-bold disabled:opacity-50">{busy === 'coolify-read' ? 'Carregando…' : 'Carregar app'}</button>
        </div>
        {coolifyApp && <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 p-4 mb-5 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${coolifyApp.status.includes('healthy') ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            <strong>{coolifyApp.status || 'Status indisponível'}</strong><span className="text-gray-500">{coolifyApp.gitRepository} · {coolifyApp.gitBranch}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Domínio HTTPS</label>
              <div className="flex gap-2"><input type="url" value={domainDraft} onChange={e => setDomainDraft(e.target.value)} className={`${inputClass} flex-1`} /><button type="button" onClick={saveCoolifyDomain} disabled={busy !== ''} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 font-bold disabled:opacity-50">Salvar</button></div>
            </div>
            <div>
              <label className={labelClass}>Health check</label>
              <div className="flex gap-2">
                <label className="flex items-center gap-2 rounded-xl bg-white/5 px-3 text-sm whitespace-nowrap"><input type="checkbox" checked={coolifyApp.healthCheckEnabled} onChange={e => setCoolifyApp({ ...coolifyApp, healthCheckEnabled: e.target.checked })} />Ativo</label>
                <input value={coolifyApp.healthCheckPath} onChange={e => setCoolifyApp({ ...coolifyApp, healthCheckPath: e.target.value })} className={`${inputClass} flex-1`} aria-label="Caminho do health check" />
                <button type="button" onClick={() => run('coolify-health', async () => {
                  if (!coolifyToken.trim() || !coolifyApp) throw new Error('Carregue o app com seu token do Coolify.');
                  const result = await platformAdminService.updateCoolifyHealthCheck(coolifyToken.trim(), coolifyApp.healthCheckEnabled, coolifyApp.healthCheckPath);
                  setCoolifyApp({ ...coolifyApp, healthCheckEnabled: result.healthCheckEnabled, healthCheckPath: result.healthCheckPath });
                  setNotice({ text: 'Health check atualizado no Coolify.' });
                })} disabled={busy !== ''} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 font-bold disabled:opacity-50">Salvar</button>
              </div>
            </div>
            <div>
              <label className={labelClass}>Variável de build existente</label>
              <div className="flex gap-2">
                <select value={selectedVariable} onChange={e => setSelectedVariable(e.target.value)} className={`${inputClass} flex-1`}>
                  <option value="" className="text-gray-900">Escolha uma variável</option>
                  {variables.filter(variable => !variable.isPreview).map(variable => <option key={variable.key} value={variable.key} className="text-gray-900">{variable.key}{variable.isShownOnce ? ' · secreta' : ''}</option>)}
                </select>
                <input aria-label="Novo valor da variável" type="password" autoComplete="new-password" value={variableValue} onChange={e => setVariableValue(e.target.value)} className="w-32 bg-white/10 border border-white/20 rounded-xl px-3 text-white outline-none focus:border-blue-500" placeholder="Novo valor" />
                <button type="button" onClick={saveCoolifyEnv} disabled={busy !== '' || !selectedVariable || !variableValue} className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 font-bold disabled:opacity-50">Salvar</button>
              </div>
              <p className="text-xs text-gray-500 mt-2">Os valores atuais não são lidos nem exibidos. Variáveis de build exigem nova implantação.</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button type="button" onClick={deploy} disabled={busy !== ''} className="rounded-xl bg-amber-500 hover:bg-amber-600 text-gray-950 px-5 py-3 text-sm font-black disabled:opacity-50">{busy === 'coolify-deploy' ? 'Solicitando…' : 'Implantar agora'}</button>
            <span className="text-xs text-gray-500">A implantação pode deixar o app indisponível por alguns minutos.</span>
          </div>
        </>}
      </section>
    </div>
  );
};
