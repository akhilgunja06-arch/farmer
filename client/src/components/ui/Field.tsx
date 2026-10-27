import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

const CONTROL = [
  'w-full rounded-[var(--radius-control)] border bg-white text-soil-900',
  'px-3 py-2.5 text-base sm:text-sm',
  'placeholder:text-soil-400',
  'transition-colors duration-150',
  'disabled:cursor-not-allowed disabled:bg-soil-50 disabled:text-soil-500',
  'focus:outline-none focus:ring-2 focus:ring-leaf-600/30 focus:border-leaf-600',
].join(' ');

const INVALID = 'border-red-400 focus:border-red-500 focus:ring-red-500/25';
const VALID = 'border-soil-300';

interface FieldShellProps {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a control with its label, hint and error.
 *
 * The error is wired through `aria-describedby` rather than only shown, so a
 * screen reader announces the problem with the field instead of leaving the
 * user to find it.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-soil-800">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-soil-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-xs font-medium text-red-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

interface BaseProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  wrapperClassName?: string;
}

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>,
    BaseProps {}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, wrapperClassName, className, required, ...props },
  ref,
) {
  const generated = useId();
  const id = props.name ?? generated;
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, error ? INVALID : VALID, className)}
        {...props}
      />
    </Field>
  );
});

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>,
    BaseProps {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, wrapperClassName, className, required, rows = 4, ...props },
  ref,
) {
  const generated = useId();
  const id = props.name ?? generated;
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, error ? INVALID : VALID, 'resize-y', className)}
        {...props}
      />
    </Field>
  );
});

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'>,
    BaseProps {
  options: SelectOption[];
  /** Shown as a disabled first option when nothing is selected. */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, wrapperClassName, className, required, options, placeholder, ...props },
  ref,
) {
  const generated = useId();
  const id = props.name ?? generated;
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, error ? INVALID : VALID, 'appearance-none bg-no-repeat pr-9', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236f4f38' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.75rem center',
        }}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
});

/** A labelled checkbox with the hit area covering the whole row. */
export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>,
    BaseProps {}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, wrapperClassName, className, ...props },
  ref,
) {
  const generated = useId();
  const id = props.name ?? generated;
  return (
    <div className={cn('space-y-1', wrapperClassName)}>
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            'mt-0.5 size-5 shrink-0 rounded border-soil-300 text-leaf-700',
            'focus:ring-2 focus:ring-leaf-600/30',
            className,
          )}
          {...props}
        />
        {label && (
          <label htmlFor={id} className="text-sm text-soil-800 select-none">
            {label}
          </label>
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="pl-7 text-xs leading-relaxed text-soil-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="pl-7 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
});
