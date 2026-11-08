import { supabase } from '../lib/supabase';

async function invokePlatformAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fleet-platform-admin', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export interface AuthMailSettings {
  smtpConfigured: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpAdminEmail: string;
  smtpSenderName: string;
  externalEmailEnabled: boolean;
  mailerAutoconfirm: boolean;
  passwordHibpEnabled: boolean;
  passwordMinLength: number;
  emailRateLimit: number;
  disableSignup: boolean;
  siteUrl: string;
}

export interface CoolifyApplicationSettings {
  status: string;
  fqdn: string;
  gitBranch: string;
  gitRepository: string;
  healthCheckEnabled: boolean;
  healthCheckPath: string;
}

export interface CoolifyEnvSummary {
  key: string;
  isBuildtime: boolean;
  isRuntime: boolean;
  isPreview: boolean;
  isShownOnce: boolean;
}

export const platformAdminService = {
  readAuthSettings(token: string) {
    return invokePlatformAdmin<AuthMailSettings>({ action: 'supabase_auth_read', token });
  },
  updateAuthSettings(token: string, settings: Record<string, unknown>) {
    return invokePlatformAdmin<AuthMailSettings>({ action: 'supabase_auth_update', token, settings });
  },
  readCoolifyApp(token: string) {
    return invokePlatformAdmin<CoolifyApplicationSettings>({ action: 'coolify_app_read', token });
  },
  updateCoolifyDomain(token: string, fqdn: string) {
    return invokePlatformAdmin<{ fqdn: string }>({ action: 'coolify_domain_update', token, fqdn });
  },
  updateCoolifyHealthCheck(token: string, enabled: boolean, path: string) {
    return invokePlatformAdmin<{ healthCheckEnabled: boolean; healthCheckPath: string }>({ action: 'coolify_health_update', token, enabled, path });
  },
  listCoolifyEnv(token: string) {
    return invokePlatformAdmin<{ variables: CoolifyEnvSummary[] }>({ action: 'coolify_env_read', token });
  },
  updateCoolifyEnv(token: string, key: string, value: string) {
    return invokePlatformAdmin({ action: 'coolify_env_update', token, key, value });
  },
  deployCoolifyApp(token: string) {
    return invokePlatformAdmin<{ message?: string; deployment_uuid?: string }>({ action: 'coolify_deploy', token });
  },
};
