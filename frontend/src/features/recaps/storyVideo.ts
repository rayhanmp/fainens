import { formatRecapCurrency } from './currency';
import type { PeriodRecap } from './queries';
import { formatRecapDay, periodDateRange, themeColors, type Persona, type RecapTheme } from './stories';

const W = 1080;
const H = 1920;
const FPS = 30;
const heading = (size: number) => `800 ${size}px Manrope, Inter, system-ui, sans-serif`;
const text = (weight: number, size: number) => `${weight} ${size}px Inter, system-ui, sans-serif`;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const easeBack = (t: number) => { const c = 1.70158; const x = clamp(t) - 1; return 1 + (c + 1) * x * x * x + c * x * x; };

type Scene = { length: number; theme: RecapTheme; draw: (ctx: CanvasRenderingContext2D, t: number, colors: { paper: string; ink: string }) => void };

export type VideoInput = { recap: PeriodRecap; themes: RecapTheme[]; persona: Persona | null; showAmounts: boolean };

/** The scenes of the story reel. Without amounts it keeps to the title, the persona and the sign-off. */
function scenes({ recap, themes, persona, showAmounts }: VideoInput): Scene[] {
  const theme = (i: number) => themes[i % themes.length] ?? 'lime';
  const top = recap.categories.find(row => row.amount > 0);
  const total = recap.categories.filter(row => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const topShare = top && total > 0 ? Math.round(top.amount / total * 100) : null;
  const kept = recap.income > 0 && recap.net >= 0 ? Math.round(recap.net / recap.income * 100) : null;
  const peak = recap.highlights?.peakSpendingDay ?? null;
  const list: Scene[] = [{ length: 2.4, theme: theme(0), draw: (ctx, t, c) => {
    ctx.save(); ctx.translate(W / 2, 560); ctx.rotate(easeOut(t * 1.4) * Math.PI * 2); ctx.fillStyle = c.ink; ctx.font = heading(180); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = easeOut(t * 3); ctx.fillText('✳', 0, 0); ctx.restore();
    ctx.fillStyle = c.ink; ctx.textAlign = 'center'; ctx.globalAlpha = easeOut((t - .15) * 3);
    ctx.font = text(800, 34); ctx.fillText('FAINENS PRESENTS', W / 2, 820);
    recap.period.name.split(' ').forEach((word, i) => { const p = easeBack((t - .25 - i * .12) * 2.6); ctx.globalAlpha = clamp(p); ctx.font = heading(150); ctx.fillText(word, W / 2, 1010 + i * 150 + (1 - p) * 120); });
    ctx.globalAlpha = easeOut((t - .55) * 3) * .55; ctx.font = heading(150); ctx.fillText('in review.', W / 2, 1010 + recap.period.name.split(' ').length * 150);
    ctx.globalAlpha = easeOut((t - .7) * 3); ctx.font = text(600, 38); ctx.fillText(periodDateRange(recap.period), W / 2, 1450);
  } }];
  if (showAmounts) {
    list.push({ length: 2.6, theme: theme(1), draw: (ctx, t, c) => {
      ctx.fillStyle = c.ink; ctx.textAlign = 'center';
      ctx.globalAlpha = easeOut(t * 3); ctx.font = text(800, 40); ctx.fillText(recap.net >= 0 ? 'LEFT OVER' : 'SHORT BY', W / 2, 760);
      ctx.globalAlpha = 1; ctx.font = heading(150); ctx.fillText(formatRecapCurrency(Math.round(Math.abs(recap.net) * easeOut(t * 1.5))), W / 2, 960, W - 120);
      if (kept !== null) { ctx.globalAlpha = easeOut((t - .5) * 3); ctx.font = text(700, 46); ctx.fillText(`${kept}% of what came in`, W / 2, 1070); }
      ctx.globalAlpha = 1; const bar = W - 240; ctx.fillStyle = `${c.ink}22`; ctx.beginPath(); ctx.roundRect(120, 1220, bar, 60, 30); ctx.fill();
      ctx.fillStyle = c.ink; ctx.beginPath(); ctx.roundRect(120, 1220, Math.max(60, bar * (kept ?? 0) / 100 * easeOut((t - .3) * 1.8)), 60, 30); ctx.fill();
    } });
    if (top && topShare !== null) list.push({ length: 2.4, theme: theme(2), draw: (ctx, t, c) => {
      ctx.fillStyle = c.ink; ctx.textAlign = 'center';
      ctx.globalAlpha = easeOut(t * 3); ctx.font = text(800, 40); ctx.fillText('TOP CATEGORY', W / 2, 700);
      const p = easeBack((t - .1) * 2.2); ctx.globalAlpha = clamp(p); ctx.font = heading(130); ctx.fillText(top.name, W / 2, 880 + (1 - p) * 80, W - 120);
      ctx.globalAlpha = 1; ctx.font = heading(260); ctx.fillText(`${Math.round(topShare * easeOut((t - .3) * 1.6))}%`, W / 2, 1200);
      ctx.font = text(600, 44); ctx.globalAlpha = easeOut((t - .6) * 3); ctx.fillText('of everything that went out', W / 2, 1300);
    } });
    if (peak) list.push({ length: 2.4, theme: theme(3), draw: (ctx, t, c) => {
      ctx.fillStyle = c.ink; ctx.textAlign = 'center';
      ctx.globalAlpha = easeOut(t * 3); ctx.font = text(800, 40); ctx.fillText('BUSIEST DAY', W / 2, 560);
      // A grid of days lighting up in a wave, the busiest one held bright.
      for (let i = 0; i < 35; i++) {
        const col = i % 7; const row = Math.floor(i / 7); const lit = easeOut((t - (col + row) * .04) * 3);
        ctx.globalAlpha = i === 17 ? 1 : .12 + lit * .25; ctx.beginPath(); ctx.roundRect(150 + col * 115, 650 + row * 95, 95, 75, 18); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.font = heading(110); ctx.fillText(formatRecapDay(peak.date, { weekday: 'long' }), W / 2, 1300);
      ctx.font = text(700, 46); ctx.fillText(`${formatRecapDay(peak.date, { day: 'numeric', month: 'long' })} · ${formatRecapCurrency(peak.amount)}`, W / 2, 1390);
    } });
  }
  if (persona) list.push({ length: 2.6, theme: theme(4), draw: (ctx, t, c) => {
    ctx.save(); ctx.translate(W / 2, 820); const s = easeBack(t * 1.8); ctx.scale(s, s); ctx.rotate((1 - easeOut(t * 1.8)) * -2.5);
    ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(0, 0, 220, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = c.ink; ctx.lineWidth = 6; ctx.setLineDash([18, 16]); ctx.rotate(t * 2); ctx.beginPath(); ctx.arc(0, 0, 280, 0, Math.PI * 2); ctx.stroke();
    ctx.restore(); ctx.fillStyle = c.paper; ctx.font = heading(220); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = easeOut((t - .3) * 3); ctx.fillText('✳', W / 2, 830);
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = c.ink; ctx.font = text(800, 40); ctx.fillText('MONEY PERSONALITY', W / 2, 1230);
    ctx.font = heading(110); ctx.fillText(persona.name, W / 2, 1370, W - 100);
    ctx.font = text(600, 42); ctx.globalAlpha = easeOut((t - .5) * 3); ctx.fillText(persona.tagline, W / 2, 1460, W - 140);
  } });
  list.push({ length: 2.4, theme: theme(5), draw: (ctx, t, c) => {
    ctx.fillStyle = c.ink; ctx.textAlign = 'center';
    const p = easeBack(t * 2); ctx.globalAlpha = clamp(p); ctx.font = heading(170); ctx.fillText('That’s a', W / 2, 880 + (1 - p) * 100); ctx.fillText('wrap.', W / 2, 1050 + (1 - p) * 140);
    ctx.globalAlpha = easeOut((t - .4) * 3); ctx.font = heading(64); ctx.fillText('fainens✳', W / 2, 1300);
    // Confetti bursting from the middle.
    const colors = ['#ff5a5f', '#ffb400', '#00b3a4', '#7b61ff', '#2f80ff', c.ink];
    for (let i = 0; i < 70; i++) {
      const angle = i * 2.399; const power = 300 + (i * 37) % 420; const k = easeOut((t - .15) * 1.6);
      ctx.globalAlpha = clamp(1 - (t - .2) * 1.1); ctx.fillStyle = colors[i % colors.length];
      ctx.save(); ctx.translate(W / 2 + Math.cos(angle) * power * k, 900 + Math.sin(angle) * power * k + k * k * 260); ctx.rotate(angle + t * 8); ctx.fillRect(-10, -22, 20, 44); ctx.restore();
    }
  } });
  return list;
}

/** Record the reel to a video file, frame by frame, in this browser. Nothing is uploaded. */
export async function recordStoryVideo(input: VideoInput, onProgress: (share: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; extension: string }> {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  const mimeType = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser cannot record video.');
  await Promise.allSettled([document.fonts.load(heading(100)), document.fonts.load(text(700, 40))]);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the video.');
  const list = scenes(input);
  const total = list.reduce((sum, scene) => sum + scene.length, 0);
  if (signal?.aborted) throw new DOMException('Recording cancelled.', 'AbortError');
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
  recorder.start(250);
  const started = performance.now();
  let timer = 0;
  await new Promise<void>(resolve => {
    // Closing the dialog stops the reel where it is.
    signal?.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true });
    const frame = () => {
      if (signal?.aborted) return;
      const elapsed = (performance.now() - started) / 1000;
      let at = elapsed; let index = 0;
      while (index < list.length - 1 && at >= list[index].length) { at -= list[index].length; index++; }
      const scene = list[index];
      const colors = themeColors[scene.theme];
      ctx.globalAlpha = 1; ctx.fillStyle = colors.paper; ctx.fillRect(0, 0, W, H);
      scene.draw(ctx, at / scene.length, colors);
      // Each scene opens with an iris of its own colour over the last one.
      if (index > 0 && at < .45) {
        const previous = themeColors[list[index - 1].theme];
        ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = previous.paper; ctx.beginPath(); ctx.rect(0, 0, W, H);
        ctx.arc(W / 2, H / 2, easeOut(at / .45) * 1200, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.restore();
      }
      ctx.globalAlpha = .6; ctx.fillStyle = colors.ink; ctx.font = text(700, 28); ctx.textAlign = 'center'; ctx.fillText('fainens · your period, in review', W / 2, H - 90);
      onProgress(Math.min(1, elapsed / total));
      // A timer, not animation frames: frames pause in a background tab, timers only slow down.
      if (elapsed < total) timer = window.setTimeout(frame, 1000 / FPS); else resolve();
    };
    frame();
  });
  recorder.stop();
  await stopped;
  // The canvas track stays live until it is stopped, holding the canvas and the encoder.
  stream.getTracks().forEach(track => track.stop());
  canvas.width = 0; canvas.height = 0;
  if (signal?.aborted) throw new DOMException('Recording cancelled.', 'AbortError');
  return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
}
