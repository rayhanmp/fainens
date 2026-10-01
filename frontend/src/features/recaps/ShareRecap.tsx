import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { PeriodRecap } from './queries';
import { periodDateRange } from './stories';
import { formatRecapCurrency as formatCurrency } from './currency';

/** Draw only the explicitly previewed fields; never capture the private story DOM. */
async function downloadCard(recap: PeriodRecap, showAmounts: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the image.');
  ctx.fillStyle = '#d5f478'; ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = '#243d2c'; ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath(); ctx.ellipse(960, 450, 180 + i * 25, 280 + i * 30, .55, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#183529'; ctx.font = 'bold 32px sans-serif'; ctx.fillText('fainens / period recap', 80, 110);
  ctx.font = 'bold 90px sans-serif'; ctx.fillText(recap.period.name, 80, 330, 900);
  ctx.fillText('in money.', 80, 435);
  ctx.font = '28px sans-serif'; ctx.fillText(periodDateRange(recap.period) + (recap.isPartial ? ' · So far' : ''), 80, 505);
  ctx.fillStyle = '#183529'; ctx.fillRect(64, 730, 952, 410);
  ctx.fillStyle = '#d5f478';
  const lines = showAmounts ? [
    `Income: ${formatCurrency(recap.income)}`,
    `Expenses: ${formatCurrency(recap.expenses)}`,
    `Income − expenses: ${formatCurrency(recap.net)}`,
  ] : ['A little reflection.', 'A fresh perspective.', 'Ready for what’s next.'];
  ctx.font = 'bold 38px sans-serif';
  lines.forEach((line, index) => ctx.fillText(line, 110, 845 + index * 85, 860));
  ctx.fillStyle = '#183529'; ctx.font = '26px sans-serif';
  ctx.fillText(showAmounts ? 'Based on recorded activity · Amounts included' : 'My period, my story. Financial details kept private.', 80, 1230);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Unable to create the image.')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `fainens-period-${recap.period.id}.png`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShareRecap({ recap, onClose }: { recap: PeriodRecap; onClose: () => void }) {
  const { balancesHidden } = useBalanceVisibility();
  const dialog = useRef<HTMLDialogElement>(null);
  const [showAmounts, setShowAmounts] = useState(false);
  const includeAmounts = showAmounts && !balancesHidden;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="recap-share-dialog" aria-labelledby="recap-share-title" onCancel={onClose} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="recap-share-heading"><h2 id="recap-share-title">Your share card</h2><button onClick={onClose} aria-label="Close share card"><X size={22} /></button></div>
    <p className="recap-muted">A little piece of your period. You choose what to include.</p>
    <div className="recap-share-preview">
      <small>fainens / period recap</small>
      <h3>{recap.period.name}<br />in money.</h3>
      <p>{periodDateRange(recap.period)}{recap.isPartial ? ' · So far' : ''}</p>
      <div>{includeAmounts ? <>
        <p>Income: {formatCurrency(recap.income)}</p><p>Expenses: {formatCurrency(recap.expenses)}</p><p>Income − expenses: {formatCurrency(recap.net)}</p>
      </> : <><p>A little reflection.</p><p>A fresh perspective.</p><p>Ready for what’s next.</p></>}</div>
      <small>{includeAmounts ? 'Based on recorded activity · Amounts included' : 'My period, my story. Financial details kept private.'}</small>
    </div>
    <label className="recap-share-toggle"><input type="checkbox" checked={includeAmounts} disabled={balancesHidden} onChange={event => setShowAmounts(event.target.checked)} /> Include my financial amounts</label>
    <p className="recap-muted">{balancesHidden ? 'Show balances to include financial amounts in this card.' : includeAmounts ? 'Your income, expenses, and their difference will appear in the image.' : 'Amounts, categories, and purchase details are hidden.'}</p>
    {error && <p role="alert">{error}</p>}
    <button className="recap-primary" disabled={saving} onClick={async () => {
      setSaving(true); setError('');
      try { await downloadCard(recap, includeAmounts); } catch { setError('The image could not be saved. Please try again.'); } finally { setSaving(false); }
    }}><Download size={18} />{saving ? 'Creating image…' : 'Download share card'}</button>
  </dialog>;
}
