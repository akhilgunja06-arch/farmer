import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin, Search } from 'lucide-react';
import { useAsync } from '@/hooks/useCart';
import { products as productsApi } from '@/lib/services';
import { Button } from '@/components/ui/Button';

/**
 * The hero search bar.
 *
 * Crop name plus a state. Both feed straight into the explore page's query
 * string, so the filters there and the search here stay one mechanism rather
 * than two that behave differently.
 */
export function HeroSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [state, setState] = useState('');

  const states = useAsync((signal) => productsApi.states(signal), []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (term.trim()) params.set('search', term.trim());
    if (state) params.set('state', state);
    const query = params.toString();
    navigate(`/explore${query ? `?${query}` : ''}`);
  };

  return (
    <form
      onSubmit={submit}
      className="mt-6 flex flex-col gap-2 rounded-[var(--radius-card)] border border-soil-200 bg-white p-2 shadow-[var(--shadow-card)] sm:flex-row"
      role="search"
    >
      <label className="flex flex-1 items-center gap-2 px-3">
        <Search className="size-5 shrink-0 text-soil-400" aria-hidden="true" />
        <span className="sr-only">{t('common.search')}</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('landing.searchPlaceholder')}
          className="w-full border-0 bg-transparent py-3 text-sm text-soil-900 placeholder:text-soil-400 focus:outline-none focus:ring-0"
        />
      </label>

      <div className="flex items-center gap-2 border-soil-200 px-3 sm:border-l">
        <MapPin className="size-5 shrink-0 text-soil-400" aria-hidden="true" />
        <label className="sr-only" htmlFor="hero-state">
          {t('auth.state')}
        </label>
        <select
          id="hero-state"
          value={state}
          onChange={(event) => setState(event.target.value)}
          className="w-full cursor-pointer border-0 bg-transparent py-3 text-sm font-medium text-soil-800 focus:outline-none focus:ring-0 sm:w-40"
        >
          <option value="">{t('landing.locationPlaceholder')}</option>
          {(states.data?.states ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="lg" className="sm:w-auto">
        {t('common.search')}
      </Button>
    </form>
  );
}
