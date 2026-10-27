import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { AuthShell } from '@/components/auth/AuthShell';
import { LocationFields } from '@/components/forms/LocationFields';
import { Button } from '@/components/ui/Button';
import { Checkbox, Select, TextArea, TextInput } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError, messageOf } from '@/lib/api';
import { farmerRegisterSchema, type FarmerRegisterValues } from '@/lib/validation';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import i18n from '@/lib/i18n';

/**
 * Farmer registration.
 *
 * On success the user is told to confirm their email rather than being dropped
 * into a dashboard they cannot use yet. That is the honest state: the account
 * exists, but email verification is what unlocks sign-in.
 */
export default function FarmerRegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { registerFarmer } = useAuth();
  useDocumentTitle(t('auth.farmerRegisterTitle'));

  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FarmerRegisterValues>({
    resolver: zodResolver(farmerRegisterSchema),
    defaultValues: {
      preferred_language: (i18n.language as 'en' | 'te' | 'hi') ?? 'en',
      offers_delivery: false,
      offers_pickup: true,
      location_public: false,
      accepted_terms: false as unknown as true,
    },
  });

  const stateValue = watch('state') ?? '';
  const districtValue = watch('district') ?? '';

  const submit = async (values: FarmerRegisterValues) => {
    setFormError(null);

    // The API takes lists, the form takes comma-separated text — converting
    // here keeps the textarea simple for the farmer.
    const crops = (values.crops_cultivated ?? '')
      .split(',')
      .map((crop) => crop.trim())
      .filter(Boolean);

    const farmingTypes = (values.farming_type ?? '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);

    try {
      await registerFarmer({
        full_name: values.full_name,
        email: values.email,
        phone: values.phone,
        password: values.password,
        state: values.state,
        district: values.district,
        village: values.village,
        public_address: values.public_address || undefined,
        preferred_language: values.preferred_language,
        farm_name: values.farm_name || undefined,
        farming_type: farmingTypes,
        crops_cultivated: crops,
        offers_delivery: values.offers_delivery,
        offers_pickup: values.offers_pickup,
        location_public: values.location_public,
        accepted_terms: true,
      });
      setCreated(values.email);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        // Attach per-field messages from the server to the matching input.
        for (const [field, message] of Object.entries(caught.fieldErrors ?? {})) {
          setError(field as keyof FarmerRegisterValues, { message });
        }
      } else {
        setFormError(messageOf(caught));
      }
    }
  };

  if (created) {
    return (
      <AuthShell title={t('auth.accountCreated')}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-leaf-200 bg-leaf-50 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-leaf-700" aria-hidden="true" />
            <div>
              <p className="font-semibold text-leaf-900">{t('auth.verifyEmailNotice')}</p>
              <p className="mt-1 text-sm text-leaf-800">
                We sent a message to <strong>{created}</strong>.
              </p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-soil-600">
            Once your address is confirmed you can sign in, add your farm details, and list your
            first crop. You set your own price — we never change it for you.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/farmer/login')}>{t('auth.farmerLoginTitle')}</Button>
            <Button variant="outline" onClick={() => navigate('/')}>
              {t('common.goHome')}
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('auth.farmerRegisterTitle')}
      subtitle={t('auth.farmerRegisterSub')}
      wide
      footer={
        <>
          {t('auth.alreadyHaveAccount')}{' '}
          <Link to="/farmer/login" className="font-semibold text-leaf-700 hover:underline">
            {t('auth.farmerLoginTitle')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-6" noValidate>
        {formError && <Notice tone="danger">{formError}</Notice>}

        {/* ---------------------------------------------------------- account */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-bold uppercase tracking-wide text-soil-600">
            Account
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label={t('auth.fullName')}
              required
              autoComplete="name"
              error={errors.full_name?.message}
              {...register('full_name')}
            />
            <TextInput
              label={t('auth.phone')}
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              error={errors.phone?.message}
              {...register('phone')}
            />
          </div>

          <TextInput
            label={t('auth.email')}
            required
            type="email"
            inputMode="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />

          <TextInput
            label={t('auth.password')}
            required
            type="password"
            autoComplete="new-password"
            hint={t('auth.passwordHint')}
            error={errors.password?.message}
            {...register('password')}
          />

          <Controller
            control={control}
            name="preferred_language"
            render={({ field }) => (
              <Select
                label={t('auth.preferredLanguage')}
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                options={SUPPORTED_LANGUAGES.map((language) => ({
                  value: language.code,
                  label: `${language.label} (${language.english})`,
                }))}
                error={errors.preferred_language?.message}
              />
            )}
          />
        </fieldset>

        {/* ------------------------------------------------------------ farm */}
        <fieldset className="space-y-4">
          <legend className="text-sm font-bold uppercase tracking-wide text-soil-600">
            {t('nav.farmProfile')}
          </legend>

          <TextInput
            label={`${t('auth.farmName')} (${t('common.optional')})`}
            placeholder="e.g. Ravi Farms"
            error={errors.farm_name?.message}
            {...register('farm_name')}
          />

          <LocationFields
            state={stateValue}
            district={districtValue}
            onStateChange={(value) => setValue('state', value, { shouldValidate: true })}
            onDistrictChange={(value) => setValue('district', value, { shouldValidate: true })}
            stateError={errors.state?.message}
            districtError={errors.district?.message}
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label={t('auth.village')}
              required
              error={errors.village?.message}
              {...register('village')}
            />
            <TextInput
              label={`${t('auth.fullAddress')} (${t('common.optional')})`}
              error={errors.public_address?.message}
              {...register('public_address')}
            />
          </div>

          <TextInput
            label={`${t('auth.farmingType')} (${t('common.optional')})`}
            placeholder="e.g. Organic, Conventional"
            hint="Separate multiple types with commas."
            error={errors.farming_type?.message}
            {...register('farming_type')}
          />

          <TextArea
            label={`${t('auth.cropsCultivated')} (${t('common.optional')})`}
            rows={2}
            placeholder="e.g. Rice, Cotton, Turmeric"
            hint={t('auth.cropsHint')}
            error={errors.crops_cultivated?.message}
            {...register('crops_cultivated')}
          />
        </fieldset>

        {/* ------------------------------------------------------ preferences */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-bold uppercase tracking-wide text-soil-600">
            Selling preferences
          </legend>

          <Checkbox
            label="I can deliver to customers"
            {...register('offers_delivery')}
          />
          <Checkbox
            label="Customers can pick up from my farm"
            {...register('offers_pickup')}
          />
          <Checkbox
            label="Show my approximate farm location on the map"
            hint="Only your village and district are shown publicly. Your exact address stays private unless you allow it."
            {...register('location_public')}
          />
        </fieldset>

        <Checkbox
          label={
            <>
              I agree to the{' '}
              <Link to="/terms" className="font-semibold text-leaf-700 underline">
                {t('footer.terms')}
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="font-semibold text-leaf-700 underline">
                {t('footer.privacy')}
              </Link>
              .
            </>
          }
          error={errors.accepted_terms?.message}
          {...register('accepted_terms')}
        />

        <Button type="submit" block size="lg" loading={isSubmitting}>
          {t('auth.signUp')}
        </Button>
      </form>
    </AuthShell>
  );
}
