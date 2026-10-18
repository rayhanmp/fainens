import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={cn(
        'brutalist-button relative',
        variant === 'secondary' && 'brutalist-button--secondary',
        variant === 'danger' && 'brutalist-button--danger',
        /* Default text colors for tailwind-merge: `className` can override (e.g. text-white on blue). */
        variant === 'primary' && 'text-white',
        variant === 'secondary' && 'text-[var(--color-text-primary)]',
        variant === 'danger' && 'text-white',
        sizeClasses[size],
        disabled && !isLoading && 'opacity-50 cursor-not-allowed',
        className,
        // The label stays in place but invisible (icons use currentColor too), so the width never jumps.
        isLoading && 'cursor-wait text-transparent!',
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {children}
      {isLoading && (
        <span className={cn('absolute inset-0 grid place-items-center', variant === 'secondary' ? 'text-[var(--color-text-primary)]' : 'text-white')} aria-hidden="true">
          <svg className="button-spinner h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </button>
  );
}
