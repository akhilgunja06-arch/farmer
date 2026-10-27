import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { Card, CardBody, CardHeader, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatDateTime } from '@/lib/format';

interface IntegrationState {
  configured: boolean;
  webhookConfigured?: boolean;
  detail: string;
  envVars?: string[];
  records?: number;
}

interface SettingsResponse {
  settings: Array<{ key: string; value: unknown; description: string | null; updated_at: string }>;
  integrations: Record<string, IntegrationState>;
}

/**
 * Application settings and integration status.
 *
 * The integration panel is read from the server's own capability check, so it
 * reports what is actually configured in this deployment rather than what the
 * documentation wishes were configured. A missing provider shows as
 * "Not configured" with the exact environment variables it needs — no secret
 * values are ever sent to the browser, only their names.
 */
export default function AdminSettings() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.settings'));

  const result = useAsync(
    (signal) => adminApi.settings(signal) as Promise<unknown> as Promise<SettingsResponse>,
    [],
  );

  if (result.loading) {
    return (
      <RoleShell role="admin" title={t('admin.settings')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error || !result.data) {
    return (
      <RoleShell role="admin" title={t('admin.settings')}>
        <ErrorState
          message={result.error ?? t('common.somethingWentWrong')}
          onRetry={result.reload}
        />
      </RoleShell>
    );
  }

  const { settings, integrations } = result.data;

  return (
    <RoleShell role="admin" title={t('admin.settings')}>
      <div className="space-y-5">
        <Notice tone="info" title={t('admin.integrationStatus')}>
          {t('admin.auditHelp')}
        </Notice>

        <Card>
          <CardHeader title={t('admin.integrationStatus')} />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                  <tr>
                    <th className="px-5 py-2.5">{t('market.source')}</th>
                    <th className="px-5 py-2.5">{t('common.profile')}</th>
                    <th className="px-5 py-2.5">{t('market.disclosure')}</th>
                    <th className="px-5 py-2.5">{t('common.settings')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-soil-100">
                  {Object.entries(integrations).map(([name, state]) => (
                    <tr key={name}>
                      <td className="px-5 py-2.5 font-medium capitalize text-soil-900">{name}</td>
                      <td className="px-5 py-2.5">
                        {state.configured ? (
                          <Badge tone="success" icon={<CheckCircle2 className="size-3.5" aria-hidden="true" />}>
                            {t('admin.configured')}
                          </Badge>
                        ) : (
                          <Badge tone="warning" icon={<XCircle className="size-3.5" aria-hidden="true" />}>
                            {t('admin.notConfigured')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-soil-700">
                        {state.detail}
                        {typeof state.records === 'number' && (
                          <span className="ml-1 text-xs text-soil-500">
                            ({state.records} {t('common.results')})
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        {(state.envVars ?? []).length > 0 ? (
                          <code className="block text-xs text-soil-600">
                            {(state.envVars ?? []).join(', ')}
                          </code>
                        ) : (
                          <span className="text-soil-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('admin.settings')} />
          <CardBody className="p-0">
            {settings.length === 0 ? (
              <p className="px-5 py-4 text-sm text-soil-600">{t('common.noData')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('common.settings')}</th>
                      <th className="px-5 py-2.5">{t('common.profile')}</th>
                      <th className="px-5 py-2.5">{t('market.observedOn')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-soil-100">
                    {settings.map((setting) => (
                      <tr key={setting.key}>
                        <td className="px-5 py-2.5 font-medium text-soil-900">{setting.key}</td>
                        <td className="px-5 py-2.5 text-soil-700">
                          {setting.description ?? String(setting.value)}
                        </td>
                        <td className="px-5 py-2.5 text-soil-600">
                          {formatDateTime(setting.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </RoleShell>
  );
}
