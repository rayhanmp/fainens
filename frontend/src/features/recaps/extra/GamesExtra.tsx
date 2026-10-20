import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CategoryIcon } from '../../categories/CategoryIcon';
import { AnimatedValue } from '../AnimatedValue';
import { Burst } from '../Burst';
import type { GateProps } from '../Games';
import { useLater } from '../useLater';
import { seeded } from '../motion';
import { play as sfx, playTicks } from '../sfx';
import type { Play } from '../stories';
import './games-extra.css';

type Of<Kind extends Play['kind']> = Extract<Play, { kind: Kind }>;
const vars = (values: Record<string, string | number>) => values as CSSProperties;

/** The newer mini-games, loaded the first time a run deals one: higher or lower, memory, the wheel, true or false. */
export function ExtraGame({ play, seed, onDone }: { play: Play; seed: number } & GateProps) {
  switch (play.kind) {
    case 'higherLower': return <HigherLower play={play} onDone={onDone} />;
    case 'memory': return <Memory play={play} seed={seed} onDone={onDone} />;
    case 'wheel': return <Wheel play={play} seed={seed} onDone={onDone} />;
    case 'truefalse': return <TrueFalse play={play} onDone={onDone} />;
    default: return null;
  }
}

/** One receipt face up, the other face down: was it higher or lower? The card flips to tell. */
function HigherLower({ play, onDone }: { play: Of<'higherLower'> } & GateProps) {
  const [pick, setPick] = useState<'Higher' | 'Lower' | null>(null);
  const later = useLater();
  const choose = (guess: 'Higher' | 'Lower') => {
    if (pick) return;
    setPick(guess);
    const correct = guess === play.answer;
    sfx('flap'); sfx(correct ? 'chime' : 'buzz', 650);
    later(() => onDone({ choice: guess, correct, scored: true, verdict: correct ? { text: `✓ ${play.answer}, nailed it`, tone: 'good' } : { text: `✗ It was ${play.answer.toLowerCase()}`, tone: 'bad' } }), 1700);
  };
  return <div className={`recap-hilo${pick ? ' is-revealed' : ''}`}>
    <div className="recap-hilo-card">
      <small>This one</small><b>{play.anchor.label}</b><strong><AnimatedValue value={play.anchor.amount} money /></strong>
    </div>
    <span className="recap-hilo-vs" aria-hidden="true">vs</span>
    <div className="recap-hilo-card is-mystery">
      <div className="recap-hilo-face"><small>That one</small><b>{play.challenger.label}</b><strong>?</strong></div>
      <div className="recap-hilo-back"><small>That one</small><b>{play.challenger.label}</b><strong><AnimatedValue value={play.challenger.amount} money /></strong></div>
    </div>
    {/* The reveal also gives the ratio, which still means something when balances are hidden. */}
    {pick && <p className="recap-hilo-ratio" role="status">{ratioLine(play.anchor.amount, play.challenger.amount)}</p>}
    <div className="recap-hilo-buttons" role="group" aria-label="Was it higher or lower?">
      {(['Higher', 'Lower'] as const).map(option => <button key={option} type="button" className={`recap-solid-button${pick === option ? ' is-picked' : ''}`} disabled={pick !== null} onClick={() => choose(option)}>
        {option === 'Higher' ? '▲' : '▼'} {option}
      </button>)}
    </div>
  </div>;
}

