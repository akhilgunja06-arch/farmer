import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag
      className={cn(
        'rounded-[var(--radius-card)] border border-soil-200/80 bg-white shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-soil-200/70 px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-bold text-soil-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-soil-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/**
 * Loading placeholder.
 *
 * A skeleton rather than a spinner where the shape of the content is known, so
 * the layout does not jump when data arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden="true" />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-soil-600" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

/**
 * Empty state.
 *
 * Always offers the next useful action rather than only stating that there is
 * nothing here.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-soil-300 bg-rice-100/60 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-white text-soil-500 shadow-sm">
        {icon ?? <Inbox className="size-6" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-bold text-soil-900">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm leading-relaxed text-soil-600">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Error state.
 *
 * Distinguishes "we could not reach the server" from "the server said no",
 * because the fix is different and a generic message helps nobody.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-red-200 bg-red-50/60 px-6 py-10 text-center',
        className,
      )}
      role="alert"
    >
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-white text-red-600 shadow-sm">
        {offline ? (
          <WifiOff className="size-6" aria-hidden="true" />
        ) : (
          <AlertCircle className="size-6" aria-hidden="true" />
        )}
      </div>
      <h3 className="text-base font-bold text-red-900">
        {title ?? (offline ? 'You are offline' : 'Something went wrong')}
      </h3>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-red-800">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline notice for a partially-available feature, e.g. an unconfigured service. */
export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'success' | 'danger';
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-leaf-200 bg-leaf-50 text-leaf-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
  } as const;

  return (
    <div className={cn('rounded-[var(--radius-control)] border px-4 py-3 text-sm', tones[tone], className)}>
      {title && <p className="font-bold">{title}</p>}
      <div className={cn(title && 'mt-1', 'leading-relaxed')}>{children}</div>
    </div>
  );
}

/** A single labelled figure, for dashboard tiles. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'leaf' | 'warning' | 'info';
}) {
  const tones = {
    neutral: 'bg-white',
    leaf: 'bg-leaf-50/70',
    warning: 'bg-amber-50/70',
    info: 'bg-sky-50/70',
  } as const;

  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-soil-200/80 p-4 shadow-[var(--shadow-card)]',
        tones[tone],
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-soil-600">{label}</p>
        {icon && <span className="text-soil-500">{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-bold text-soil-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-soil-600">{hint}</p>}
    </div>
  );
}

/** Grid of skeletons matching a product card, used while a list loads. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[var(--radius-card)] border border-soil-200 bg-white"
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
