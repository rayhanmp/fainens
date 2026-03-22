import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  variant?: 'default' | 'wide' | 'currency';
}

export function Input({ label, error, variant = 'default', className, ...props }: InputProps) {
  const variantClasses = {
    default: '',
    wide: 'brutalist-input--wide',
    currency: 'brutalist-input--currency',
  };

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
          {label}
        </label>
      )}
      <input
        className={cn(
          'brutalist-input w-full',
          variantClasses[variant],
          error &&
            'border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.2)]',
          className
        )}
        {...props}
      />
      {error && (
        <p className="text-sm text-[var(--color-danger)]">{error}</p>
      )}
    </div>
  );
}
