import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Sparkles, RefreshCw, ChevronDown } from 'lucide-react';

interface AIInsightCardProps {
  type: 'dashboard' | 'budget';
  periodId?: number;
  className?: string;
}

export function AIInsightCard({ type, periodId, className }: AIInsightCardProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const requestVersion = useRef(0);

  const generateInsight = useCallback(async () => {
    const version = ++requestVersion.current;
    setIsLoading(true);
    setError(null);
    
    try {
      let response;
      if (type === 'dashboard') {
        response = await api.insights.generateDashboard(periodId);
      } else {
        response = await api.insights.generateBudget(periodId);
      }
      
      if (version === requestVersion.current) {
        setInsight(response.insight);
        setGeneratedAt(new Date(response.generatedAt));
        setSourceRevision(response.sourceRevision);
        setIsCollapsed(false);
      }
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err instanceof Error ? err.message : 'Failed to generate insight');
      }
    } finally {
      if (version === requestVersion.current) setIsLoading(false);
    }
  }, [type, periodId]);

  const loadCachedInsight = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      let response;
      if (type === 'dashboard') {
        response = await api.insights.getDashboardLatest(periodId);
      } else {
        response = await api.insights.getBudgetLatest(periodId);
      }
      
      if (version === requestVersion.current) {
        setInsight(response.insight);
        setGeneratedAt(response.generatedAt ? new Date(response.generatedAt) : null);
        setSourceRevision(response.sourceRevision);
      }
    } catch (err) {
      // Silently fail - no cached insight is okay
    }
  }, [type, periodId]);

  useEffect(() => {
    setInsight(null);
    setGeneratedAt(null);
    setSourceRevision(null);
    setError(null);
    setIsLoading(false);
    void loadCachedInsight();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadCachedInsight]);

  if (error) {
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
        <p className="text-xs text-[var(--ref-error)] mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-[var(--ref-primary)]/30 bg-[var(--ref-surface-container-high)] relative overflow-hidden group", className)}>
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-black/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--ref-primary)]" />
          <h3 className="font-semibold text-sm text-[var(--ref-on-surface)]">AI Insight</h3>
          {insight && !isCollapsed && (
            <span className="text-xs text-[var(--ref-on-surface-variant)]">
              {generatedAt?.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {sourceRevision != null ? ` · ledger rev ${sourceRevision}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={(e) => {
              e.stopPropagation();
              generateInsight();
            }}
            disabled={isLoading}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
          <ChevronDown className={cn("h-4 w-4 text-[var(--ref-on-surface-variant)] transition-transform", !isCollapsed && "rotate-180")} />
        </div>
      </button>
      
      {!isCollapsed && (
        <div className="px-4 pb-4">
          {!insight && !isLoading ? (
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
              {insight}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
