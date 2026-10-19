import { cn } from '../../lib/utils';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Card heading (not the HTML `title` tooltip attribute) */
  title?: React.ReactNode;
  action?: React.ReactNode;
}

export function Card({ children, title, action, className, ...props }: CardProps) {
  return (
    <div className={cn('brutalist-card', className)} {...props}>
      {(title || action) && (
        // Wraps when the title and actions don't fit side by side (a phone), instead of pushing the actions out.
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-[var(--color-border)]">
          {title && <h3 className="min-w-0 font-semibold text-base">{title}</h3>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
