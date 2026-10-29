import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from '@/locales/en';
import { te } from '@/locales/te';
import { hi } from '@/locales/hi';
import type { Language } from '@/lib/types';

export const SUPPORTED_LANGUAGES: Array<{ code: Language; label: string; english: string }> = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'te', label: 'తెలుగు', english: 'Telugu' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
];

const STORAGE_KEY = 'rythudirect.language';

/**
 * The language to start in.
 *
 * Order of preference: what the user chose last on this device, then the
 * browser's own preference, then English. The saved account preference on the
 * server overrides all of this once the session loads — see AuthContext.
 */
export function initialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'te' || saved === 'hi') return saved;

  for (const candidate of navigator.languages ?? []) {
    const base = candidate.toLowerCase().split('-')[0];
    if (base === 'te') return 'te';
    if (base === 'hi') return 'hi';
  }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    te: { translation: te },
    hi: { translation: hi },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: {
    // React already escapes everything it renders. Double-escaping would show
    // literal entities in Telugu and Hindi strings.
    escapeValue: false,
  },
  returnNull: false,
});

/** Applies a language everywhere: i18n, the document, and this device. */
export function applyLanguage(language: Language): void {
  void i18n.changeLanguage(language);
  localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.lang = language;
}

document.documentElement.lang = i18n.language;

export default i18n;
