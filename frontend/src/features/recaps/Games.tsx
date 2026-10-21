import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLater } from './useLater';
import { Gift, PiggyBank } from 'lucide-react';
import { CategoryIcon } from '../categories/CategoryIcon';
import { Burst } from './Burst';
import { seeded } from './motion';
import { loadPart } from './parts';
import { play as sfx, playTicks } from './sfx';
import { EXTRA_GAMES, type Play } from './stories';

export type Verdict = { text: string; tone: 'good' | 'bad' | 'party' };
export type PlayResult = { choice: string | null; correct: boolean; scored: boolean; verdict: Verdict | null };
export type GateProps = { onDone: (result: PlayResult) => void };
const skipped: PlayResult = { choice: null, correct: false, scored: false, verdict: null };

// The newer games load with their own group the first time a run deals one.
const ExtraGame = lazy(() => loadPart('games').then(module => ({ default: module.ExtraGame })));

/** The mini-game a chapter plays before it reveals: a quiz, a slider guess, reels, a hold, a gift, a piggy bank, and more. */
export function PlayGate({ play, eyebrow, seed, onDone }: { play: Play; eyebrow: string; seed: number } & GateProps) {
  const headline: Record<Play['kind'], string> = { quiz: play.kind === 'quiz' ? play.quiz.question : '', slider: play.kind === 'slider' ? play.question : '', reels: 'Spin for your top category.',
    hold: 'Ready for the big reveal?', gift: 'A little something for you.', piggy: 'Break the bank.',
    higherLower: 'Higher or lower?', memory: 'Match your top categories.', wheel: 'Spin the wheel.', truefalse: 'True or false?',
    doors: 'Pick a door. It decides what’s next.', fork: 'Which way next?', dice: 'Roll for the next chapter.', claw: 'Grab the next chapter.' };
  const label: Record<Play['kind'], string> = { quiz: 'Quick quiz', slider: 'Take a guess', reels: 'Jackpot round', hold: 'Drumroll', gift: 'Surprise', piggy: 'Smash time',
    higherLower: 'Higher or lower', memory: 'Memory match', wheel: 'Wheel of spending', truefalse: 'True or false',
    doors: 'Three doors', fork: 'Crossroads', dice: 'Lucky roll', claw: 'Claw machine' };
  return <div className={`recap-game recap-game-${play.kind}`}>
    <p className="recap-story-eyebrow">{label[play.kind]} · {eyebrow}</p>
    <h2 aria-label={headline[play.kind]}>{headline[play.kind].split(' ').map((word, i) => <span key={i}><span className="recap-word-mask"><span style={{ '--word': i } as CSSProperties}>{word}</span></span>{' '}</span>)}</h2>
    {play.kind === 'quiz' && <QuizGame play={play} onDone={onDone} />}
    {play.kind === 'slider' && <SliderGame play={play} onDone={onDone} />}
    {play.kind === 'reels' && <ReelsGame play={play} seed={seed} onDone={onDone} />}
    {play.kind === 'hold' && <HoldGame prompt={play.prompt} onDone={onDone} />}
    {play.kind === 'gift' && <GiftGame prompt={play.prompt} seed={seed} onDone={onDone} />}
    {play.kind === 'piggy' && <PiggyGame prompt={play.prompt} seed={seed} onDone={onDone} />}
    {EXTRA_GAMES.has(play.kind) && <Suspense fallback={<p className="recap-fact" role="status">Setting up the game…</p>}><ExtraGame play={play} seed={seed} onDone={onDone} /></Suspense>}
    <button type="button" className="recap-quiz-skip" onClick={() => onDone(skipped)}>Just show me</button>
  </div>;
}

/** The verdict stamped on a chapter after its game. */
export function GameVerdict({ verdict }: { verdict: Verdict }) {
  return <p className={`recap-verdict is-${verdict.tone}`} role="status">{verdict.text}</p>;
}

function QuizGame({ play, onDone }: { play: Extract<Play, { kind: 'quiz' }> } & GateProps) {
  return <div className="recap-quiz-options" role="group" aria-label="Your guess">
    {play.quiz.options.map((option, i) => <button key={option.label} type="button" className="recap-quiz-option" style={{ '--o': i } as CSSProperties}
      onClick={() => { sfx(option.correct ? 'chime' : 'buzz'); onDone({ choice: option.label, correct: option.correct, scored: true, verdict: option.correct ? { text: '✓ Nailed it', tone: 'good' } : { text: `✗ Nope, it was ${play.quiz.answer}`, tone: 'bad' } }); }}>
      <span className="recap-quiz-key">{String.fromCharCode(65 + i)}</span>{option.label}
    </button>)}
  </div>;
}


