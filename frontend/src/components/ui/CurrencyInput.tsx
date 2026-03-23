import { cn } from '../../lib/utils';
import { useId } from 'react';

interface CurrencyInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  required?: boolean;
  error?: string;
  showDivider?: boolean;
  currencySymbol?: string;
}

export function CurrencyInput({
  label,
  value,
  onChange,
  placeholder = '0',
  size = 'md',
  className,
  required,
  error,
  showDivider = true,
  currencySymbol = 'Rp',
}: CurrencyInputProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  const sizeClasses = {
    sm: 'text-xl sm:text-2xl',
    md: 'text-2xl sm:text-3xl md:text-4xl',
    lg: 'text-3xl sm:text-4xl md:text-5xl',
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Remove non-numeric characters except for formatting
    const rawValue = e.target.value.replace(/[^\d]/g, '');
    
    // Format with thousand separators
    if (rawValue) {
      const numValue = parseInt(rawValue, 10);
      const formatted = new Intl.NumberFormat('id-ID').format(numValue);
      onChange(formatted);
    } else {
      onChange('');
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-bold uppercase tracking-widest text-[var(--color-muted)]"
        >
          {label}
          {required && <span className="text-[var(--color-danger)] ml-1">*</span>}
        </label>
      )}
      <div className="relative flex items-baseline gap-2 min-w-0">
        <span className="text-2xl sm:text-3xl font-headline font-bold text-[var(--color-accent)] shrink-0">
          {currencySymbol}
        </span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={errorId}
          className={cn(
            'font-headline font-extrabold w-full min-w-0 leading-none bg-transparent border-none focus:ring-0 p-0 placeholder:text-[var(--ref-surface-container-highest)] text-[var(--color-text-primary)]',
            sizeClasses[size]
          )}
        />
      </div>
      {showDivider && (
        <div className="h-px w-full bg-[var(--ref-surface-container-highest)]" />
      )}
      {error && (
        <p id={errorId} className="text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
