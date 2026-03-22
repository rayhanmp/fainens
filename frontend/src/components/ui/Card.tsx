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
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          {title && <h3 className="font-semibold text-base">{title}</h3>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
