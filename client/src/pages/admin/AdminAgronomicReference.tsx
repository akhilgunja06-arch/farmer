import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { admin as adminApi } from '@/lib/services';
import { ApiError, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Select, TextArea, TextInput } from '@/components/ui/Field';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * Verified agronomic reference data.
 *
 * This page is the only way a cost, yield or duration figure enters the advisor.
 * The source field is required because a figure without a citation would be
 * presented to a farmer as verified fact — the form refuses to save one.
 */

const SEASONS = ['kharif', 'rabi', 'zaid', 'perennial', 'any'] as const;
const UNITS = ['kg', 'quintal', 'tonne', 'piece', 'bag', 'other'] as const;
const IRRIGATION = ['low', 'medium', 'high'] as const;

const EMPTY = {
  crop_name: '', state: '', district: '', season: 'kharif', variety: '',
  cost_per_acre: '', yield_per_acre: '', yield_unit: 'quintal',
  duration_days: '', irrigation_needs: '', suitable_soils: '',
  notes: '', source: '', source_ref: '', observed_on: '',
};

export default function AdminAgronomicReference() {
  const { t } = useTranslation();
  useDocumentTitle(t('admin.referenceData'));

  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [removing, setRemoving] = useState<number | null>(null);
  const result = useAsync((signal) => adminApi.agronomicReference(signal), []);

  // Withdrawing a figure the advisor currently quotes. Confirmed first, because a
  // farmer may be relying on it in an open conversation.
  const remove = async (id: number, label: string) => {
    if (!window.confirm(`${t('admin.removeReferenceConfirm')}\n\n${label}`)) return;
    setError(null);
    setRemoving(id);
    try {
      await adminApi.deleteAgronomicReference(id);
      result.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? messageOf(caught) : t('common.somethingWentWrong'));
    } finally {
      setRemoving(null);
    }
  };

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setError(null);
    setSaved(null);

    if (!form.crop_name.trim() || !form.state.trim() || !form.source.trim() || !form.observed_on) {
      setError(t('admin.referenceRequired'));
      return;
    }
    if (!form.cost_per_acre && !form.yield_per_acre) {
      setError(t('admin.referenceNeedFigure'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        crop_name: form.crop_name.trim(),
        state: form.state.trim(),
        season: form.season,
        source: form.source.trim(),
        observed_on: form.observed_on,
        ...(form.district.trim() ? { district: form.district.trim() } : {}),
        ...(form.variety.trim() ? { variety: form.variety.trim() } : {}),
        ...(form.cost_per_acre ? { cost_per_acre: Number(form.cost_per_acre) } : {}),
        ...(form.yield_per_acre ? { yield_per_acre: Number(form.yield_per_acre) } : {}),
        ...(form.yield_per_acre && form.yield_unit ? { yield_unit: form.yield_unit } : {}),
        ...(form.duration_days ? { duration_days: Number(form.duration_days) } : {}),
        ...(form.irrigation_needs ? { irrigation_needs: form.irrigation_needs } : {}),
        ...(form.suitable_soils.trim()
          ? {
              suitable_soils: form.suitable_soils
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        ...(form.source_ref.trim() ? { source_ref: form.source_ref.trim() } : {}),
      };

      await adminApi.saveAgronomicReference(payload);
      setSaved(`${form.crop_name.trim()} · ${form.state.trim()}`);
      setForm({ ...EMPTY });
      result.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? messageOf(caught) : t('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RoleShell role="admin" title={t('admin.referenceData')}>
      <div className="space-y-5">
        <Notice tone="info" title={t('admin.referenceData')}>
          {t('admin.referenceHelp')}
        </Notice>

        <Card>
          <CardHeader title={t('admin.addReference')} />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                name="ref-crop"
                label={t('farmer.productName')}
                required
                value={form.crop_name}
                onChange={(e) => set('crop_name')(e.target.value)}
              />
              <TextInput
                name="ref-state"
                label={t('common.state')}
                required
                value={form.state}
                onChange={(e) => set('state')(e.target.value)}
              />
              <TextInput
                name="ref-district"
                label={t('common.district')}
                hint={t('admin.referenceDistrictHint')}
                value={form.district}
                onChange={(e) => set('district')(e.target.value)}
              />
              <Select
                name="ref-season"
                label={t('advisor.season')}
                value={form.season}
                onChange={(e) => set('season')(e.target.value)}
              >
                {SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
              <TextInput
                name="ref-variety"
                label={t('product.variety')}
                value={form.variety}
                onChange={(e) => set('variety')(e.target.value)}
              />
              <TextInput
                name="ref-cost"
                label={t('advisor.costPerAcre')}
                type="number"
                min="0"
                inputMode="decimal"
                value={form.cost_per_acre}
                onChange={(e) => set('cost_per_acre')(e.target.value)}
              />
              <TextInput
                name="ref-yield"
                label={t('advisor.expectedYield')}
                type="number"
                min="0"
                inputMode="decimal"
                value={form.yield_per_acre}
                onChange={(e) => set('yield_per_acre')(e.target.value)}
              />
              <Select
                name="ref-yield-unit"
                label={t('advisor.expectedYield')} unit
                value={form.yield_unit}
                onChange={(e) => set('yield_unit')(e.target.value)}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t(`units.${u}`)}
                  </option>
                ))}
              </Select>
              <TextInput
                name="ref-duration"
                label={t('advisor.duration')}
                hint={t('admin.referenceDaysHint')}
                type="number"
                min="1"
                inputMode="numeric"
                value={form.duration_days}
                onChange={(e) => set('duration_days')(e.target.value)}
              />
              <Select
                name="ref-irrigation"
                label={t('advisor.irrigationNeed')}
                value={form.irrigation_needs}
                onChange={(e) => set('irrigation_needs')(e.target.value)}
              >
                <option value="">—</option>
                {IRRIGATION.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
              <TextInput
                name="ref-soils"
                label={t('advisor.suitableSoils')}
                hint={t('admin.referenceSoilsHint')}
                value={form.suitable_soils}
                onChange={(e) => set('suitable_soils')(e.target.value)}
              />
              <TextInput
                name="ref-observed"
                label={t('advisor.observedOn')}
                required
                type="date"
                value={form.observed_on}
                onChange={(e) => set('observed_on')(e.target.value)}
              />
            </div>

            <TextInput
              name="ref-source"
              label={t('advisor.source')}
              required
              hint={t('admin.referenceSourceHint')}
              value={form.source}
              onChange={(e) => set('source')(e.target.value)}
            />
            <TextInput
              name="ref-source-ref"
              label={t('admin.referenceSourceRef')}
              value={form.source_ref}
              onChange={(e) => set('source_ref')(e.target.value)}
            />
            <TextArea
              name="ref-notes"
              label={t('admin.referenceNotes')}
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {saved ? (
              <Notice tone="success">
                {t('admin.referenceSaved')} {saved}
              </Notice>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={submit} loading={saving}>
                <Plus className="size-4" aria-hidden="true" />
                {t('admin.addReference')}
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('admin.recordedFigures')} />
          <CardBody className="p-0">
            {result.loading ? (
              <div className="p-5">
                <Spinner />
              </div>
            ) : result.error ? (
              <div className="p-5">
                <ErrorState message={result.error} onRetry={result.reload} />
              </div>
            ) : (result.data?.reference ?? []).length === 0 ? (
              <div className="p-5">
                <Notice tone="warning" title={t('advisor.noReferenceDataTitle')}>
                  {t('advisor.noReferenceDataBody')}
                </Notice>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-soil-50 text-left text-xs uppercase text-soil-600">
                    <tr>
                      <th className="px-5 py-2.5">{t('advisor.crop')}</th>
                      <th className="px-5 py-2.5">{t('farmer.state')}</th>
                      <th className="px-5 py-2.5">{t('farmer.season')}</th>
                      <th className="px-5 py-2.5">{t('advisor.costPerAcre')}</th>
                      <th className="px-5 py-2.5">{t('advisor.expectedYield')}</th>
                      <th className="px-5 py-2.5">{t('advisor.source')}</th>
                      <th className="px-5 py-2.5">{t('advisor.observedOn')}</th>
                      <th className="px-5 py-2.5">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.data?.reference ?? []).map((row, i) => (
                      <tr key={String(row.id ?? i)} className="border-t border-soil-100">
                        <td className="px-5 py-2.5 font-medium text-soil-900">
                          {String(row.crop_name ?? '')}
                          {row.variety ? (
                            <span className="block text-xs text-soil-500">{String(row.variety)}</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-2.5">
                          {String(row.state ?? '')}
                          {row.district ? (
                            <span className="block text-xs text-soil-500">{String(row.district)}</span>
                          ) : null}
                        </td>
                        <td className="px-5 py-2.5">{String(row.season ?? '')}</td>
                        <td className="px-5 py-2.5 tabular-nums">
                          {row.cost_per_acre !== null && row.cost_per_acre !== undefined
                            ? `₹${Number(row.cost_per_acre).toLocaleString('en-IN')}`
                            : '—'}
                        </td>
                        <td className="px-5 py-2.5 tabular-nums">
                          {row.yield_per_acre !== null && row.yield_per_acre !== undefined
                            ? `${Number(row.yield_per_acre)} ${String(row.yield_unit ?? '')}`
                            : '—'}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-soil-600">{String(row.source ?? '')}</td>
                        <td className="px-5 py-2.5 tabular-nums text-xs">
                          {String(row.observed_on ?? '')}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={removing === Number(row.id)}
                            onClick={() =>
                              remove(
                                Number(row.id),
                                `${String(row.crop_name)} · ${String(row.state)} · ${String(row.season)}`,
                              )
                            }
                            aria-label={`${t('admin.removeReference')}: ${String(row.crop_name)}`}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
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
