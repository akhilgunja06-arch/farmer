import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('common.notFound'));

  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-16">
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-leaf-50 text-leaf-700">
          <Compass className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-soil-900">{t('common.notFound')}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-soil-600">
          {t('common.notFoundHelp')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/">
            <Button>{t('common.goHome')}</Button>
          </Link>
          <Link to="/explore">
            <Button variant="outline">{t('landing.browseCrops')}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