/** Drag to guess a share; locking in slides the real answer onto the track next to yours. */
function SliderGame({ play, onDone }: { play: Extract<Play, { kind: 'slider' }> } & GateProps) {
  const [guess, setGuess] = useState(50);
  const [locked, setLocked] = useState(false);
  const later = useLater();
  const lock = () => {
    if (locked) return;
    setLocked(true);
    const off = Math.abs(guess - play.answer);
    const verdict: Verdict = off <= 3 ? { text: `🎯 Bullseye! ${play.answer}%`, tone: 'good' } : off <= 10 ? { text: `So close! It was ${play.answer}%`, tone: 'good' } : { text: `Way off, it was ${play.answer}%`, tone: 'bad' };
    sfx(off <= 10 ? 'chime' : 'buzz', 700);
    later(() => onDone({ choice: `${guess}%`, correct: off <= 10, scored: true, verdict }), 1500);
  };
  return <div className="recap-slider-game">
    <output className="recap-slider-value">{guess}<small>%</small></output>
    <div className={`recap-slider-track${locked ? ' is-locked' : ''}`}>
      <input type="range" min={0} max={100} value={guess} disabled={locked} aria-label={play.question} onChange={event => { setGuess(Number(event.target.value)); sfx('tick'); }} style={{ '--v': guess } as CSSProperties} />
      {locked && <span className="recap-slider-answer" style={{ '--a': play.answer } as CSSProperties}><b>{play.answer}%</b></span>}
    </div>
    <button type="button" className="recap-solid-button recap-game-cta" onClick={lock} disabled={locked}>{locked ? 'Checking…' : 'Lock it in'}</button>
  </div>;
}

/** A three-reel slot machine of category icons; every pull lands on the top category. */
function ReelsGame({ play, seed, onDone }: { play: Extract<Play, { kind: 'reels' }>; seed: number } & GateProps) {
  const [state, setState] = useState<'idle' | 'spinning' | 'won'>('idle');
  const winner = play.symbols.find(symbol => symbol.name === play.winner) ?? play.symbols[0];
  const STRIP = 18;
  // Each reel is a strip of random symbols that always ends on the winner.
  const [strips] = useState(() => {
    const random = seeded(seed + 61);
    return [0, 1, 2].map(() => [...Array.from({ length: STRIP - 1 }, () => play.symbols[Math.floor(random() * play.symbols.length)]), winner]);
  });
  useEffect(() => {
    if (state !== 'spinning') return;
    playTicks(22, 2300);
    const win = setTimeout(() => { setState('won'); sfx('fanfare'); sfx('coin', 250); sfx('coin', 500); sfx('cash', 750); }, 2500);
    const done = setTimeout(() => onDone({ choice: null, correct: true, scored: false, verdict: { text: `Jackpot! ${winner.label} ×3`, tone: 'party' } }), 3900);
    return () => { clearTimeout(win); clearTimeout(done); };
  }, [state, onDone, winner.label]);
  return <div className={`recap-reels is-${state}`}>
    <div className="recap-reels-machine">
      {strips.map((strip, r) => <div key={r} className="recap-reel-window" style={{ '--r': r } as CSSProperties}>
        <div className="recap-reel-strip" style={{ '--stop': STRIP - 1 } as CSSProperties}>
          {strip.map((symbol, i) => <span key={i} className="recap-reel-cell"><CategoryIcon name={symbol.name} color="currentColor" className="h-[1em] w-[1em]" /></span>)}
        </div>
      </div>)}
      <button type="button" className="recap-lever" aria-label="Pull the lever" disabled={state !== 'idle'} onClick={() => { sfx('thunk'); setState('spinning'); }}><i /></button>
    </div>
    {state === 'won' && <div className="recap-game-burst" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={seed} kind="coins" count={26} origin="center" /></div>}
    <button type="button" className="recap-solid-button recap-game-cta" disabled={state !== 'idle'} onClick={() => { sfx('thunk'); setState('spinning'); }}>{state === 'idle' ? 'Pull the lever' : state === 'spinning' ? 'Spinning…' : `${winner.label}! ${winner.label}! ${winner.label}!`}</button>
  </div>;
}

