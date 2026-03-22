import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rect' | 'circle';
  width?: string;
  height?: string;
}

export function Skeleton({
  className,
  variant = 'rect',
  width,
  height,
}: SkeletonProps) {
  const baseStyles = 'animate-pulse bg-[var(--color-muted)]/30 rounded-md';

  const variants = {
    text: 'h-4',
    rect: 'rounded-md',
    circle: 'rounded-full',
  };

  return (
    <div
      className={cn(baseStyles, variants[variant], className)}
      style={{ width, height }}
    />
  );
}

// Card skeleton for loading states
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('brutalist-card p-6', className)}>
      <Skeleton className="w-1/3 h-6 mb-4" />
      <div className="space-y-3">
        <Skeleton className="w-full h-4" />
        <Skeleton className="w-5/6 h-4" />
        <Skeleton className="w-4/6 h-4" />
      </div>
    </div>
  );
}

// Table skeleton
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 p-3 bg-[var(--color-accent)]/10">
        <Skeleton className="w-24 h-5" />
        <Skeleton className="w-32 h-5" />
        <Skeleton className="w-24 h-5" />
        <Skeleton className="w-20 h-5" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 p-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
          <Skeleton className="w-24 h-4" />
          <Skeleton className="w-32 h-4" />
          <Skeleton className="w-24 h-4" />
          <Skeleton className="w-20 h-4" />
        </div>
      ))}
    </div>
  );
}

// Dashboard stat card skeleton
export function StatCardSkeleton() {
  return (
    <div className="brutalist-card p-4">
      <Skeleton className="w-20 h-4 mb-2" />
      <Skeleton className="w-32 h-8" />
    </div>
  );
}

// Form skeleton
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <Skeleton className="w-24 h-4 mb-2" />
          <Skeleton className="w-full h-10" />
        </div>
      ))}
      <Skeleton className="w-32 h-10 mt-6" />
    </div>
  );
}
