-- Webhook URLs can contain bearer tokens. Keep them out of public app_settings reads.
DROP POLICY IF EXISTS settings_read ON public.app_settings;
CREATE POLICY settings_read
  ON public.app_settings
  FOR SELECT
  TO anon, authenticated
  USING (key <> 'webhook_url');

-- settings_admin_write is an ALL policy and continues to give admins access to the full settings row.
