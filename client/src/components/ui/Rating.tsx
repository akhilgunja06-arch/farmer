import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Read-only star rating. Half stars are rounded down to keep it simple and honest. */
export function Rating({
  value,
  count,
  size = 'sm',
  className,
}: {
  value: number | null | undefined;
  count?: number | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const dimension = size === 'sm' ? 'size-3.5' : 'size-5';
  const rounded = value == null ? 0 : Math.round(value);

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              dimension,
              star <= rounded ? 'fill-sun-500 text-sun-500' : 'fill-none text-soil-300',
            )}
          />
        ))}
      </span>
      <span className="sr-only">
        {value == null ? 'No rating yet' : `${value} out of 5`}
      </span>
      {value != null && (
        <span className="tabular text-xs font-semibold text-soil-700">{value.toFixed(1)}</span>
      )}
      {typeof count === 'number' && count > 0 && (
        <span className="text-xs text-soil-500">({count})</span>
      )}
    </span>
  );
}

/** Interactive star picker, for the review form. */
export function RatingInput({
  value,
  onChange,
  label,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  error?: string | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-soil-800">{label}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star}`}
            onClick={() => onChange(star)}
            className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700"
          >
            <Star
              className={cn(
                'size-7',
                star <= value ? 'fill-sun-500 text-sun-500' : 'fill-none text-soil-300',
              )}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}
