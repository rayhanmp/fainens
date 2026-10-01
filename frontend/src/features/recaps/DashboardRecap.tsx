import { ArrowUpRight, Play, Sparkles, X } from 'lucide-react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { Modal } from '../../components/ui/Modal';
import { useMarkRecapHighlightSeen, useRecapArchive, useRecapHighlightState, useRecapPreview } from './queries';
import { periodDateRange } from './stories';
import { RecapExperience } from './RecapExperience';
import './recaps.css';

export function DashboardRecapControl({ periodId, onOpen }: { periodId?: number; onOpen: (periodId: number) => void }) {
  const archive = useRecapArchive();
  const period = periodId != null ? archive.data?.find(item => item.id === periodId) : archive.data?.[0];
  const markSeen = useMarkRecapHighlightSeen(period?.id ?? 0);
  return <button
    type="button"
    className="dashboard-recap-control"
    disabled={!period}
    aria-label={period ? `Open ${period.name} recap` : 'Open period recap'}
    onClick={() => { if (!period) return; markSeen.mutate(); onOpen(period.id); }}
  ><Sparkles size={15} /><span>Recap</span></button>;
}

export function DashboardRecap({ periodId, now, onOpen }: { periodId?: number; now: number; onOpen: (periodId: number) => void }) {
  const archive = useRecapArchive();
  const period = periodId != null ? archive.data?.find(item => item.id === periodId) : archive.data?.[0];
  const { maskAmounts } = useBalanceVisibility();
  const eligible = period != null && period.isPartial && now >= period.startDate && now < period.startDate + 7 * 24 * 60 * 60 * 1000;
  const seen = useRecapHighlightState(eligible ? period?.id : undefined);
  const markSeen = useMarkRecapHighlightSeen(period?.id ?? 0);
  const showHighlight = eligible && seen.isSuccess && !seen.isFetching && seen.data.seenAt == null;
  const preview = useRecapPreview(showHighlight ? period?.id : undefined);
  if (!period || !showHighlight) return null;
  const saved = preview.data?.story;
  const variant = (saved?.seed ?? period.id) % 8;
  const dismiss = () => markSeen.mutate();
  return <section className={`dashboard-recap dashboard-recap-${variant}`} aria-label="New period recap highlight">
      <button className="dashboard-recap-open" onClick={() => { markSeen.mutate(); onOpen(period.id); }} aria-label={`Open your ${period.name} recap`}>
        <span className="dashboard-recap-art" aria-hidden="true"><i /><i /><i /><b>✳</b></span>
        <span className="dashboard-recap-label"><Sparkles size={13} /> THE PERIOD EDIT <span>{period.name} · {periodDateRange(period)}</span></span>
        <span className="dashboard-recap-copy"><strong>{maskAmounts(saved?.copy.headline ?? 'A little rewind. A fresh perspective.')}</strong><span>{maskAmounts(saved?.copy.deck ?? `Your ${period.name} story is ready when you are.`)}</span></span>
        <span className="dashboard-recap-cta"><span><Play size={13} fill="currentColor" /> Open your recap</span><ArrowUpRight size={20} /></span>
      </button>
      <button
        className="dashboard-recap-dismiss"
        type="button"
        onClick={dismiss}
        disabled={markSeen.isPending}
        aria-label={`Dismiss ${period.name} recap highlight`}
        title="Mark as seen"
      ><X size={15} /></button>
      {markSeen.isError && <p className="dashboard-recap-error" role="alert">Couldn’t save this as seen. Try again.</p>}
    </section>;
}

export function DashboardRecapModal({ periodId, onClose }: { periodId: number; onClose: () => void }) {
  const archive = useRecapArchive();
  const period = archive.data?.find(item => item.id === periodId);
  if (!period) return null;
  return <Modal isOpen onClose={onClose} title="Your period, in money" hideHeader overlayClassName="recap-modal-overlay" className="recap-modal" contentClassName="recap-modal-content">
    <RecapExperience key={period.id} initialPeriodId={period.id} onClose={onClose} />
  </Modal>;
}
