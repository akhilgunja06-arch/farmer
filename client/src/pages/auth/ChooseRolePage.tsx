import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShoppingBasket, Sprout } from 'lucide-react';
import { Logo } from '@/components/layout/Logo';
import { LanguageSelector } from '@/components/layout/LanguageSelector';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * The role chooser.
 *
 * Three doors, presented as three equally-weighted cards so a farmer is not
 * pushed toward the customer flow or the other way round.
 */
export default function ChooseRolePage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.chooseRole'));
  const navigate = useNavigate();

  const options = [
    {
      key: 'farmer',
      icon: Sprout,
      title: t('auth.farmerCard'),
      body: t('auth.farmerCardSub'),
      to: '/farmer/register',
      loginTo: '/farmer/login',
      registerLabel: t('auth.registerAsFarmer'),
      loginLabel: t('auth.farmerLoginTitle'),
      accent: 'leaf' as const,
    },
    {
      key: 'customer',
      icon: ShoppingBasket,
      title: t('auth.customerCard'),
      body: t('auth.customerCardSub'),
      to: '/customer/register',
      loginTo: '/customer/login',
      registerLabel: t('auth.registerAsCustomer'),
      loginLabel: t('auth.customerLoginTitle'),
      accent: 'soil' as const,
    },
    {
      key: 'admin',
      icon: ShieldCheck,
      title: t('auth.adminCard'),
      body: t('auth.adminCardSub'),
      to: null,
      loginTo: '/admin/login',
      registerLabel: null,
      loginLabel: t('auth.adminLoginTitle'),
      accent: 'sky' as const,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-leaf-50 via-rice-100 to-soil-50">
      <header className="container-page flex h-16 items-center justify-between">
        <Logo />
        <LanguageSelector />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-4xl">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-soil-900">{t('auth.chooseRole')}</h1>
            <p className="mt-2 text-sm text-soil-600">{t('auth.chooseRoleSub')}</p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {options.map((option) => {
              const accents = {
                leaf: 'bg-leaf-50 text-leaf-700 group-hover:border-leaf-400',
                soil: 'bg-soil-100 text-soil-700 group-hover:border-soil-400',
                sky: 'bg-sky-50 text-sky-700 group-hover:border-sky-400',
              } as const;

              return (
                <div
                  key={option.key}
                  className="group flex flex-col rounded-[var(--radius-card)] border border-soil-200 bg-white p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]"
                >
                  <span
                    className={`grid size-12 place-items-center rounded-xl ${accents[option.accent]}`}
                  >
                    <option.icon className="size-6" aria-hidden="true" />
                  </span>

                  <h2 className="mt-4 text-lg font-bold text-soil-900">{option.title}</h2>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-soil-600">
                    {option.body}
                  </p>

                  {option.key === 'admin' && (
                    <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900">
                      {t('auth.adminLoginNote')}
                    </p>
                  )}

                  <div className="mt-5 space-y-2">
                    {option.to && (
                      <button
                        type="button"
                        onClick={() => navigate(option.to!)}
                        className="w-full rounded-[var(--radius-control)] bg-leaf-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-leaf-800"
                      >
                        {option.registerLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(option.loginTo)}
                      className="w-full rounded-[var(--radius-control)] border border-soil-300 bg-white px-4 py-2.5 text-sm font-semibold text-soil-900 transition-colors hover:bg-soil-50"
                    >
                      {option.loginLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-sm text-soil-600">
            <Link to="/" className="font-semibold text-leaf-700 hover:underline">
              {t('common.goHome')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
