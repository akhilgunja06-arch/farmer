import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

/**
 * Page navigation.
 *
 * Windowed rather than listing every page: a catalogue with 400 pages must not
 * render 400 buttons.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  const window = 2;
  const pages: Array<number | 'gap'> = [];
  for (let candidate = 1; candidate <= totalPages; candidate += 1) {
    const nearStart = candidate <= window + 1;
    const nearEnd = candidate >= totalPages - window;
    const nearCurrent = Math.abs(candidate - page) <= window;
    if (nearStart || nearEnd || nearCurrent) {
      pages.push(candidate);
    } else if (pages[pages.length - 1] !== 'gap') {
      pages.push('gap');
    }
  }

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1.5"
      aria-label={t('common.page')}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={t('common.previous')}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('common.previous')}</span>
      </Button>

      {pages.map((entry, index) =>
        entry === 'gap' ? (
          <span key={`gap-${index}`} className="px-1.5 text-soil-500" aria-hidden="true">
            …
          </span>
        ) : (
          <Button
            key={entry}
            variant={entry === page ? 'primary' : 'outline'}
            size="sm"
            onClick={() => onPageChange(entry)}
            aria-current={entry === page ? 'page' : undefined}
            className="min-w-9"
          >
            {entry}
          </Button>
        ),
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label={t('common.next')}
      >
        <span className="hidden sm:inline">{t('common.next')}</span>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}
