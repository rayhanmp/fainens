import { cn } from '../../lib/utils';
import { useId } from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export function Select({ label, error, options, className, required, ...props }: SelectProps) {
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
      <select
        id={id}
        className={cn(
          'brutalist-input w-full bg-[var(--color-surface)]',
          error && 'border-[var(--color-danger)]',
          className
        )}
        aria-required={required || undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        required={required}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
