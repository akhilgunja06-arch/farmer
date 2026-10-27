import { Link } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The wordmark.
 *
 * The sprout glyph is drawn from a Lucide icon rather than an image so it
 * inherits colour and stays crisp at any size.
 */
export function Logo({
  size = 'md',
  to = '/',
  inverted = false,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  to?: string | null;
  inverted?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: { box: 'size-7', icon: 'size-4', text: 'text-base' },
    md: { box: 'size-9', icon: 'size-5', text: 'text-lg' },
    lg: { box: 'size-11', icon: 'size-6', text: 'text-2xl' },
  } as const;
  const dimensions = sizes[size];

  const content = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-xl',
          inverted ? 'bg-white/15 text-white' : 'bg-leaf-700 text-white',
          dimensions.box,
        )}
      >
        <Sprout className={dimensions.icon} aria-hidden="true" />
      </span>
      <span
        className={cn(
          'font-bold tracking-tight',
          inverted ? 'text-white' : 'text-soil-900',
          dimensions.text,
        )}
      >
        Rythu<span className={inverted ? 'text-leaf-300' : 'text-leaf-700'}>Direct</span>
      </span>
    </span>
  );

  if (!to) return content;
  return (
    <Link to={to} className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-leaf-700">
      {content}
    </Link>
  );
}
