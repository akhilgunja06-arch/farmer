import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { Select } from '@/components/ui/Field';

/**
 * State and district pickers.
 *
 * The state list and each state's districts come from the server, which builds
 * them from the districts farmers have actually registered in. That means the
 * dropdown only offers places where there is a marketplace presence, rather
 * than 700-odd districts nobody sells from.
 */

interface LocationFieldsProps {
  state: string;
  district: string;
  onStateChange: (value: string) => void;
  onDistrictChange: (value: string) => void;
  stateError?: string | undefined;
  districtError?: string | undefined;
  required?: boolean;
}

export function LocationFields({
  state,
  district,
  onStateChange,
  onDistrictChange,
  stateError,
  districtError,
  required,
}: LocationFieldsProps) {
  const { t } = useTranslation();
  const [states, setStates] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [loadingStates, setLoadingStates] = useState(true);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ states: string[] }>('/api/products/locations/states')
      .then((result) => {
        if (active) {
          setStates(result.states ?? []);
          setFailure(null);
        }
      })
      .catch(() => {
        // Falling back to a free-text field would silently change the data
        // model, so the picker stays but says why it is empty.
        if (active) setFailure(t('common.somethingWentWrong'));
      })
      .finally(() => {
        if (active) setLoadingStates(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (!state) {
      setDistricts([]);
      return;
    }
    let active = true;
    setLoadingDistricts(true);
    api
      .get<{ districts: string[] }>('/api/products/locations/districts', { state })
      .then((result) => {
        if (active) setDistricts(result.districts ?? []);
      })
      .catch(() => {
        if (active) setDistricts([]);
      })
      .finally(() => {
        if (active) setLoadingDistricts(false);
      });
    return () => {
      active = false;
    };
  }, [state]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select
        name="state"
        label={t('auth.state')}
        required={required}
        value={state}
        placeholder={loadingStates ? t('common.loading') : t('common.none')}
        options={states.map((value) => ({ value, label: value }))}
        onChange={(event) => {
          onStateChange(event.target.value);
          // Changing state invalidates the district that was chosen.
          onDistrictChange('');
        }}
        {...(stateError ? { error: stateError } : {})}
        hint={failure ?? undefined}
      />

      <Select
        name="district"
        label={t('auth.district')}
        required={required}
        value={district}
        disabled={!state || loadingDistricts}
        placeholder={
          !state
            ? t('validation.selectState')
            : loadingDistricts
              ? t('common.loading')
              : t('common.none')
        }
        options={districts.map((value) => ({ value, label: value }))}
        onChange={(event) => onDistrictChange(event.target.value)}
        {...(districtError ? { error: districtError } : {})}
      />
    </div>
  );
}
