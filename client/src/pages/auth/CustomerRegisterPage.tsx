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
import { customerRegisterSchema, type CustomerRegisterValues } from '@/lib/validation';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import i18n from '@/lib/i18n';

export default function CustomerRegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { registerCustomer } = useAuth();
  useDocumentTitle(t('auth.customerRegisterTitle'));

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
  } = useForm<CustomerRegisterValues>({
    resolver: zodResolver(customerRegisterSchema),
    defaultValues: {
      preferred_language: (i18n.language as 'en' | 'te' | 'hi') ?? 'en',
      accepted_terms: false as unknown as true,
    },
  });

  const stateValue = watch('state') ?? '';
  const districtValue = watch('district') ?? '';

  const submit = async (values: CustomerRegisterValues) => {
    setFormError(null);
    try {
      await registerCustomer({
        full_name: values.full_name,
        email: values.email,
        phone: values.phone,
        password: values.password,
        state: values.state,
        district: values.district,
        village: values.village || undefined,
        delivery_address: values.delivery_address,
        postal_code: values.postal_code || undefined,
        preferred_language: values.preferred_language,
        accepted_terms: true,
      });
      setCreated(values.email);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        for (const [field, message] of Object.entries(caught.fieldErrors ?? {})) {
          setError(field as keyof CustomerRegisterValues, { message });
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
            Once confirmed you can browse crops, compare prices from farmers near you, and place
            orders.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/customer/login')}>
              {t('auth.customerLoginTitle')}
            </Button>
            <Button variant="outline" onClick={() => navigate('/explore')}>
              {t('landing.browseCrops')}
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('auth.customerRegisterTitle')}
      subtitle={t('auth.customerRegisterSub')}
      wide
      footer={
        <>
          {t('auth.alreadyHaveAccount')}{' '}
          <Link to="/customer/login" className="font-semibold text-leaf-700 hover:underline">
            {t('auth.customerLoginTitle')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-6" noValidate>
        {formError && <Notice tone="danger">{formError}</Notice>}

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

        <fieldset className="space-y-4">
          <legend className="text-sm font-bold uppercase tracking-wide text-soil-600">
            {t('customer.addresses')}
          </legend>

          <LocationFields
            state={stateValue}
            district={districtValue}
            onStateChange={(value) => setValue('state', value, { shouldValidate: true })}
            onDistrictChange={(value) => setValue('district', value, { shouldValidate: true })}
            stateError={errors.state?.message}
            districtError={errors.district?.message}
            required
          />

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <TextInput
              label={`${t('auth.village')} (${t('common.optional')})`}
              error={errors.village?.message}
              {...register('village')}
            />
            <TextInput
              label={`${t('auth.postalCode')} (${t('common.optional')})`}
              inputMode="numeric"
              maxLength={6}
              error={errors.postal_code?.message}
              {...register('postal_code')}
            />
          </div>

          <TextArea
            label={t('auth.deliveryAddress')}
            required
            rows={3}
            placeholder="House number, street, landmark"
            error={errors.delivery_address?.message}
            {...register('delivery_address')}
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
