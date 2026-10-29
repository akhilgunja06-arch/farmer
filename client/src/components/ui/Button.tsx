import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-leaf-700 text-white hover:bg-leaf-800 active:bg-leaf-900 shadow-sm disabled:bg-leaf-700/50',
  secondary: 'bg-soil-100 text-soil-900 hover:bg-soil-200 active:bg-soil-300',
  outline:
    'border border-soil-300 bg-white text-soil-900 hover:bg-soil-50 active:bg-soil-100',
  ghost: 'text-soil-800 hover:bg-soil-100 active:bg-soil-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
  link: 'text-leaf-700 underline underline-offset-4 hover:text-leaf-800 p-0 h-auto',
};

/**
 * Minimum 44px touch targets on the default sizes. Many users are on phones in
 * a field, and small controls are a real accessibility problem there.
 */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-11 w-11 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Renders a full-width button, for forms on narrow screens. */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, block, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // While loading the button must not be clickable twice — a double
      // submit on checkout is a duplicate order.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-700',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});
