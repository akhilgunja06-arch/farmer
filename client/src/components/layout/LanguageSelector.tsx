import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { SUPPORTED_LANGUAGES, applyLanguage } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import type { Language } from '@/lib/types';
import { cn } from '@/lib/cn';

/**
 * Language selector.
 *
 * Writes through to three places at once: i18next (the live interface), the
 * device, and — when signed in — the account, so the choice follows the user to
 * another device.
 */
export function LanguageSelector({
  variant = 'header',
  className,
}: {
  variant?: 'header' | 'settings';
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { user, setLanguage } = useAuth();
  const [current, setCurrent] = useState<Language>((i18n.language as Language) ?? 'en');
  const [saving, setSaving] = useState<Language | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent((i18n.language as Language) ?? 'en');
  }, [i18n.language]);

  const choose = async (language: Language) => {
    if (language === current) return;
    setFailed(false);

    // Apply immediately so the interface never lags behind the click.
    applyLanguage(language);
    setCurrent(language);

    if (user) {
      setSaving(language);
      try {
        await setLanguage(language);
      } catch {
        setFailed(true);
      } finally {
        setSaving(null);
      }
    }
  };

  if (variant === 'settings') {
    return (
      <div className={className}>
        <div className="grid gap-2 sm:grid-cols-3">
          {SUPPORTED_LANGUAGES.map((language) => (
            <button
              key={language.code}
              type="button"
              onClick={() => void choose(language.code)}
              aria-pressed={current === language.code}
              className={cn(
                'flex items-center justify-between gap-2 rounded-[var(--radius-control)] border px-4 py-3 text-left transition-colors',
                current === language.code
                  ? 'border-leaf-600 bg-leaf-50 ring-1 ring-leaf-600'
                  : 'border-soil-300 bg-white hover:bg-soil-50',
              )}
            >
              <span>
                <span className="block text-sm font-semibold text-soil-900">{language.label}</span>
                <span className="block text-xs text-soil-600">{language.english}</span>
              </span>
              {current === language.code && (
                <Check className="size-5 shrink-0 text-leaf-700" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        {failed && (
          <p className="mt-2 text-xs font-medium text-amber-800">
            Saved on this device, but we could not save it to your account. It will sync next time
            you sign in.
          </p>
        )}
      </div>
    );
  }

  return (
    <label className={cn('relative inline-flex items-center', className)}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={current}
        onChange={(event) => void choose(event.target.value as Language)}
        disabled={saving !== null}
        className={cn(
          'h-9 cursor-pointer appearance-none rounded-[var(--radius-control)] border border-soil-300',
          'bg-white py-0 pl-3 pr-8 text-sm font-semibold text-soil-800',
          'focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/30',
          'disabled:opacity-60',
        )}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2 size-4 text-soil-600"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
