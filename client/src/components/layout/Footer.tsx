import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, MapPin, Phone } from 'lucide-react';
import { Logo } from './Logo';

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  const columns = [
    {
      title: t('footer.forFarmers'),
      links: [
        { to: '/auth/choose-role', label: t('landing.sellYourCrops') },
        { to: '/farmer/register', label: t('auth.registerAsFarmer') },
        { to: '/how-it-works', label: t('nav.howItWorks') },
        { to: '/farmer/market-insights', label: t('nav.marketInsights') },
      ],
    },
    {
      title: t('footer.forCustomers'),
      links: [
        { to: '/explore', label: t('nav.explore') },
        { to: '/farmers', label: t('nav.nearbyFarmers') },
        { to: '/locations', label: t('nav.locations') },
        { to: '/customer/register', label: t('auth.registerAsCustomer') },
      ],
    },
    {
      title: t('footer.support'),
      links: [
        { to: '/help', label: t('footer.helpCentre') },
        { to: '/contact', label: t('footer.contactUs') },
        { to: '/quality-standards', label: t('nav.qualityStandards') },
        { to: '/about', label: t('nav.about') },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { to: '/terms', label: t('footer.terms') },
        { to: '/privacy', label: t('footer.privacy') },
      ],
    },
  ];

  return (
    <footer className="mt-16 border-t border-soil-200 bg-soil-900 text-soil-100">
      <div className="container-page py-12">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo inverted to="/" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-soil-200">
              {t('footer.aboutText')}
            </p>
            <ul className="mt-5 space-y-2 text-sm text-soil-200">
              <li className="flex items-center gap-2">
                <Mail className="size-4 shrink-0" aria-hidden="true" />
                <a
                  href={`mailto:${t('footer.email')}`}
                  className="hover:text-white hover:underline"
                >
                  {t('footer.email')}
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="size-4 shrink-0" aria-hidden="true" />
                <span>{t('footer.phone')}</span>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{t('footer.address')}</span>
              </li>
            </ul>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-white">
                {column.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.to}-${link.label}`}>
                    <Link
                      to={link.to}
                      className="text-sm text-soil-200 transition-colors hover:text-white hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-soil-700 pt-6 text-xs text-soil-300 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} RythuDirect. {t('footer.rights')}
          </p>
          <p>{t('footer.builtFor')}</p>
        </div>
      </div>
    </footer>
  );
}
