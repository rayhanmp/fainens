import { useState, useCallback } from 'react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { Sparkles, RefreshCw, ChevronDown } from 'lucide-react';
import { useGenerateInsightMutation, useLatestInsightQuery } from '../../features/insights/queries';

interface AIInsightCardProps {
  type: 'dashboard' | 'budget';
  periodId?: number;
  className?: string;
}

export function AIInsightCard({ type, periodId, className }: AIInsightCardProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const currentKey = `${type}:${periodId ?? 'current'}`;
  const latestInsightQuery = useLatestInsightQuery(type, periodId);
  const generateInsightMutation = useGenerateInsightMutation();
  const isLoading = generateInsightMutation.isPending;
  const latestInsight = latestInsightQuery.data;
  const displayedInsight = resultKey === currentKey ? insight : latestInsight?.insight ?? null;
  const displayedGeneratedAt = resultKey === currentKey
    ? generatedAt
    : latestInsight?.generatedAt ? new Date(latestInsight.generatedAt) : null;
  const displayedSourceRevision = resultKey === currentKey
    ? sourceRevision
    : latestInsight?.sourceRevision ?? null;
  const displayedError = errorKey === currentKey ? error : null;

  const generateInsight = useCallback(async () => {
    setError(null);
    setErrorKey(null);
    
    try {
      const response = await generateInsightMutation.mutateAsync({ type, periodId });
      setInsight(response.insight);
      setGeneratedAt(new Date(response.generatedAt));
      setSourceRevision(response.sourceRevision);
      setResultKey(currentKey);
      setIsCollapsed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate insight');
      setErrorKey(currentKey);
    }
  }, [currentKey, generateInsightMutation, type, periodId]);

  if (displayedError) {
    return (
      <div className={cn("rounded-xl border border-[var(--ref-error)]/30 bg-[var(--ref-surface-container-high)] p-4", className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--ref-error)]">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">AI Insight</span>
          </div>
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={generateInsight}
            disabled={isLoading}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
        </div>
        <p className="text-xs text-[var(--ref-error)] mt-1">{displayedError}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-[var(--ref-primary)]/30 bg-[var(--ref-surface-container-high)] relative overflow-hidden group", className)}>
      <div className="flex items-center gap-2 p-4 transition-colors hover:bg-black/5">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--ref-primary)]" />
          <h3 className="font-semibold text-sm text-[var(--ref-on-surface)]">AI Insight</h3>
          {displayedInsight && !isCollapsed && (
            <span className="text-xs text-[var(--ref-on-surface-variant)]">
              {displayedGeneratedAt?.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {displayedSourceRevision != null ? ` · ledger rev ${displayedSourceRevision}` : ''}
            </span>
          )}
          </div>
          <ChevronDown className={cn("h-4 w-4 text-[var(--ref-on-surface-variant)] transition-transform", !isCollapsed && "rotate-180")} />
        </button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void generateInsight()}
          disabled={isLoading}
          aria-label="Refresh AI insight"
          className="h-7 w-7 shrink-0 p-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>
      
      {!isCollapsed && (
        <div className="px-4 pb-4">
          {!displayedInsight && !isLoading ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--ref-on-surface-variant)]">
                Get AI-powered analysis of your spending.
              </p>
              <Button onClick={generateInsight} disabled={isLoading} size="sm">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Generate
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              <div className="h-5 bg-[var(--ref-surface-container-low)] rounded animate-pulse" />
              <div className="h-5 bg-[var(--ref-surface-container-low)] rounded animate-pulse w-3/4" />
              <div className="h-5 bg-[var(--ref-surface-container-low)] rounded animate-pulse w-1/2" />
            </div>
          ) : (
            <div className="text-base text-[var(--ref-on-surface)] leading-relaxed whitespace-pre-line">
              {displayedInsight}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
