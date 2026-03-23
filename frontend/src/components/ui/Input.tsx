import { cn } from '../../lib/utils';
import { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: 'default' | 'wide' | 'currency';
}

export function Input({ label, error, variant = 'default', className, required, ...props }: InputProps) {
  const variantClasses = {
    default: '',
    wide: 'brutalist-input--wide',
    currency: 'brutalist-input--currency',
  };
  
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="space-y-1">
      {label && (
        <label 
          htmlFor={id}
          className="block text-sm font-medium text-[var(--color-text-secondary)]"
        >
          {label}
          {required && (
            <span className="text-[var(--color-danger)] ml-1" aria-hidden="true">*</span>
          )}
          {required && (
            <span className="sr-only"> (required)</span>
          )}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'brutalist-input w-full',
          variantClasses[variant],
          error &&
            'border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.2)]',
          className
        )}
        aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        required={required}
        {...props}
      />
      {error && (
        <p id={errorId} className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
