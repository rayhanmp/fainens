import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { PeriodRecap } from './queries';
import { periodDateRange, themeColors, type RecapTheme } from './stories';
import { formatRecapCurrency as formatCurrency } from './currency';

const W = 1080;
const H = 1350;
const heading = (weight: number, size: number) => `${weight} ${size}px Manrope, Inter, system-ui, sans-serif`;
const text = (weight: number, size: number) => `${weight} ${size}px Inter, system-ui, sans-serif`;

function wrapLines(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw only the explicitly chosen fields; never capture the private story DOM. */
function drawCard(canvas: HTMLCanvasElement, recap: PeriodRecap, theme: RecapTheme, showAmounts: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the image.');
  const { paper, ink } = themeColors[theme];
  canvas.width = W; canvas.height = H;
  ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);

  // Quiet contour rings, the recap's backdrop motif.
  ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.globalAlpha = .16;
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(1010, 300, 200 + i * 34, 300 + i * 38, .5, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();

  ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic';
  ctx.font = heading(800, 46); ctx.fillText('fainens✳', 80, 120);
  ctx.font = text(800, 22); ctx.textAlign = 'right';
  ctx.fillText(recap.isPartial ? 'YOUR PERIOD SO FAR' : 'THE PERIOD EDIT', W - 80, 116); ctx.textAlign = 'left';

  ctx.font = heading(800, 128);
  const titleLines = wrapLines(ctx, recap.period.name, W - 160).slice(0, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, 74, 400 + i * 128));
  const afterTitle = 400 + titleLines.length * 128;
  ctx.globalAlpha = .55; ctx.fillText('in review.', 74, afterTitle); ctx.globalAlpha = 1;
  ctx.font = text(600, 32); ctx.fillText(periodDateRange(recap.period) + (recap.isPartial ? ' · so far' : ''), 80, afterTitle + 70);

  // The ink panel carries the figures, or a private sign-off.
  const panelTop = 820; const panelHeight = 380;
  ctx.fillStyle = ink; ctx.beginPath(); ctx.roundRect(64, panelTop, W - 128, panelHeight, 44); ctx.fill();
  ctx.fillStyle = paper;
  if (showAmounts) {
    const kept = recap.income > 0 && recap.net >= 0 ? Math.round(recap.net / recap.income * 100) : null;
    ctx.font = text(800, 24); ctx.globalAlpha = .75; ctx.fillText(recap.net >= 0 ? 'LEFT OVER' : 'SHORT BY', 112, panelTop + 78); ctx.globalAlpha = 1;
    ctx.font = heading(800, 92); ctx.fillText(formatCurrency(Math.abs(recap.net)), 108, panelTop + 180, W - 400);
    if (kept !== null) {
      ctx.font = text(800, 28); const label = `${kept}% of income`; const width = ctx.measureText(label).width + 48;
      ctx.globalAlpha = .18; ctx.beginPath(); ctx.roundRect(W - 112 - width, panelTop + 120, width, 64, 32); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillText(label, W - 112 - width + 24, panelTop + 162);
    }
    ctx.globalAlpha = .25; ctx.fillRect(112, panelTop + 232, W - 224, 2); ctx.globalAlpha = 1;
    [['CAME IN', recap.income], ['WENT OUT', recap.expenses]].forEach(([label, amount], i) => {
      const x = 112 + i * ((W - 224) / 2);
      ctx.font = text(800, 22); ctx.globalAlpha = .7; ctx.fillText(String(label), x, panelTop + 288); ctx.globalAlpha = 1;
      ctx.font = heading(800, 44); ctx.fillText(formatCurrency(Number(amount)), x, panelTop + 342, (W - 224) / 2 - 24);
    });
  } else {
    ctx.font = heading(800, 58);
    ['A little reflection.', 'A fresh perspective.', 'Ready for what’s next.'].forEach((line, i) => ctx.fillText(line, 112, panelTop + 118 + i * 92));
  }
  ctx.fillStyle = ink; ctx.font = text(600, 24); ctx.globalAlpha = .7;
  ctx.fillText(showAmounts ? 'Based on recorded activity · amounts included' : 'My period, my story · financial details kept private', 80, H - 72);
  ctx.globalAlpha = 1;
}

export function ShareRecap({ recap, theme, onClose }: { recap: PeriodRecap; theme: RecapTheme; onClose: () => void }) {
  const { balancesHidden } = useBalanceVisibility();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [showAmounts, setShowAmounts] = useState(false);
  const includeAmounts = showAmounts && !balancesHidden;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let cancelled = false;
    // Wait for the brand fonts so the preview and the saved image use them.
    void Promise.allSettled([document.fonts.load(heading(800, 100)), document.fonts.load(text(600, 30))]).then(() => {
      if (cancelled || !canvas.current) return;
      try { drawCard(canvas.current, recap, theme, includeAmounts); } catch (err) { setError(err instanceof Error ? err.message : 'The preview could not be drawn.'); }
    });
    return () => { cancelled = true; };
  }, [recap, theme, includeAmounts]);
  return <dialog ref={dialog} className="recap-share-dialog" aria-labelledby="recap-share-title" onCancel={onClose} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="recap-share-heading"><h2 id="recap-share-title">Your share card</h2><button onClick={onClose} aria-label="Close share card"><X size={20} /></button></div>
    <p className="recap-muted">A little piece of your period. You choose what to include.</p>
    <canvas ref={canvas} className="recap-share-canvas" width={W} height={H} role="img" aria-label={`Share card for ${recap.period.name}${includeAmounts ? ', with amounts' : ', without amounts'}`} />
    <label className="recap-share-toggle"><span>Include my financial amounts</span><input type="checkbox" checked={includeAmounts} disabled={balancesHidden} onChange={event => setShowAmounts(event.target.checked)} /></label>
    <p className="recap-muted">{balancesHidden ? 'Show balances to include financial amounts in this card.' : includeAmounts ? 'Your income, expenses and what was left over will appear in the image.' : 'Amounts, categories and purchase details are left out.'}</p>
    {error && <p role="alert" className="recap-muted">{error}</p>}
    <button className="recap-primary" disabled={saving} onClick={async () => {
      setSaving(true); setError('');
      try {
        const element = canvas.current;
        if (!element) throw new Error('missing canvas');
        drawCard(element, recap, theme, includeAmounts);
        const blob = await new Promise<Blob>((resolve, reject) => element.toBlob(value => value ? resolve(value) : reject(new Error('Unable to create the image.')), 'image/png'));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `fainens-period-${recap.period.id}.png`;
        document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch { setError('The image could not be saved. Please try again.'); } finally { setSaving(false); }
    }}><Download size={18} />{saving ? 'Creating image…' : 'Download share card'}</button>
  </dialog>;
}
