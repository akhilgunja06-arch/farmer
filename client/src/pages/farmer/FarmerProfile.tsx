import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, ShieldCheck } from 'lucide-react';
import { RoleShell } from '@/components/layout/RoleShell';
import { useAsync } from '@/hooks/useCart';
import { farmers as farmersApi } from '@/lib/services';
import { fieldErrorsOf, messageOf } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, ErrorState, Notice, Spinner } from '@/components/ui/Card';
import { Checkbox, TextArea, TextInput } from '@/components/ui/Field';
import { VerificationBadge } from '@/components/ui/Badge';
import { LocationFields } from '@/components/forms/LocationFields';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { VerificationStatus } from '@/lib/types';

interface ProfileResponse {
  profile: {
    user_id: string;
    farm_name: string | null;
    state: string;
    district: string;
    village: string;
    public_address: string | null;
    latitude: number | null;
    longitude: number | null;
    location_public: boolean;
    farming_type: string[] | null;
    crops_cultivated: string[] | null;
    bio: string | null;
    offers_delivery: boolean;
    offers_pickup: boolean;
    verification_status: VerificationStatus;
    verification_note: string | null;
  };
}

/**
 * The farm profile.
 *
 * The location consent checkbox is the only thing that decides whether a
 * coordinate is ever published — the database view nulls the coordinates when
 * consent is absent, so unchecking it genuinely removes them from every public
 * response rather than merely hiding them in this form.
 */
export default function FarmerProfile() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.farmProfile'));

  const result = useAsync((signal) => farmersApi.profile(signal) as Promise<ProfileResponse>, []);
  const [form, setForm] = useState({
    farm_name: '',
    state: '',
    district: '',
    village: '',
    public_address: '',
    farming_type: '',
    crops_cultivated: '',
    bio: '',
    offers_delivery: true,
    offers_pickup: true,
    location_public: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const profile = result.data?.profile;
    if (!profile) return;
    setForm({
      farm_name: profile.farm_name ?? '',
      state: profile.state ?? '',
      district: profile.district ?? '',
      village: profile.village ?? '',
      public_address: profile.public_address ?? '',
      farming_type: (profile.farming_type ?? []).join(', '),
      crops_cultivated: (profile.crops_cultivated ?? []).join(', '),
      bio: profile.bio ?? '',
      offers_delivery: profile.offers_delivery,
      offers_pickup: profile.offers_pickup,
      location_public: profile.location_public,
    });
  }, [result.data]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    setSaved(false);
    setFailure(null);
    try {
      await farmersApi.updateProfile({
        farm_name: form.farm_name || null,
        state: form.state,
        district: form.district,
        village: form.village,
        public_address: form.public_address || null,
        farming_type: form.farming_type
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        crops_cultivated: form.crops_cultivated
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        bio: form.bio || null,
        offers_delivery: form.offers_delivery,
        offers_pickup: form.offers_pickup,
        location_public: form.location_public,
      });
      setSaved(true);
      result.reload();
    } catch (caught) {
      setErrors(fieldErrorsOf(caught));
      setFailure(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  if (result.loading) {
    return (
      <RoleShell role="farmer" title={t('nav.farmProfile')}>
        <Spinner />
      </RoleShell>
    );
  }

  if (result.error) {
    return (
      <RoleShell role="farmer" title={t('nav.farmProfile')}>
        <ErrorState message={result.error} onRetry={result.reload} />
      </RoleShell>
    );
  }

  const profile = result.data?.profile;

  return (
    <RoleShell role="farmer" title={t('nav.farmProfile')}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        {saved && <Notice tone="success">{t('auth.accountCreated')}</Notice>}

        <Card>
          <CardHeader
            title={t('farmer.verification')}
            subtitle={t('farmer.verificationHelp')}
            action={profile ? <VerificationBadge status={profile.verification_status} /> : undefined}
          />
          {profile?.verification_note && (
            <CardBody>
              <Notice tone="info" title={t('admin.reviewNote')}>
                {profile.verification_note}
              </Notice>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title={t('nav.farmProfile')} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <TextInput
              name="farm_name"
              label={t('auth.farmName')}
              value={form.farm_name}
              error={errors['farm_name']}
              onChange={(event) => setForm({ ...form, farm_name: event.target.value })}
            />
            <TextInput
              name="village"
              label={t('auth.village')}
              required
              value={form.village}
              error={errors['village']}
              onChange={(event) => setForm({ ...form, village: event.target.value })}
            />
            <div className="sm:col-span-2">
              <LocationFields
                state={form.state}
                district={form.district}
                required
                onStateChange={(value) => setForm({ ...form, state: value, district: '' })}
                onDistrictChange={(value) => setForm({ ...form, district: value })}
                stateError={errors['state']}
                districtError={errors['district']}
              />
            </div>
            <div className="sm:col-span-2">
              <TextArea
                name="public_address"
                label={t('auth.fullAddress')}
                hint="Shown to customers. Your exact coordinates stay private unless you allow them below."
                value={form.public_address}
                error={errors['public_address']}
                onChange={(event) => setForm({ ...form, public_address: event.target.value })}
              />
            </div>
            <TextInput
              name="farming_type"
              label={t('auth.farmingType')}
              hint={t('auth.cropsHint')}
              value={form.farming_type}
              onChange={(event) => setForm({ ...form, farming_type: event.target.value })}
            />
            <TextInput
              name="crops_cultivated"
              label={t('auth.cropsCultivated')}
              hint={t('auth.cropsHint')}
              value={form.crops_cultivated}
              onChange={(event) => setForm({ ...form, crops_cultivated: event.target.value })}
            />
            <div className="sm:col-span-2">
              <TextArea
                name="bio"
                label={t('common.profile')}
                value={form.bio}
                onChange={(event) => setForm({ ...form, bio: event.target.value })}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('farmer.location')} />
          <CardBody className="space-y-3">
            <Checkbox
              name="offers_delivery"
              label={t('product.delivery')}
              checked={form.offers_delivery}
              onChange={(event) => setForm({ ...form, offers_delivery: event.target.checked })}
            />
            <Checkbox
              name="offers_pickup"
              label={t('product.pickup')}
              checked={form.offers_pickup}
              onChange={(event) => setForm({ ...form, offers_pickup: event.target.checked })}
            />
            <Checkbox
              name="location_public"
              label="Show my farm on the map"
              hint="When this is off, your coordinates are withheld from every public response."
              checked={form.location_public}
              onChange={(event) => setForm({ ...form, location_public: event.target.checked })}
            />
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            {saving ? (
              t('common.saving')
            ) : (
              <>
                <Save className="size-4" aria-hidden="true" />
                {t('common.save')}
              </>
            )}
          </Button>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-soil-500">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('quality.distinctNote')}
        </p>
      </form>
    </RoleShell>
  );
}