const ratioLine = (anchor: number, challenger: number) => {
  const ratio = challenger >= anchor ? challenger / anchor : anchor / challenger;
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${challenger >= anchor ? 'bigger' : 'smaller'} than the first`;
};

/** Three pairs of category cards, face down. Flip two at a time; matches stay up. */
function Memory({ play, seed, onDone }: { play: Of<'memory'>; seed: number } & GateProps) {
  const cards = useMemo(() => {
    const random = seeded(seed + 83);
    return [...play.cards, ...play.cards].map((card, i) => ({ ...card, id: i, sort: random() })).sort((a, b) => a.sort - b.sort);
  }, [play.cards, seed]);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [flips, setFlips] = useState(0);
  const later = useLater();
  const done = matched.size === play.cards.length;
  const finished = useRef(false);
  useEffect(() => {
    if (!done || finished.current) return;
    finished.current = true;
    sfx('fanfare');
    later(() => onDone({ choice: null, correct: true, scored: false, verdict: { text: `🧠 All matched in ${flips} flips`, tone: 'party' } }), 1500);
  }, [done, flips, later, onDone]);
  const flip = (index: number) => {
    if (open.length === 2 || open.includes(index) || matched.has(cards[index].name)) return;
    sfx('flap');
    const next = [...open, index];
    setOpen(next);
    if (next.length < 2) return;
    setFlips(count => count + 1);
    const [a, b] = next.map(i => cards[i]);
    if (a.name === b.name) { later(() => { sfx('ding'); setMatched(current => new Set(current).add(a.name)); setOpen([]); }, 350); }
    else later(() => { sfx('thunk'); setOpen([]); }, 800);
  };
  return <div className={`recap-memory${done ? ' is-done' : ''}`}>
    <p className="recap-memory-how">Tap two cards to turn them over. Find the three matching pairs: they’re your top three categories.</p>
    <div className="recap-memory-grid">
      {cards.map((card, i) => {
        const up = open.includes(i) || matched.has(card.name);
        return <button key={card.id} type="button" className={`recap-memory-card${up ? ' is-up' : ''}${matched.has(card.name) ? ' is-matched' : ''}`} style={vars({ '--i': i })}
          onClick={() => flip(i)} aria-label={up ? card.label : `Card ${i + 1}, face down`}>
          <span className="recap-memory-back" aria-hidden="true">✳</span>
          <span className="recap-memory-front"><CategoryIcon name={card.name} color="currentColor" className="h-[1em] w-[1em]" /><small>{card.label}</small></span>
        </button>;
      })}
    </div>
    <p className="recap-fact" role="status">{done ? 'Your top three, all matched.' : `Pairs found: ${matched.size} of ${play.cards.length} · tries: ${flips}`}</p>
    {done && <div className="recap-game-burst" style={vars({ '--enter': '0ms' })}><Burst seed={seed} kind="stars" count={30} origin="center" /></div>}
  </div>;
}

/** A wheel of fortune cut by share of spending; it always comes to rest on the biggest slice. */
function Wheel({ play, seed, onDone }: { play: Of<'wheel'>; seed: number } & GateProps) {
  const [spun, setSpun] = useState(false);
  const later = useLater();
  const total = play.slices.reduce((sum, slice) => sum + slice.share, 0) || 1;
  // Each slice starts where the ones before it end.
  const arcs = play.slices.map((slice, i) => {
    const before = play.slices.slice(0, i).reduce((sum, row) => sum + row.share, 0);
    return { ...slice, from: before / total * 360, to: (before + slice.share) / total * 360, i };
  });
  const winner = arcs.find(arc => arc.name === play.winner) ?? arcs[0];
  // Five full turns, then the winner's middle under the pointer at the top.
  const target = 360 * 5 + (360 - (winner.from + winner.to) / 2);
  const spin = () => {
    if (spun) return;
    setSpun(true);
    sfx('whirl'); playTicks(28, 3200, 100);
    later(() => { sfx('fanfare'); }, 3500);
    later(() => onDone({ choice: null, correct: true, scored: false, verdict: { text: `🎡 ${winner.label}!`, tone: 'party' } }), 4600);
  };
  const point = (deg: number, r = 46) => `${50 + r * Math.sin(deg * Math.PI / 180)} ${50 - r * Math.cos(deg * Math.PI / 180)}`;
  return <div className={`recap-wheel${spun ? ' is-spun' : ''}`}>
    <div className="recap-wheel-stage">
      <b className="recap-wheel-pointer" aria-hidden="true">▼</b>
      <svg viewBox="0 0 100 100" className="recap-wheel-disc" style={vars({ '--turn': `${target}deg` })} aria-hidden="true">
        {arcs.map(arc => <path key={arc.name} className={`recap-wheel-slice is-${arc.i % 4}`}
          d={`M50 50 L${point(arc.from)} A46 46 0 ${arc.to - arc.from > 180 ? 1 : 0} 1 ${point(arc.to)} Z`} />)}
        {/* Labels on the lower half turn over in place, so none rests upside down. */}
        {arcs.map(arc => { const mid = (arc.from + arc.to) / 2; return <text key={`t${arc.name}`} x="50" y="17" className="recap-wheel-label" transform={`rotate(${mid} 50 50)${mid > 90 && mid < 270 ? ' rotate(180 50 17)' : ''}`}>{arc.to - arc.from >= 26 ? arc.label.slice(0, 10) : ''}</text>; })}
        <circle cx="50" cy="50" r="7" className="recap-wheel-hub" />
      </svg>
    </div>
    <button type="button" className="recap-solid-button recap-game-cta" disabled={spun} onClick={spin}>{spun ? 'Round and round…' : 'Spin it'}</button>
    {spun && <div className="recap-game-burst" style={vars({ '--enter': '3400ms' })}><Burst seed={seed} kind="confetti" count={34} origin="center" /></div>}
  </div>;
}

/** A statement built from the figures, and two buttons. A stamp lands on the card with the answer. */
function TrueFalse({ play, onDone }: { play: Of<'truefalse'> } & GateProps) {
  const [pick, setPick] = useState<boolean | null>(null);
  const later = useLater();
  const choose = (guess: boolean) => {
    if (pick !== null) return;
    setPick(guess);
    const correct = guess === play.answer;
    sfx('thunk'); sfx(correct ? 'chime' : 'buzz', 450);
    later(() => onDone({ choice: guess ? 'True' : 'False', correct, scored: true, verdict: correct ? { text: `✓ ${play.reveal}`, tone: 'good' } : { text: `✗ ${play.reveal}`, tone: 'bad' } }), 1700);
  };
  return <div className={`recap-tf${pick !== null ? ' is-answered' : ''}`}>
    <div className="recap-tf-card">
      <p>{play.statement}</p>
      {pick !== null && <span className={`recap-tf-stamp is-${play.answer ? 'true' : 'false'}`}>{play.answer ? 'True' : 'False'}</span>}
    </div>
    <div className="recap-tf-buttons" role="group" aria-label="True or false?">
      <button type="button" className="recap-solid-button" disabled={pick !== null} onClick={() => choose(true)}>True</button>
      <button type="button" className="recap-ghost-button" disabled={pick !== null} onClick={() => choose(false)}>False</button>
    </div>
  </div>;
}
