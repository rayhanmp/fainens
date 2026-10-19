import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { Burst } from './Burst';
import { play } from './sfx';
import type { Quiz } from './stories';

/** The question a chapter asks before it reveals its answer. */
export function QuizGate({ quiz, eyebrow, onAnswer, onSkip }: { quiz: Quiz; eyebrow: string; onAnswer: (choice: string, correct: boolean) => void; onSkip: () => void }) {
  return <div className="recap-quiz">
    <p className="recap-story-eyebrow">Quick quiz · {eyebrow}</p>
    <h2 aria-label={quiz.question}>{quiz.question.split(' ').map((word, i) => <span key={i}><span className="recap-word-mask"><span style={{ '--word': i } as CSSProperties}>{word}</span></span>{' '}</span>)}</h2>
    <div className="recap-quiz-options" role="group" aria-label="Your guess">
      {quiz.options.map((option, i) => <button key={option.label} type="button" className="recap-quiz-option" style={{ '--o': i } as CSSProperties}
        onClick={() => { play(option.correct ? 'chime' : 'buzz'); onAnswer(option.label, option.correct); }}>
        <span className="recap-quiz-key">{String.fromCharCode(65 + i)}</span>{option.label}
      </button>)}
    </div>
    <button type="button" className="recap-quiz-skip" onClick={onSkip}>Just show me</button>
  </div>;
}

/** The verdict stamped on a chapter after its quiz. */
export function QuizVerdict({ correct, answer }: { correct: boolean; answer: string }) {
  return <p className={`recap-verdict ${correct ? 'is-right' : 'is-wrong'}`} role="status">{correct ? '✓ Nailed it' : `✗ Nope, it was ${answer}`}</p>;
}

/**
 * A silver scratch-off layer. Rub it away, or tap once, to reveal what is underneath; clearing most of
 * it throws a handful of coins.
 */
export function ScratchCover({ children, seed, label = 'Scratch to reveal' }: { children: ReactNode; seed: number; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [revealed, setRevealed] = useState(false);
  const stroke = useRef<{ x: number; y: number; moved: number } | null>(null);
  const strokes = useRef(0);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const paint = () => {
      // Layout size, not the bounding box: the chapter may still be mid-entrance, scaled or tilted.
      const width = element.offsetWidth; const height = element.offsetHeight;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.max(1, Math.round(height * ratio));
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      const foil = ctx.createLinearGradient(0, 0, width, height);
      foil.addColorStop(0, '#d9dde3'); foil.addColorStop(.45, '#f7f8fa'); foil.addColorStop(.55, '#c3c8d0'); foil.addColorStop(1, '#e8ebef');
      ctx.fillStyle = foil; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#9aa1ab';
      for (let i = 0; i < 90; i++) ctx.fillRect((i * 53) % width, (i * 29) % height, 2, 2);
      ctx.fillStyle = '#4b5260'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.max(12, width * .055)}px Manrope, Inter, sans-serif`;
      ctx.fillText(`✳ ${label} ✳`, width / 2, height / 2);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    return () => observer.disconnect();
  }, [label]);

  const scratch = (event: PointerEvent<HTMLCanvasElement>) => {
    const element = canvas.current; const ctx = element?.getContext('2d');
    if (!element || !ctx || !stroke.current) return;
    const { x, y } = pointIn(element, event.clientX, event.clientY);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(24, element.offsetWidth * .12);
    ctx.beginPath(); ctx.moveTo(stroke.current.x, stroke.current.y); ctx.lineTo(x, y); ctx.stroke();
    stroke.current = { x, y, moved: stroke.current.moved + Math.hypot(x - stroke.current.x, y - stroke.current.y) };
    if (++strokes.current % 6 === 0) play('scratch');
    if (strokes.current % 10 === 0 && clearedShare(element) > .48) reveal();
  };
  const reveal = () => {
    if (revealed) return;
    setRevealed(true);
    play('fanfare');
  };
  return <div className={`recap-scratch${revealed ? ' is-revealed' : ''}`}>
    {children}
    {!revealed && <canvas ref={canvas} className="recap-scratch-foil" aria-hidden="true"
      onPointerDown={event => {
        // Capture keeps a fast finger scratching past the edge; it is a nicety, never a requirement.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not a capturable pointer */ }
        stroke.current = { ...pointIn(event.currentTarget, event.clientX, event.clientY), moved: 0 };
      }}
      onPointerMove={scratch}
      onPointerUp={() => { if (stroke.current && stroke.current.moved < 8) reveal(); stroke.current = null; }}
      onPointerCancel={() => { stroke.current = null; }} />}
    {!revealed && <button type="button" className="sr-only" onClick={reveal}>{label}</button>}
    {revealed && <div className="recap-scratch-burst" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={seed} kind="coins" count={22} origin="center" /></div>}
  </div>;
}

/** A pointer position in the canvas's own layout space, undoing any transform on the way there. */
function pointIn(element: HTMLElement, clientX: number, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return { x: (clientX - bounds.left) * (element.offsetWidth / (bounds.width || 1)), y: (clientY - bounds.top) * (element.offsetHeight / (bounds.height || 1)) };
}

function clearedShare(element: HTMLCanvasElement) {
  const ctx = element.getContext('2d');
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, element.width, element.height);
  let clear = 0; let total = 0;
  for (let i = 3; i < data.length; i += 4 * 24) { total++; if (data[i] === 0) clear++; }
  return total ? clear / total : 0;
}