/** Press and hold: a ring charges with a drumroll, and lets go of the reveal when full. */
function HoldGame({ prompt, onDone }: { prompt: string } & GateProps) {
  const [progress, setProgress] = useState(0);
  const holding = useRef(false);
  const done = useRef(false);
  const later = useLater();
  useEffect(() => {
    let frame = 0; let last = performance.now(); let tick = 0;
    const step = (now: number) => {
      const dt = now - last; last = now;
      setProgress(value => {
        if (done.current) return 1;
        const next = Math.max(0, Math.min(1, value + (holding.current ? dt / 1600 : -dt / 900)));
        if (next >= 1 && !done.current) {
          done.current = true;
          sfx('thunk'); sfx('cymbal'); sfx('chime', 120);
          later(() => onDone({ choice: null, correct: true, scored: false, verdict: { text: '🥁 Ta-da!', tone: 'party' } }), 650);
        }
        return next;
      });
      if (holding.current && now - tick > 85) { tick = now; sfx('tick'); }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [onDone, later]);
  const press = (down: boolean) => {
    if (down && !holding.current && !done.current) sfx('riser');
    holding.current = down && !done.current;
  };
  return <div className={`recap-hold${progress >= 1 ? ' is-full' : ''}`}>
    <button type="button" className="recap-hold-button" style={{ '--p': progress } as CSSProperties} aria-label={prompt}
      onPointerDown={() => press(true)} onPointerUp={() => press(false)} onPointerLeave={() => press(false)} onPointerCancel={() => press(false)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); press(true); } }} onKeyUp={() => press(false)}
      onContextMenu={event => event.preventDefault()}>
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" className="recap-hold-track" /><circle cx="50" cy="50" r="44" className="recap-hold-fill" pathLength={1} /></svg>
      <span>{progress >= 1 ? '!!!' : progress > 0 ? `${Math.round(progress * 100)}%` : 'Hold'}</span>
    </button>
    <p className="recap-fact">{prompt}</p>
  </div>;
}

/** A wobbling present; one tap blows the lid off. */
function GiftGame({ prompt, seed, onDone }: { prompt: string; seed: number } & GateProps) {
  const [open, setOpen] = useState(false);
  const later = useLater();
  const unwrap = () => {
    if (open) return;
    setOpen(true); sfx('pop'); sfx('horn', 120); sfx('fanfare', 300);
    later(() => onDone({ choice: null, correct: true, scored: false, verdict: { text: '🎁 Ta-da!', tone: 'party' } }), 1100);
  };
  return <div className={`recap-gift${open ? ' is-open' : ''}`}>
    <button type="button" className="recap-gift-box" onClick={unwrap} aria-label={prompt}>
      <span className="recap-gift-lid" /><span className="recap-gift-body"><Gift aria-hidden="true" /></span>
    </button>
    {open && <div className="recap-game-burst" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={seed} kind="confetti" count={44} origin="center" /></div>}
    <p className="recap-fact">{prompt}</p>
  </div>;
}

/** Five taps crack the piggy bank, a little more with each, and the last one smashes it. */
function PiggyGame({ prompt, seed, onDone }: { prompt: string; seed: number } & GateProps) {
  const [taps, setTaps] = useState(0);
  const NEEDED = 5;
  const later = useLater();
  const tap = () => {
    if (taps >= NEEDED) return;
    const next = taps + 1;
    setTaps(next);
    if (next < NEEDED) { sfx('oink'); sfx('thunk', 60); return; }
    sfx('thud'); sfx('cash', 150); sfx('coin', 400);
    later(() => onDone({ choice: null, correct: true, scored: false, verdict: { text: '🐷 Smashed it!', tone: 'party' } }), 1000);
  };
  const cracks: ReactNode[] = ['M48 18 L42 34 L50 42 L44 58', 'M62 30 L70 44 L64 52', 'M30 46 L40 52 L36 64', 'M56 60 L60 74 L52 82'].slice(0, Math.max(0, taps - 1)).map((d, i) => <path key={i} d={d} />);
  return <div className={`recap-piggy${taps >= NEEDED ? ' is-smashed' : ''}`}>
    <button type="button" key={taps} className="recap-piggy-button" onClick={tap} aria-label={`${prompt}. ${NEEDED - taps} taps to go.`}>
      <PiggyBank aria-hidden="true" />
      <svg viewBox="0 0 100 100" className="recap-piggy-cracks" aria-hidden="true">{cracks}</svg>
    </button>
    {taps >= NEEDED && <div className="recap-game-burst" style={{ '--enter': '0ms' } as CSSProperties}><Burst seed={seed} kind="coins" count={34} origin="center" /></div>}
    <p className="recap-fact">{taps >= NEEDED ? 'Ka-ching!' : taps ? `${NEEDED - taps} more ${NEEDED - taps === 1 ? 'tap' : 'taps'}…` : prompt}</p>
  </div>;
}
